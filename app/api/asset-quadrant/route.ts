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
  // Each step rescores the WHOLE universe (the Y axis is a cross-sectional
  // percentile), which is the expensive part — so the number of steps is capped
  // and the resolution is reported back for the UI to state honestly.
  const steps = Math.min(30, Math.max(4, Math.round(spanDays / 7)));
  const stepDays = spanDays / (steps - 1);
  const dates = Array.from({ length: steps }, (_, i) => new Date(start.getTime() + i * stepDays * 86_400_000));

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

  const points: { date: string; score: number; r3m: number; phase: string | null; close: number | null }[] = [];
  for (const d of dates) {
    const inputs = buildInputsAsOf(universe, histMap, d);
    const scored = scoreRotation(inputs).filter(x => x.score > -1 && x.item.r3m != null);
    if (scored.length < 2) continue;
    const asc = [...scored].sort((a, b) => a.score - b.score);
    const idx = asc.findIndex(x => x.item.symbol === symbol);
    if (idx < 0) continue;
    const row = asc[idx];
    if (row.item.r3m == null) continue;
    const pct = (idx / (asc.length - 1)) * 100;
    const dateStr = fmt(d);
    points.push({
      date: dateStr,
      score: Math.round(pct),
      r3m: row.item.r3m,
      phase: classifyPhase(pct, row.item.r3m),
      close: priceAsOf(ownHist, dateStr),
    });
  }

  const data = {
    symbol,
    timeframe,
    generatedAt: fmt(now),
    universeSize: universe.length,
    stepDays: Math.round(stepDays),
    price,
    points,
  };
  cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
