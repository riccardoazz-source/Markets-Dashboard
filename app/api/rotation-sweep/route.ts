import { NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { DEFAULT_PARAMS, ModelParams, ACCEL_MAX } from '@/lib/rotationModel';
import { BtMeta, Hist, fmt } from '@/lib/backtestCore';
import { buildSlices, evaluate, runBatch, DateSlice, SPX, SliceOpts, DEFAULT_SLICE_OPTS } from '@/lib/sweepCore';

// CPU-heavy: thousands of re-scorings. Node runtime + a real duration budget.
export const runtime = 'nodejs';
export const maxDuration = 60;

const BASE_UNIVERSE: BtMeta[] = [
  { symbol: SPX, name: 'S&P 500', group: 'Indexes' },
  ...INDEXES.map(i => ({ symbol: i.symbol, name: i.name, group: 'Indexes' })),
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, group: 'Commodities' })),
  ...CRYPTO_IDS.map(e => ({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' })),
  ...SECTORS.map(s => ({ symbol: s.symbol, name: s.name, group: 'Sectors' })),
];

// The expensive history + precomputed date slices, cached in module memory so only
// the FIRST sweep call on a warm instance pays the fetch; later calls go straight to
// trials. Keyed by the active-stocks signature.
interface Prepared { universe: BtMeta[]; slices: DateSlice[]; ts: number }
const prepCache = new Map<string, Prepared>();
const PREP_TTL = 30 * 60_000;

async function prepare(stocks: string[], sliceOpts: SliceOpts): Promise<Prepared> {
  const baseSet = new Set(BASE_UNIVERSE.map(m => m.symbol));
  const uniqStocks = [...new Set(stocks)].filter(s => s && !baseSet.has(s));
  const key = `${uniqStocks.slice().sort().join(',')}|${sliceOpts.fwd}_${sliceOpts.kwin}_${sliceOpts.step}_${sliceOpts.maxDays}`;
  const hit = prepCache.get(key);
  if (hit && Date.now() - hit.ts < PREP_TTL) return hit;

  const universe: BtMeta[] = [...BASE_UNIVERSE, ...uniqStocks.map(s => ({ symbol: s, name: s, group: 'Stocks' }))];
  const from = subDays(new Date(), sliceOpts.maxDays + 365 + 150);
  const to = new Date();
  const results = await Promise.allSettled(universe.map(m => fetchYahooChart(m.symbol, from, to, '1d').catch(() => [] as Hist)));
  const histMap = new Map<string, Hist>();
  universe.forEach((m, i) => histMap.set(m.symbol, results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<Hist>).value : []));
  const slices = buildSlices(universe, histMap, sliceOpts);
  const prep: Prepared = { universe, slices, ts: Date.now() };
  prepCache.set(key, prep);
  return prep;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: { stocks?: string[]; best?: ModelParams; sliceOpts?: Partial<SliceOpts> } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const sliceOpts: SliceOpts = { ...DEFAULT_SLICE_OPTS, ...(body.sliceOpts ?? {}) };
  const stocks = Array.isArray(body.stocks) ? body.stocks : [];

  const prep = await prepare(stocks, sliceOpts);
  const usable = [...new Set(prep.slices.flatMap(s => s.inputs.map(i => i.symbol)))].length;
  const dataReady = prep.slices.length > 0 && prep.slices.some(s => s.winners.size > 0);

  // Baseline (live model) eval — cheap, recomputed each call so the client always
  // has the current comparison even on a fresh instance.
  const baseline = evaluate(prep.slices, DEFAULT_PARAMS, sliceOpts.kwin, ACCEL_MAX);

  // Seed the search from the incoming best (carried by the client across calls so
  // progress accumulates even when a cold instance handles the next request).
  const incoming = body.best ? { ...DEFAULT_PARAMS, ...body.best } : DEFAULT_PARAMS;
  const startBest = { params: incoming, e: evaluate(prep.slices, incoming, sliceOpts.kwin, ACCEL_MAX) };

  // Run trials with whatever time remains under maxDuration (minus margin for fetch
  // + serialization). On a cold instance that spent most of the budget fetching, this
  // may be small or zero — the client just calls again against the now-warm cache.
  const elapsed = Date.now() - t0;
  const budgetMs = Math.max(0, maxDuration * 1000 - elapsed - 6000);
  const { best, trials } = budgetMs > 200 && dataReady
    ? runBatch(prep.slices, startBest, { budgetMs, kwin: sliceOpts.kwin, npicks: ACCEL_MAX })
    : { best: startBest, trials: 0 };

  return NextResponse.json({
    ok: true,
    dataReady,
    universeSize: prep.universe.length,
    symbolsWithData: usable,
    dates: prep.slices.length,
    fetchMs: elapsed,
    trials,
    baseline,
    best: { params: best.params, eval: best.e },
  });
}
