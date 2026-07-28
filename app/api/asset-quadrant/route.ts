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
  // Ideal resolution is one step per WEEK — coarser than that and short-lived
  // phases (the model flipping and flipping back inside a month) vanish entirely,
  // which is exactly what makes a long window look like it has fewer regions than
  // it should. How many we can actually afford is measured below, not guessed:
  // each step rescores the whole universe, so the cost depends on the machine.
  const idealSteps = Math.min(160, Math.max(4, Math.round(spanDays / 7) + 1));

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

  // Price TODAY's step first: it is the one reading that must never be dropped
  // (a phase entered days ago has only this sample), and timing it tells us how
  // many more we can afford — measured, not guessed, so a fast run gets fine
  // resolution and a slow one still returns instead of timing out.
  const t0 = Date.now();
  const lastPoint = evalAt(idealDates[idealDates.length - 1]);
  const perStepMs = Math.max(1, Date.now() - t0);
  const BUDGET_MS = 13_000;
  const affordable = Math.max(4, Math.floor(BUDGET_MS / perStepMs));
  const nSteps = Math.min(idealSteps, affordable);

  // Evenly subsample the ideal grid; the final date is added separately below.
  const chosen: Date[] = [];
  for (let i = 0; i < nSteps - 1; i++) {
    chosen.push(idealDates[Math.round((i * (idealDates.length - 1)) / (nSteps - 1))]);
  }

  const points: QPoint[] = [];
  const deadline = t0 + BUDGET_MS;
  for (const d of chosen) {
    if (Date.now() > deadline) break;   // hard stop; we still have today's point
    const p = evalAt(d);
    if (p) points.push(p);
  }
  if (lastPoint) points.push(lastPoint);

  const stepDays = points.length > 1 ? spanDays / (points.length - 1) : spanDays;
  const data = {
    symbol,
    timeframe,
    generatedAt: fmt(now),
    universeSize: universe.length,
    stepDays: Math.round(stepDays),
    // True when the budget forced fewer samples than the weekly ideal, so the UI
    // can say the resolution is coarse rather than implying the phases are exact.
    coarse: points.length < idealSteps,
    price,
    points,
  };
  cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
