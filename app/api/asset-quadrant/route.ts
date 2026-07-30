import { NextResponse } from 'next/server';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { scoreRotation } from '@/lib/rotationModel';
import { quadrantPosition } from '@/lib/rotationPhase';
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

// ── Caches that make switching timeframes cheap ──────────────────────────────
// 1) History per symbol, remembering the WIDEST range already fetched, so moving
//    3M → 1Y → MAX re-downloads nothing it already holds.
const histCache = new Map<string, { hist: Hist; fromMs: number; ts: number }>();
// 2) One evaluated point per (symbol, date), so re-covering the same weeks under a
//    different timeframe costs nothing the second time.
const pointCache = new Map<string, {
  pt: { date: string; accel: number; r3m: number; phase: string | null; close: number | null; radius: number; angle: number };
  ts: number;
}>();

// Weekly grid anchored to a FIXED Monday rather than to the window start, so
// every timeframe samples the SAME dates and they hit the rank cache. Without
// this, 3M and 1Y would land on different days and share nothing.
const WEEK_MS = 7 * 86_400_000;
const GRID_ANCHOR = Date.UTC(2001, 0, 1);
const snapToGrid = (t: number) => GRID_ANCHOR + Math.floor((t - GRID_ANCHOR) / WEEK_MS) * WEEK_MS;

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

  // Both quadrant coordinates are measured on the asset itself, so this endpoint
  // no longer needs a universe at all: one symbol's own history is the whole input.
  // What used to be ~130 downloads and a full cross-sectional ranking at every
  // weekly step is now one download and one evaluation — which is also why the
  // long windows stopped being slow.
  const meta = BASE_UNIVERSE.find(m => m.symbol === symbol)
    ?? { symbol, name: symbol, group: 'Stocks' };
  const universe: BtMeta[] = [meta];

  const key = `${symbol}|${timeframe}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  const now = new Date();
  const start = windowStart(timeframe, now);
  const spanDays = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86_400_000));
  // WEEKLY resolution across the whole window, with no cap on the number of
  // samples: a coarser grid silently swallows short phases, and the longer the
  // window the more it swallows. Affordable because buildInputsAsOf reads a
  // fixed 400-bar tail, so a step costs the same on MAX as on 3M. The dates
  // themselves are built below, on a fixed weekly grid.

  // Window + a year of lookback: the oldest step still needs its own trailing
  // history to be scored.
  const from = subDays(start, 400);
  const fromMs = from.getTime();
  const symbols = universe.map(m => m.symbol);

  // Only fetch what the cache does not already cover.
  const stale = symbols.filter(s => {
    const c = histCache.get(s);
    return !c || c.fromMs > fromMs || Date.now() - c.ts > TTL;
  });
  if (stale.length) {
    const fetched = await Promise.allSettled(
      stale.map(s => fetchYahooChart(s, from, now, '1d').catch(() => [] as Hist)),
    );
    stale.forEach((s, i) => {
      const hist = fetched[i].status === 'fulfilled' ? (fetched[i] as PromiseFulfilledResult<Hist>).value : [];
      const prev = histCache.get(s);
      // Keep whichever covers more history, so a later 3M request cannot shrink
      // the range a previous MAX request already paid for.
      if (!prev || prev.fromMs > fromMs || hist.length >= prev.hist.length) {
        histCache.set(s, { hist, fromMs, ts: Date.now() });
      }
    });
  }
  const histMap = new Map<string, Hist>();
  symbols.forEach(s => histMap.set(s, histCache.get(s)?.hist ?? []));

  const ownHist = histMap.get(symbol) ?? [];
  const startStr = fmt(start);
  const price = ownHist.filter(p => p.date >= startStr).map(p => ({ date: p.date, close: p.close }));

  type QPoint = {
    date: string; accel: number; r3m: number; phase: string | null; close: number | null;
    /** Where the dot actually sits: distance from the centre and angle round it. */
    radius: number; angle: number;
  };

  // Same chain as everywhere else — buildInputsAsOf → scoreRotation → classifyPhase
  // — just run on one asset, because acceleration is a property of that asset and
  // does not change with who else is in the list.
  const evalAt = (d: Date): QPoint | null => {
    const dateStr = fmt(d);
    const cached = pointCache.get(`${symbol}|${dateStr}`);
    if (cached && Date.now() - cached.ts < TTL) return cached.pt;

    const inputs = buildInputsAsOf(universe, histMap, d);
    const row = scoreRotation(inputs)[0];
    if (!row || row.score <= -1 || row.item.r3m == null) return null;
    const pos = quadrantPosition(row.accel, row.item.r3m);
    if (!pos) return null;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const pt: QPoint = {
      date: dateStr,
      accel: r2(row.accel),
      r3m: row.item.r3m,
      phase: pos.phase,
      radius: r2(pos.radius),
      angle: r2(pos.angle),
      close: priceAsOf(ownHist, dateStr),
    };
    pointCache.set(`${symbol}|${dateStr}`, { pt, ts: Date.now() });
    return pt;
  };

  // Weekly, on the fixed grid, plus today. Same weeks for every timeframe, so a
  // window already visited is served from the rank cache.
  // The first sample is the grid point AT OR BEFORE the window start, never after
  // it: a phase holds until the model next changes it, so without that earlier
  // sample the opening days of the window have no call at all and were drawn as a
  // colourless gap.
  const idealDates: Date[] = [];
  for (let t = snapToGrid(start.getTime()); t <= now.getTime(); t += WEEK_MS) {
    idealDates.push(new Date(t));
  }
  if (!idealDates.length || fmt(idealDates[idealDates.length - 1]) !== fmt(now)) idealDates.push(now);
  const idealSteps = idealDates.length;

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
  // Only a COMPLETE result is worth remembering. A truncated one is cached as the
  // final answer would freeze the view at partial resolution for half an hour;
  // leaving it out lets the client ask again and, thanks to the per-date rank
  // cache, the repeat request skips everything already computed and spends its
  // whole budget pushing further — so the picture fills in over a few rounds
  // instead of the user waiting on one very long request.
  if (!truncated) cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
