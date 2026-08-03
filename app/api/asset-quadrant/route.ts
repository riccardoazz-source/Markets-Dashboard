import { NextResponse } from 'next/server';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { quadrantPosition, trendAxesSeries, AXES_LOOKBACK_DAYS } from '@/lib/rotationPhase';
import { fmt, type Hist, type BtMeta } from '@/lib/backtestCore';
import { subDays, subMonths, subYears, startOfYear, startOfMonth } from 'date-fns';

// Yahoo answers the edge network but blocks the Node serverless IPs.
export const runtime = 'edge';
export const maxDuration = 25;

// One asset's PRICE alongside the quadrant position the model assigned it through
// time — the evidence for "when the model said Recovering, what did the price do
// next?". The coordinates come from the SAME pipeline as the live quadrant
// (trendAxesSeries → classifyPhase), so changing the definition changes
// this view too; nothing is duplicated here.

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
  // Window + the axes' own lookback: the oldest step still needs its own trailing
  // history to be placed.
  // The window plus everything the axes reach back for: the trend EMA's warm-up and
  // the smoothing window (AXES_LOOKBACK_DAYS), and a margin for holidays. One day
  // short and the oldest steps have no position at all.
  const from = subDays(start, AXES_LOOKBACK_DAYS + 60);
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
  let r3mIdx = 0;
  const shiftDays = (d: string, days: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const startStr = fmt(start);
  const price = ownHist.filter(p => p.date >= startStr).map(p => ({ date: p.date, close: p.close }));

  type QPoint = {
    date: string; macroGap: number; momentum: number; r3m: number | null;
    phase: string | null; close: number | null;
    /** Where the dot actually sits: distance from the centre and angle round it. */
    radius: number; angle: number;
  };

  // EVERY DAY, in one pass.
  //
  // This used to evaluate a weekly grid and carry each call forward, because asking for
  // one date at a time costs a walk of the whole history and doing that daily would have
  // been quadratic. The compromise was not free: every band began and ended up to a week
  // late, so a Lagging stretch collected a week of the rebound that ended it. On the
  // NASDAQ 100 over ten years that alone reported Lagging at +0.7% a band when the same
  // model, evaluated daily, gives −2.0%. The figures under the strip were measuring the
  // sampling, not the model.
  //
  // trendAxesSeries computes the same definition incrementally, so the whole history
  // costs one pass and every trading day gets its own call.
  const axes = trendAxesSeries(ownHist);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const points: QPoint[] = [];
  for (let i = 0; i < ownHist.length; i++) {
    const ax = axes[i];
    if (!ax || ownHist[i].date < startStr) continue;
    const pos = quadrantPosition(ax.macroGap, ax.momentum);
    if (!pos) continue;
    // The 3-month return is carried for the tooltip and the CSV only; it is not part of
    // the model. Walking back 90 calendar days per bar would be another quadratic pass,
    // so the index that is 90 days back is advanced alongside i.
    while (r3mIdx + 1 < i && ownHist[r3mIdx + 1].date <= shiftDays(ownHist[i].date, -90)) r3mIdx++;
    const past = ownHist[r3mIdx]?.close;
    points.push({
      date: ownHist[i].date,
      // Four decimals on the coordinates, not two. The phase is decided by their SIGN,
      // and a value like +0.0031 rounds to 0.00 — so at two decimals a reader recomputing
      // the phase from the exported columns gets the opposite answer, precisely on the
      // rows where the asset is crossing an axis.
      macroGap: r4(pos.x),
      momentum: r4(pos.y),
      r3m: past && past > 0 ? Math.round((ownHist[i].close / past - 1) * 1e4) / 1e2 : null,
      phase: pos.phase,
      radius: r4(pos.radius),
      angle: Math.round(pos.angle * 100) / 100,
      close: ownHist[i].close,
    });
  }

  const stepDays = points.length > 1 ? spanDays / (points.length - 1) : spanDays;
  const data = {
    symbol,
    timeframe,
    generatedAt: fmt(now),
    universeSize: universe.length,
    stepDays: Math.max(1, Math.round(stepDays)),
    // True when the budget forced fewer samples than the weekly ideal, so the UI
    // can say the resolution is coarse rather than implying the phases are exact.
    coarse: false,
    steps: points.length,
    idealSteps: points.length,
    price,
    points,
  };
  // The whole answer is one pass over the history, so there is nothing partial to
  // guard against any more: cache it and move on.
  cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
