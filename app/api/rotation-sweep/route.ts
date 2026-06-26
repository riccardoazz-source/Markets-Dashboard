import { NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { BtMeta, Hist } from '@/lib/backtestCore';
import { buildSlices, SPX, SliceOpts, DEFAULT_SLICE_OPTS } from '@/lib/sweepCore';

// The ONLY job of this route is to download the market history ONCE and hand back
// the precomputed as-of date slices (inputs + forward winners). The actual sweep —
// generating thousands of parameter sets and re-scoring them — runs in the BROWSER,
// because that is microsecond-cheap pure math and needs no server time budget.
//
// Edge runtime + the same fetch path as /api/rotation-backtest (which is proven to
// reach Yahoo); the old nodejs runtime is what failed to download data.
export const runtime = 'edge';

const BASE_UNIVERSE: BtMeta[] = [
  { symbol: SPX, name: 'S&P 500', group: 'Indexes' },
  ...INDEXES.map(i => ({ symbol: i.symbol, name: i.name, group: 'Indexes' })),
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, group: 'Commodities' })),
  ...CRYPTO_IDS.map(e => ({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' })),
  ...SECTORS.map(s => ({ symbol: s.symbol, name: s.name, group: 'Sectors' })),
];

// Serialized slice (Map/Set aren't JSON — send arrays, rehydrate on the client).
interface WireWindow { horizonDays: number; fwd: [string, number][]; winners: string[]; spxFwd: number | null }
interface WireSlice {
  asOf: string;
  inputs: ReturnType<typeof buildSlices>[number]['inputs'];
  windows: WireWindow[];
}
interface Prepared { universeSize: number; symbolsWithData: number; slices: WireSlice[]; ts: number }

const prepCache = new Map<string, Prepared>();
const PREP_TTL = 30 * 60_000;

async function prepare(stocks: string[], sliceOpts: SliceOpts): Promise<Prepared> {
  const baseSet = new Set(BASE_UNIVERSE.map(m => m.symbol));
  const uniqStocks = [...new Set(stocks)].filter(s => s && !baseSet.has(s));
  const key = `${uniqStocks.slice().sort().join(',')}|${sliceOpts.minBack}_${sliceOpts.kwin}_${sliceOpts.step}_${sliceOpts.maxDays}_${sliceOpts.nFwd}`;
  const hit = prepCache.get(key);
  if (hit && Date.now() - hit.ts < PREP_TTL) return hit;

  const universe: BtMeta[] = [...BASE_UNIVERSE, ...uniqStocks.map(s => ({ symbol: s, name: s, group: 'Stocks' }))];
  const from = subDays(new Date(), sliceOpts.maxDays + 365 + 150);
  const to = new Date();
  const results = await Promise.allSettled(universe.map(m => fetchYahooChart(m.symbol, from, to, '1d').catch(() => [] as Hist)));
  const histMap = new Map<string, Hist>();
  universe.forEach((m, i) => histMap.set(m.symbol, results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<Hist>).value : []));

  const slices = buildSlices(universe, histMap, sliceOpts);
  const symbolsWithData = [...new Set(slices.flatMap(s => s.inputs.filter(i => i.r1m != null).map(i => i.symbol)))].length;
  const wire: WireSlice[] = slices.map(s => ({
    asOf: s.asOf,
    inputs: s.inputs,
    windows: s.windows.map(w => ({
      horizonDays: w.horizonDays,
      fwd: [...w.fwd.entries()],
      winners: [...w.winners],
      spxFwd: w.spxFwd,
    })),
  }));
  const prep: Prepared = { universeSize: universe.length, symbolsWithData, slices: wire, ts: Date.now() };
  prepCache.set(key, prep);
  return prep;
}

export async function POST(req: Request) {
  let body: { stocks?: string[]; sliceOpts?: Partial<SliceOpts> } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const sliceOpts: SliceOpts = { ...DEFAULT_SLICE_OPTS, ...(body.sliceOpts ?? {}) };
  const stocks = Array.isArray(body.stocks) ? body.stocks : [];

  const prep = await prepare(stocks, sliceOpts);
  return NextResponse.json({
    ok: true,
    universeSize: prep.universeSize,
    symbolsWithData: prep.symbolsWithData,
    dates: prep.slices.length,
    kwin: sliceOpts.kwin,
    slices: prep.slices,
  });
}
