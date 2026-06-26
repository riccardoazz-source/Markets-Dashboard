// ── Sweep core — shared by the offline script AND the Vercel sweep route ─────
// One implementation of: build the as-of date grid (with forward winners),
// evaluate a parameter set across ALL dates, and sample parameter sets. Both the
// CLI sweep (scripts/sweep.ts) and the in-app optimizer (/api/rotation-sweep)
// import from here so they tune the exact same way.
import { subDays } from 'date-fns';
import { computeRotationFeatures, scoreFromFeatures, selectPicks, ModelParams, DEFAULT_PARAMS, ACCEL_MAX, PRE_BREAKOUT_SLOTS, RotationFeature } from './rotationModel';
import { buildInputsAsOf, retBetween, fmt, BtMeta, BtInput, Hist } from './backtestCore';

export const SPX = '^GSPC';

// ── The objective, exactly as described ──────────────────────────────────────
// You are at a RANDOM date in the past. From there you look to a RANDOM date in
// the future (still ≤ today, since that's all the data we have). Over that span,
// WHO WON = the names with the biggest returns (top-K). The model, using only data
// up to the past date, makes its picks; a pick "hits" if it's among those winners.
// Fitness = fraction of winners intercepted, averaged over MANY such (past→future)
// pairs. The sweep then perturbs ALL params together at random and keeps whatever
// combination intercepts the most winners.
//
// Each past date carries SEVERAL random forward windows (a short, a medium, a long
// one), so one as-of date is judged against several different futures — that's the
// "random future dates" part, and it stops the score from overfitting to a single
// endpoint. Inputs are scored ONCE per past date (they don't depend on the future),
// then checked against every window — cheap.
export interface SliceOpts { minBack: number; kwin: number; step: number; maxDays: number; nFwd: number; minFwd: number }
// Dense by design: a past date every ~3 weeks over ~6 years (≈100 as-of dates), each
// with 6 random futures ≈ 600 (past→future) winner-tests. More dates = a fitness that
// can't be gamed by luck on a few lucky periods; the model must catch winners broadly.
export const DEFAULT_SLICE_OPTS: SliceOpts = { minBack: 25, kwin: 25, step: 21, maxDays: 6 * 365, nFwd: 6, minFwd: 21 };

// One random future relative to a past date: who won, and by how much.
export interface ForwardWindow {
  horizonDays: number;
  fwd: Map<string, number>;   // symbol -> return over THIS window
  winners: Set<string>;       // top-K by that return
  spxFwd: number | null;
}
export interface DateSlice {
  asOf: string;
  inputs: ReturnType<typeof buildInputsAsOf>;
  windows: ForwardWindow[];   // several random futures from this past date
  features?: RotationFeature<BtInput>[]; // param-independent percentiles, computed ONCE (see precomputeFeatures)
}

// Compute each date's param-independent percentile features ONCE so the sweep's
// per-trial cost collapses to pure arithmetic. Call after the slices are built
// (CLI) or rehydrated from the wire (browser), before running trials.
export function precomputeFeatures(slices: DateSlice[]): void {
  for (const sl of slices) sl.features = computeRotationFeatures(sl.inputs);
}

function buildWindow(universe: BtMeta[], histMap: Map<string, Hist>, asOfStr: string, fwdStr: string, horizonDays: number, kwin: number): ForwardWindow {
  const fwd = new Map<string, number>();
  for (const m of universe) {
    const h = histMap.get(m.symbol) ?? [];
    const r = retBetween(h, asOfStr, fwdStr);
    if (r != null) fwd.set(m.symbol, r);
  }
  const ranked = [...fwd.entries()].filter(([s]) => s !== SPX).sort((a, b) => b[1] - a[1]);
  const winners = new Set(ranked.slice(0, kwin).map(([s]) => s));
  return { horizonDays, fwd, winners, spxFwd: fwd.get(SPX) ?? null };
}

// Precompute, ONCE per past date: model inputs + a handful of RANDOM forward
// windows (each with its own winners). Parameter sweeps reuse these — only the
// (cheap) re-scoring varies.
export function buildSlices(universe: BtMeta[], histMap: Map<string, Hist>, opts: SliceOpts = DEFAULT_SLICE_OPTS): DateSlice[] {
  const { minBack, kwin: KWIN, step: STEP, maxDays, nFwd, minFwd } = opts;
  const today = new Date();
  const slices: DateSlice[] = [];
  for (let days = minBack; days <= maxDays; days += STEP) {
    const asOfDate = subDays(today, days);
    const asOfStr = fmt(asOfDate);
    const inputs = buildInputsAsOf(universe, histMap, asOfDate);
    const span = days - minFwd; // largest forward horizon available from this date
    const windows: ForwardWindow[] = [];
    if (span > 0) {
      // Stratified-random horizons: split [minFwd, days] into nFwd bands, pick one
      // random horizon in each. Near-today dates only get short futures; deep-past
      // dates get everything up to multi-year — exactly the real shape.
      for (let k = 0; k < nFwd; k++) {
        const frac = (k + Math.random()) / nFwd;
        const horizon = Math.round(minFwd + frac * span);
        const fwdStr = fmt(subDays(today, Math.max(0, days - horizon)));
        windows.push(buildWindow(universe, histMap, asOfStr, fwdStr, horizon, KWIN));
      }
    }
    slices.push({ asOf: asOfStr, inputs, windows });
  }
  return slices;
}

export interface SweepEval { capture: number; beatSpx: number; basketVsSpx: number; nDates: number }

export function evaluate(slices: DateSlice[], params: ModelParams, kwin = 25, npicks = ACCEL_MAX): SweepEval {
  let capSum = 0, capN = 0, beatSum = 0, basketVsSpxSum = 0, nWithSpx = 0;
  for (const sl of slices) {
    if (sl.windows.length === 0) continue;
    // Score the past date ONCE — picks don't depend on which future we measure. Use the
    // precomputed features when available (the per-trial fast path); fall back otherwise.
    const scored = sl.features
      ? scoreFromFeatures(sl.features, params)
      : scoreFromFeatures(computeRotationFeatures(sl.inputs), params);
    const picks = selectPicks(scored, npicks, PRE_BREAKOUT_SLOTS).map(s => s.item.symbol).filter(s => s !== SPX);
    for (const w of sl.windows) {
      let hits = 0, fwdSum = 0, fwdN = 0;
      for (const sym of picks) {
        if (w.winners.has(sym)) hits++;
        const f = w.fwd.get(sym);
        if (f != null) { fwdSum += f; fwdN++; }
      }
      capSum += hits / kwin; capN++;
      if (w.spxFwd != null && fwdN > 0) {
        const basket = fwdSum / fwdN;
        basketVsSpxSum += basket - w.spxFwd;
        if (basket > w.spxFwd) beatSum++;
        nWithSpx++;
      }
    }
  }
  return {
    capture: capN ? capSum / capN : 0,
    beatSpx: nWithSpx ? beatSum / nWithSpx : 0,
    basketVsSpx: nWithSpx ? basketVsSpxSum / nWithSpx : 0,
    nDates: slices.length,
  };
}

// Sweep bounds per parameter — centred near the live values, wide enough to explore.
export const BOUNDS: Record<keyof ModelParams, [number, number]> = {
  wAcc: [0.15, 0.45], wVQ: [0.10, 0.35], wTrend: [0.0, 0.20], wCycle: [0.0, 0.16],
  wLead: [0.04, 0.28], wRegime: [0.0, 0.10], wVolume: [0.0, 0.08], wMacd: [0.0, 0.08],
  wExt: [0.05, 0.35], overheatCyclical: [0.0, 0.25], overheatDefault: [0.0, 0.10],
  reboundWeight: [0.0, 0.50], cyclicalVqDiscount: [0.30, 1.0], lowVqFloor: [0.0, 0.60],
  lowVqWeight: [0.0, 0.50], secularLow: [0.40, 0.70], secularHigh: [0.70, 0.90],
  commodityExtWeight: [0.20, 0.45],
};

const KEYS = Object.keys(BOUNDS) as (keyof ModelParams)[];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Sample a parameter set. With `around`, do a LOCAL perturbation (refine the current
// best) of fractional size `jitter` of each range; without, a GLOBAL uniform draw.
export function sampleParams(around?: ModelParams, jitter = 0.25): ModelParams {
  const p = { ...(around ?? DEFAULT_PARAMS) };
  for (const k of KEYS) {
    const [lo, hi] = BOUNDS[k];
    if (around) {
      const span = (hi - lo) * jitter;
      p[k] = clamp(around[k] + (Math.random() * 2 - 1) * span, lo, hi);
    } else {
      p[k] = lo + Math.random() * (hi - lo);
    }
  }
  if (p.secularHigh <= p.secularLow + 0.05) p.secularHigh = clamp(p.secularLow + 0.1, 0.7, 0.9);
  return p;
}

// Run a batch of trials within a wall-clock budget, refining around `best`. Returns the
// best params/eval found (including the incoming best) and how many trials were run.
export function runBatch(
  slices: DateSlice[],
  startBest: { params: ModelParams; e: SweepEval },
  opts: { budgetMs: number; kwin: number; npicks: number },
): { best: { params: ModelParams; e: SweepEval }; trials: number } {
  const deadline = Date.now() + opts.budgetMs;
  let best = startBest;
  let trials = 0;
  while (Date.now() < deadline) {
    // 60% explore globally, 40% refine around the current best
    const around = Math.random() < 0.4 ? best.params : undefined;
    const p = sampleParams(around, 0.2);
    const e = evaluate(slices, p, opts.kwin, opts.npicks);
    trials++;
    if (e.capture > best.e.capture || (e.capture === best.e.capture && e.basketVsSpx > best.e.basketVsSpx)) {
      best = { params: p, e };
    }
  }
  return { best, trials };
}
