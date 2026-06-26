/**
 * Massive backtest — parameter sweep.
 *
 * Idea: the SLOW part is downloading Yahoo history; the formula itself is microseconds.
 * So we download the universe ONCE (cached to disk), precompute the as-of inputs for a
 * grid of ~monthly dates ONCE, and then re-score thousands of parameter combinations
 * against those cached inputs. Fitness = AVERAGE capture across ALL dates (not the 6
 * visible ones) so we don't overfit to a handful of lucky dates.
 *
 * Run:  npx tsx scripts/sweep.ts            (default: ~400 trials)
 *       TRIALS=2000 FWD=180 KWIN=25 npx tsx scripts/sweep.ts
 *       SP500=1 npx tsx scripts/sweep.ts    (include all S&P 500 names — slow first fetch)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '../lib/config';
import { fetchYahooChart } from '../lib/yahoo';
import { fetchSp500 } from '../lib/sp500';
import { scoreRotation, selectPicks, DEFAULT_PARAMS, ModelParams, ACCEL_MAX, PRE_BREAKOUT_SLOTS } from '../lib/rotationModel';
import { buildInputsAsOf, retBetween, fmt, BtMeta, Hist } from '../lib/backtestCore';

const SPX = '^GSPC';
const CACHE_DIR = process.env.SCRATCH ?? '/tmp/claude-0/-home-user-Markets-Dashboard/6439b64d-173c-5f3a-aa2a-28f34c28842d/scratchpad';
const FWD = Number(process.env.FWD ?? 180);     // forward window in calendar days
const KWIN = Number(process.env.KWIN ?? 25);    // size of the "who actually won" leaderboard
const NPICKS = Number(process.env.NPICKS ?? ACCEL_MAX);
const TRIALS = Number(process.env.TRIALS ?? 400);
const STEP = Number(process.env.STEP ?? 30);    // days between as-of dates
const FETCH_CONC = 8;

// Curated individual names that show up in the user's lists / screenshots — the
// winners and losers the model is actually judged on. (S&P 500 adds the rest via SP500=1.)
const CURATED = ['MU','AVGO','NVDA','AMD','CRDO','RIOT','CIFR','WULF','IREN','SNDK','META','PLTR',
  'GOOG','MSFT','INTU','ADBE','TSM','AAPL','AMZN','TSLA','SMCI','MRVL','ARM','ASML','QCOM','NOK',
  'PANW','CRWD','NET','SHOP','COIN','MSTR','SOFI','DELL','ANET','VRT','NBIS','APP','ORCL','CEG'];

function buildUniverse(sp500: { symbol: string; name: string }[]): BtMeta[] {
  const seen = new Set<string>();
  const u: BtMeta[] = [];
  const add = (m: BtMeta) => { if (!seen.has(m.symbol)) { seen.add(m.symbol); u.push(m); } };
  add({ symbol: SPX, name: 'S&P 500', group: 'Indexes' });
  INDEXES.forEach(i => add({ symbol: i.symbol, name: i.name, group: 'Indexes' }));
  COMMODITIES.forEach(c => add({ symbol: c.symbol, name: c.name, group: 'Commodities' }));
  CRYPTO_IDS.forEach(e => add({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' }));
  SECTORS.forEach(s => add({ symbol: s.symbol, name: s.name, group: 'Sectors' }));
  CURATED.forEach(s => add({ symbol: s, name: s, group: 'Stocks' }));
  sp500.forEach(s => add({ symbol: s.symbol, name: s.name, group: 'Stocks' }));
  return u;
}

async function fetchAll(universe: BtMeta[], from: Date, to: Date): Promise<Map<string, Hist>> {
  const sig = `${universe.length}_${fmt(from)}_${fmt(to)}`;
  const cacheFile = `${CACHE_DIR}/hist-${sig}.json`;
  if (existsSync(cacheFile)) {
    console.log(`[cache] loading ${cacheFile}`);
    const raw = JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, Hist>;
    return new Map(Object.entries(raw));
  }
  console.log(`[fetch] downloading ${universe.length} symbols (once)…`);
  const map = new Map<string, Hist>();
  let done = 0;
  for (let i = 0; i < universe.length; i += FETCH_CONC) {
    const batch = universe.slice(i, i + FETCH_CONC);
    await Promise.all(batch.map(async m => {
      try {
        const pts = await fetchYahooChart(m.symbol, from, to, '1d');
        map.set(m.symbol, pts.map(p => ({ date: p.date, close: p.close })));
      } catch { map.set(m.symbol, []); }
    }));
    done += batch.length;
    if (done % 40 === 0 || done >= universe.length) console.log(`[fetch] ${done}/${universe.length}`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(map)));
  console.log(`[cache] saved ${cacheFile}`);
  return map;
}

// Precompute, ONCE per as-of date: the model inputs + each asset's forward return +
// the set of actual top-K winners. Param sweeps reuse this — only re-scoring changes.
interface DateSlice {
  asOf: string;
  inputs: ReturnType<typeof buildInputsAsOf>;
  fwd: Map<string, number>;     // symbol -> forward return %
  winners: Set<string>;         // top-K by forward return
  spxFwd: number | null;
}

function buildSlices(universe: BtMeta[], histMap: Map<string, Hist>): DateSlice[] {
  const today = new Date();
  const slices: DateSlice[] = [];
  // as-of dates from (FWD+buffer) ago back to ~5.4y ago, stepping monthly
  for (let days = FWD + 5; days <= 5 * 365 + 120; days += STEP) {
    const asOfDate = subDays(today, days);
    const fwdDate = subDays(today, days - FWD);
    const inputs = buildInputsAsOf(universe, histMap, asOfDate);
    const fwd = new Map<string, number>();
    for (const m of universe) {
      const h = histMap.get(m.symbol) ?? [];
      const r = retBetween(h, fmt(asOfDate), fmt(fwdDate));
      if (r != null) fwd.set(m.symbol, r);
    }
    // winners = top-K forward performers among names that have forward data
    const ranked = [...fwd.entries()].filter(([s]) => s !== SPX).sort((a, b) => b[1] - a[1]);
    const winners = new Set(ranked.slice(0, KWIN).map(([s]) => s));
    slices.push({ asOf: fmt(asOfDate), inputs, fwd, winners, spxFwd: fwd.get(SPX) ?? null });
  }
  return slices;
}

interface Eval { capture: number; beatSpx: number; basketVsSpx: number; nDates: number }

function evaluate(slices: DateSlice[], params: ModelParams): Eval {
  let capSum = 0, beatSum = 0, basketVsSpxSum = 0, nWithSpx = 0;
  for (const sl of slices) {
    const scored = scoreRotation(sl.inputs, params);
    const picks = selectPicks(scored, NPICKS, PRE_BREAKOUT_SLOTS).map(s => s.item.symbol)
      .filter(s => s !== SPX);
    let hits = 0, fwdSum = 0, fwdN = 0;
    for (const sym of picks) {
      if (sl.winners.has(sym)) hits++;
      const f = sl.fwd.get(sym);
      if (f != null) { fwdSum += f; fwdN++; }
    }
    capSum += hits / KWIN;
    if (sl.spxFwd != null && fwdN > 0) {
      const basket = fwdSum / fwdN;
      basketVsSpxSum += basket - sl.spxFwd;
      if (basket > sl.spxFwd) beatSum++;
      nWithSpx++;
    }
  }
  const n = slices.length;
  return {
    capture: capSum / n,
    beatSpx: nWithSpx ? beatSum / nWithSpx : 0,
    basketVsSpx: nWithSpx ? basketVsSpxSum / nWithSpx : 0,
    nDates: n,
  };
}

// Sweep bounds per parameter — centred near the live values but wide enough to explore.
const BOUNDS: Record<keyof ModelParams, [number, number]> = {
  wAcc: [0.15, 0.45], wVQ: [0.10, 0.35], wTrend: [0.0, 0.20], wCycle: [0.0, 0.16],
  wLead: [0.04, 0.28], wRegime: [0.0, 0.10], wVolume: [0.0, 0.08], wMacd: [0.0, 0.08],
  wExt: [0.05, 0.35], overheatCyclical: [0.0, 0.25], overheatDefault: [0.0, 0.10],
  reboundWeight: [0.0, 0.50], cyclicalVqDiscount: [0.30, 1.0], lowVqFloor: [0.0, 0.60],
  lowVqWeight: [0.0, 0.50], secularLow: [0.40, 0.70], secularHigh: [0.70, 0.90],
  commodityExtWeight: [0.20, 0.45],
};

function sampleParams(): ModelParams {
  const p = { ...DEFAULT_PARAMS };
  for (const k of Object.keys(BOUNDS) as (keyof ModelParams)[]) {
    const [lo, hi] = BOUNDS[k];
    p[k] = lo + Math.random() * (hi - lo);
  }
  if (p.secularHigh <= p.secularLow + 0.05) p.secularHigh = p.secularLow + 0.1; // keep ramp valid
  return p;
}

async function main() {
  const to = new Date();
  const from = subDays(to, 5 * 365 + 120 + 400); // enough history for the oldest 1y lookback
  const sp500 = process.env.SP500 ? await fetchSp500().catch(() => []) : [];
  const universe = buildUniverse(sp500);
  console.log(`[universe] ${universe.length} symbols  | FWD=${FWD}d K=${KWIN} picks=${NPICKS} step=${STEP}d trials=${TRIALS}`);

  const histMap = await fetchAll(universe, from, to);
  const have = [...histMap.values()].filter(h => h.length > 50).length;
  console.log(`[data] ${have}/${universe.length} symbols with usable history`);

  console.log(`[slices] building as-of date grid…`);
  const slices = buildSlices(universe, histMap);
  console.log(`[slices] ${slices.length} backtest dates from ${slices[slices.length-1].asOf} to ${slices[0].asOf}`);

  const base = evaluate(slices, DEFAULT_PARAMS);
  console.log(`\n=== BASELINE (live model M23) ===`);
  console.log(`capture=${(base.capture*100).toFixed(1)}%  beatSPX=${(base.beatSpx*100).toFixed(0)}%  basket−SPX=${base.basketVsSpx.toFixed(1)}pp  over ${base.nDates} dates`);

  console.log(`\n[sweep] ${TRIALS} random parameter sets…`);
  const results: { p: ModelParams; e: Eval }[] = [{ p: DEFAULT_PARAMS, e: base }];
  for (let t = 0; t < TRIALS; t++) {
    const p = sampleParams();
    results.push({ p, e: evaluate(slices, p) });
    if ((t + 1) % 100 === 0) console.log(`[sweep] ${t + 1}/${TRIALS}`);
  }
  // Rank by capture, tie-break by basket-vs-SPX
  results.sort((a, b) => (b.e.capture - a.e.capture) || (b.e.basketVsSpx - a.e.basketVsSpx));

  console.log(`\n=== TOP 10 by mean capture ===`);
  results.slice(0, 10).forEach((r, i) => {
    const tag = r.p === DEFAULT_PARAMS ? ' (BASELINE)' : '';
    console.log(`#${i+1} capture=${(r.e.capture*100).toFixed(1)}%  beatSPX=${(r.e.beatSpx*100).toFixed(0)}%  basket−SPX=${r.e.basketVsSpx.toFixed(1)}pp${tag}`);
  });

  const best = results[0];
  const out = `${CACHE_DIR}/sweep-best.json`;
  writeFileSync(out, JSON.stringify({ baseline: base, best: best.e, params: best.p, bounds: BOUNDS }, null, 2));
  console.log(`\n[best params] written to ${out}`);
  console.log(JSON.stringify(best.p, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
