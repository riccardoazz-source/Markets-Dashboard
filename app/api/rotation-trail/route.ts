import { NextResponse } from 'next/server';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { buildInputsAsOf, fmt, type Hist, type BtMeta } from '@/lib/backtestCore';
import { quadrantPosition, AXES_LOOKBACK_DAYS } from '@/lib/rotationPhase';
import { subDays, subMonths, subYears, startOfYear, startOfMonth } from 'date-fns';

// EDGE, like /api/rotation-returns and /api/rotation-backtest: Yahoo answers the
// edge network but blocks the Node serverless IPs, so on 'nodejs' every history
// fetch came back empty and the trail silently had no points to draw.
export const runtime = 'edge';
export const maxDuration = 25; // edge ceiling

// Rotation-quadrant TRAIL: where an asset has travelled across the quadrants over
// time. Each step rebuilds the coordinates as of that past date (buildInputsAsOf —
// no look-ahead). Both axes are measured on the asset itself, so only the TRACED
// symbols are evaluated: there is no ranking, and a trail costs the same whether
// the universe holds thirty tickers or three thousand.

const BASE_UNIVERSE: BtMeta[] = [
  ...INDEXES.map(i => ({ symbol: i.symbol, name: i.name, group: 'Indexes' })),
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, group: 'Commodities' })),
  ...CRYPTO_IDS.map(e => ({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' })),
  ...SECTORS.map(s => ({ symbol: s.symbol, name: s.name, group: 'Sectors' })),
];

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60_000;

// Same timeframe vocabulary as every other section, so the trail obeys the
// selector the user already knows.
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
    default:    return subMonths(now, 6);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wanted = [...new Set((searchParams.get('symbols') ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 8);
  const timeframe = searchParams.get('timeframe') ?? '6M';
  if (wanted.length === 0) return NextResponse.json({ trails: [] });

  const baseSymbols = new Set(BASE_UNIVERSE.map(m => m.symbol));
  const extraStocks = [...new Set(
    (searchParams.get('stocks') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  )].filter(s => !baseSymbols.has(s));
  // Traced symbols outside the base universe (a searched stock) must be scored too.
  const traced = wanted.filter(s => !baseSymbols.has(s) && !extraStocks.includes(s));
  const universe: BtMeta[] = [
    ...BASE_UNIVERSE,
    ...[...extraStocks, ...traced].map(s => ({ symbol: s, name: s, group: 'Stocks' })),
  ];

  const key = `${timeframe}|${wanted.slice().sort().join(',')}|${extraStocks.slice().sort().join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  const now = new Date();
  const start = windowStart(timeframe, now);
  // Step dates across the window. Cap the count so a 5Y trail stays readable and
  // the request stays inside the function's time budget.
  const spanDays = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86_400_000));
  // Every step rescoring the whole universe is the expensive part (ADX, R² over
  // 252 bars, MACD… per asset), so cap the count to stay inside the edge budget.
  const steps = Math.min(12, Math.max(4, Math.round(spanDays / 7)));
  const stepDays = spanDays / (steps - 1);
  const dates = Array.from({ length: steps }, (_, i) => new Date(start.getTime() + i * stepDays * 86_400_000));

  // One fetch per symbol covering the window PLUS a year of lookback, because the
  // oldest step still needs its own trailing 1Y/200d history to score.
  // The trend EMA's warm-up plus the smoothing window (AXES_LOOKBACK_DAYS), plus
  // room for holidays.
  const from = subDays(start, Math.max(400, AXES_LOOKBACK_DAYS + 60));
  const symbols = universe.map(m => m.symbol);
  const results = await Promise.allSettled(
    symbols.map(s => fetchYahooChart(s, from, now, '1d').catch(() => [] as Hist)),
  );
  const histMap = new Map<string, Hist>();
  symbols.forEach((s, i) => histMap.set(s, results[i].status === 'fulfilled' ? results[i].value : []));

  const meta = new Map(universe.map(m => [m.symbol, m]));
  const trails = new Map<string, { symbol: string; name: string; group: string; points: { date: string; macroGap: number; momentum: number }[] }>();
  for (const s of wanted) {
    const m = meta.get(s);
    trails.set(s, { symbol: s, name: m?.name ?? s, group: m?.group ?? 'Stocks', points: [] });
  }

  // Both coordinates belong to the asset alone, so a trail only needs THAT asset
  // evaluated — no ranking of the universe at any date. The whole cross-sectional
  // pass that used to dominate this endpoint is gone.
  const tracedMeta = universe.filter(m => wanted.includes(m.symbol));
  for (const d of dates) {
    const inputs = buildInputsAsOf(tracedMeta, histMap, d);
    const dateStr = fmt(d);
    for (const input of inputs) {
      const pos = quadrantPosition(input.macroGap, input.momentum);
      if (!pos) continue;
      const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
      trails.get(input.symbol)!.points.push({
        date: dateStr,
        macroGap: r4(pos.x),
        momentum: r4(pos.y),
      });
    }
  }

  // Counts travel with the payload so an empty trail can explain itself rather
  // than leaving the UI silently blank.
  const withHistory = symbols.filter(s => (histMap.get(s) ?? []).length > 0).length;
  const data = {
    generatedAt: fmt(now),
    timeframe,
    universeSize: universe.length,
    withHistory,
    trails: [...trails.values()].filter(t => t.points.length > 0),
  };
  cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
