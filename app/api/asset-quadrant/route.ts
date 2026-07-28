import { NextResponse } from 'next/server';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { scoreRotation } from '@/lib/rotationModel';
import { classifyPhase } from '@/lib/rotationPhase';
import { buildInputsAsOf, fmt, priceAsOf, type Hist, type BtMeta } from '@/lib/backtestCore';
import { subDays, subMonths, subYears, startOfYear, startOfMonth } from 'date-fns';

// Yahoo answers the edge network but blocks the Node serverless IPs.
export const runtime = 'edge';
export const maxDuration = 25;

// One asset's PRICE alongside the quadrant position the model assigned it through
// time — the evidence for "when the model said Recovering, what did the price do
// next?". The score comes from the SAME pipeline as the live quadrant
// (buildInputsAsOf → scoreRotation → classifyPhase), so changing the formula
// changes this view too; nothing is duplicated here.

const BASE_UNIVERSE: BtMeta[] = [
  ...INDEXES.map(i => ({ symbol: i.symbol, name: i.name, group: 'Indexes' })),
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, group: 'Commodities' })),
  ...CRYPTO_IDS.map(e => ({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' })),
  ...SECTORS.map(s => ({ symbol: s.symbol, name: s.name, group: 'Sectors' })),
];

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60_000;

function windowStart(tf: string, now: Date): Date {
  switch (tf) {
    case 'Day': case '1D': return subDays(now, 5);
    case '1W':  return subDays(now, 7);
    case 'MTD': return startOfMonth(now);
    case '1M':  return subMonths(now, 1);
    case '3M':  return subMonths(now, 3);
    case '6M':  return subMonths(now, 6);
    case 'YTD': return startOfYear(now);
    case '1Y':  return subYears(now, 1);
    case '3Y':  return subYears(now, 3);
    case '5Y':  return subYears(now, 5);
    case '10Y': return subYears(now, 10);
    case 'MAX': return subYears(now, 25);
    default:    return subYears(now, 1);
  }
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') ?? '').trim();
  const timeframe = searchParams.get('timeframe') ?? '1Y';
  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  const baseSymbols = new Set(BASE_UNIVERSE.map(m => m.symbol));
  const extraStocks = [...new Set(
    (searchParams.get('stocks') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  )].filter(s => !baseSymbols.has(s));
  const universe: BtMeta[] = [
    ...BASE_UNIVERSE,
    ...extraStocks.map(s => ({ symbol: s, name: s, group: 'Stocks' })),
    ...(baseSymbols.has(symbol) || extraStocks.includes(symbol)
      ? []
      : [{ symbol, name: symbol, group: 'Stocks' }]),
  ];

  const key = `${symbol}|${timeframe}|${extraStocks.slice().sort().join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  const now = new Date();
  const start = windowStart(timeframe, now);
  const spanDays = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86_400_000));
  // WEEKLY resolution across the whole window, with no cap on the number of
  // samples: a coarser grid silently swallows short phases, and the longer the
  // window the more it swallows. Affordable now only because buildInputsAsOf
  // reads a fixed 400-bar tail, so a step costs the same on MAX as on 3M.
  const idealSteps = Math.max(4, Math.round(spanDays / 7) + 1);

  // Window + a year of lookback: the oldest step still needs its own trailing
  // history to be scored.
  const from = subDays(start, 400);
  const symbols = universe.map(m => m.symbol);
  const results = await Promise.allSettled(
    symbols.map(s => fetchYahooChart(s, from, now, '1d').catch(() => [] as Hist)),
  );
  const histMap = new Map<string, Hist>();
  symbols.forEach((s, i) => histMap.set(s, results[i].status === 'fulfilled' ? results[i].value : []));

  const ownHist = histMap.get(symbol) ?? [];
  const startStr = fmt(start);
  const price = ownHist.filter(p => p.date >= startStr).map(p => ({ date: p.date, close: p.close }));

  type QPoint = { date: string; score: number; r3m: number; phase: string | null; close: number | null };

  // Score the whole universe as of one date and read this asset's rank out of it.
  const evalAt = (d: Date): QPoint | null => {
    const inputs = buildInputsAsOf(universe, histMap, d);
    const scored = scoreRotation(inputs).filter(x => x.score > -1 && x.item.r3m != null);
    if (scored.length < 2) return null;
    const asc = [...scored].sort((a, b) => a.score - b.score);
    const idx = asc.findIndex(x => x.item.symbol === symbol);
    if (idx < 0) return null;
    const row = asc[idx];
    if (row.item.r3m == null) return null;
    const pct = (idx / (asc.length - 1)) * 100;
    const dateStr = fmt(d);
    return {
      date: dateStr,
      score: Math.round(pct),
      r3m: row.item.r3m,
      phase: classifyPhase(pct, row.item.r3m),
      close: priceAsOf(ownHist, dateStr),
    };
  };

  const idealDates = Array.from({ length: idealSteps }, (_, i) =>
    new Date(start.getTime() + (i * spanDays / (idealSteps - 1)) * 86_400_000));

  // Visit the grid by BISECTION — ends first, then midpoints, then quarters, and
  // so on. Every sample is computed; the order only decides what survives if the
  // platform's hard timeout ever intervenes, and in that case what is left is
  // spread evenly across the whole window instead of a chunk of history going
  // missing. Today's date is an endpoint, so it is always among the first done.
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (i: number) => { if (!seen.has(i)) { seen.add(i); order.push(i); } };
  push(idealSteps - 1);                 // today
  push(0);                              // window start
  for (let gap = idealSteps - 1; gap > 1; gap = Math.ceil(gap / 2)) {
    for (let i = 0; i < idealSteps; i += Math.max(1, Math.floor(gap / 2))) push(i);
  }
  for (let i = 0; i < idealSteps; i++) push(i);   // sweep up any index missed

  // Only a last-resort guard against the platform killing the request outright,
  // which would return nothing at all.
  const deadline = reqStart + 21_000;
  const collected: QPoint[] = [];
  let truncated = false;
  for (const i of order) {
    if (Date.now() > deadline) { truncated = true; break; }
    const p = evalAt(idealDates[i]);
    if (p) collected.push(p);
  }
  const points = collected.sort((a, b) => a.date.localeCompare(b.date));

  const stepDays = points.length > 1 ? spanDays / (points.length - 1) : spanDays;
  const data = {
    symbol,
    timeframe,
    generatedAt: fmt(now),
    universeSize: universe.length,
    stepDays: Math.round(stepDays),
    // True when the budget forced fewer samples than the weekly ideal, so the UI
    // can say the resolution is coarse rather than implying the phases are exact.
    coarse: truncated,
    steps: points.length,
    idealSteps,
    price,
    points,
  };
  cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
