/**
 * Massive backtest — parameter sweep (CLI, for local use where Yahoo is reachable).
 *
 * The slow part is downloading Yahoo history; the formula is microseconds. So download
 * the universe ONCE (cached to disk), precompute the ~monthly as-of slices ONCE, then
 * re-score thousands of parameter sets. Fitness = AVERAGE capture across ALL dates
 * (anti-overfit), not the 6 visible ones. Shares lib/sweepCore with the in-app route.
 *
 * Run:  npx tsx scripts/sweep.ts
 *       TRIALS=5000 FWD=180 KWIN=25 STEP=30 npx tsx scripts/sweep.ts
 *       SP500=1 npx tsx scripts/sweep.ts    (include all S&P 500 names — slow first fetch)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '../lib/config';
import { fetchYahooChart } from '../lib/yahoo';
import { fetchSp500 } from '../lib/sp500';
import { DEFAULT_PARAMS, ModelParams, ACCEL_MAX } from '../lib/rotationModel';
import { fmt, BtMeta, Hist } from '../lib/backtestCore';
import { buildSlices, evaluate, sampleParams, precomputeFeatures, SPX, SliceOpts } from '../lib/sweepCore';

const CACHE_DIR = process.env.SCRATCH ?? '.';
const MINBACK = Number(process.env.MINBACK ?? 30);
const NFWD = Number(process.env.NFWD ?? 4);     // random forward windows per past date
const MINFWD = Number(process.env.MINFWD ?? 25); // shortest forward horizon (days)
const KWIN = Number(process.env.KWIN ?? 25);
const NPICKS = Number(process.env.NPICKS ?? ACCEL_MAX);
const TRIALS = Number(process.env.TRIALS ?? 1000);
const STEP = Number(process.env.STEP ?? 30);
const MAXDAYS = 5 * 365 + 120;
const FETCH_CONC = 8;
const SLICE_OPTS: SliceOpts = { minBack: MINBACK, kwin: KWIN, step: STEP, maxDays: MAXDAYS, nFwd: NFWD, minFwd: MINFWD };

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
    return new Map(Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, Hist>));
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

async function main() {
  const to = new Date();
  const from = subDays(to, MAXDAYS + 365 + 150);
  const sp500 = process.env.SP500 ? await fetchSp500().catch(() => []) : [];
  const universe = buildUniverse(sp500);
  console.log(`[universe] ${universe.length} symbols | nFwd=${NFWD} minFwd=${MINFWD}d K=${KWIN} picks=${NPICKS} step=${STEP}d trials=${TRIALS}`);

  const histMap = await fetchAll(universe, from, to);
  const have = [...histMap.values()].filter(h => h.length > 50).length;
  console.log(`[data] ${have}/${universe.length} symbols with usable history`);

  const slices = buildSlices(universe, histMap, SLICE_OPTS);
  precomputeFeatures(slices); // compute per-date percentile features ONCE → fast trials
  console.log(`[slices] ${slices.length} dates from ${slices[slices.length-1]?.asOf} to ${slices[0]?.asOf}`);

  const byH = (e: ReturnType<typeof evaluate>) =>
    (['1m','3m','6m','1y','5y'] as const).map(h => `${h}:${(e.byHorizon[h].capture*100).toFixed(0)}%(${e.byHorizon[h].n})`).join(' ');

  const base = evaluate(slices, DEFAULT_PARAMS, KWIN, NPICKS);
  console.log(`\n=== BASELINE (live model) ===`);
  console.log(`capture=${(base.capture*100).toFixed(1)}% (weighted) flat=${(base.captureFlat*100).toFixed(1)}%  beatSPX=${(base.beatSpx*100).toFixed(0)}%  basket−SPX=${base.basketVsSpx.toFixed(1)}pp  over ${base.nDates} dates`);
  console.log(`per-horizon: ${byH(base)}`);

  console.log(`\n[sweep] ${TRIALS} parameter sets…`);
  const results: { p: ModelParams; e: ReturnType<typeof evaluate> }[] = [{ p: DEFAULT_PARAMS, e: base }];
  let best = results[0];
  for (let t = 0; t < TRIALS; t++) {
    const around = Math.random() < 0.4 ? best.p : undefined;
    const p = sampleParams(around, 0.2);
    const e = evaluate(slices, p, KWIN, NPICKS);
    results.push({ p, e });
    if (e.fitness > best.e.fitness || (e.fitness === best.e.fitness && e.basketVsSpx > best.e.basketVsSpx)) best = { p, e };
    if ((t + 1) % 200 === 0) console.log(`[sweep] ${t + 1}/${TRIALS}  best fitness=${(best.e.fitness*100).toFixed(1)} capture=${(best.e.capture*100).toFixed(1)}%`);
  }
  results.sort((a, b) => (b.e.fitness - a.e.fitness) || (b.e.basketVsSpx - a.e.basketVsSpx));

  console.log(`\n=== TOP 10 by fitness (capture × loss aversion) ===`);
  results.slice(0, 10).forEach((r, i) => {
    const tag = r.p === DEFAULT_PARAMS ? ' (BASELINE)' : '';
    console.log(`#${i+1} fitness=${(r.e.fitness*100).toFixed(1)}  capture=${(r.e.capture*100).toFixed(1)}%  beatFactor=${(r.e.beatFactor*100).toFixed(0)}%  basket−SPX=${r.e.basketVsSpx.toFixed(1)}pp${tag}`);
    console.log(`     per-horizon: ${byH(r.e)}`);
  });

  const out = `${CACHE_DIR}/sweep-best.json`;
  writeFileSync(out, JSON.stringify({ baseline: base, best: results[0].e, params: results[0].p }, null, 2));
  console.log(`\n[best params] → ${out}`);
  console.log(JSON.stringify(results[0].p, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
