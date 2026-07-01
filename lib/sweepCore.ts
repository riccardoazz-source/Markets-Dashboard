// ── Sweep core — shared by the offline script AND the Vercel sweep route ─────
// One implementation of: build the as-of date grid (with forward winners),
// evaluate a parameter set across ALL dates, and sample parameter sets. Both the
// CLI sweep (scripts/sweep.ts) and the in-app optimizer (/api/rotation-sweep)
// import from here so they tune the exact same way.
import { subDays } from 'date-fns';
import { computeRotationFeatures, scoreFromFeatures, selectPicks, ModelParams, DEFAULT_PARAMS, ACCEL_MAX, RotationFeature } from './rotationModel';
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
// nFwd raised 6→9: with the horizon-WEIGHTED objective the long buckets (1Y/5Y)
// carry the most weight, so they need enough windows to not be noise. More forward
// draws per deep-past date fills the 1Y/5Y buckets densely; the per-trial cost is
// unchanged (scoring is once-per-date, windows are a cheap inner loop).
export const DEFAULT_SLICE_OPTS: SliceOpts = { minBack: 25, kwin: 25, step: 21, maxDays: 6 * 365, nFwd: 9, minFwd: 21 };

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

// ── Horizon buckets ─────────────────────────────────────────────────────────
// The live backtest CARDS judge the model at five fixed horizons (1M…5Y) and the
// reliability score weights the LONG ones heaviest (5Y/1Y span full cycles; a
// short window is mostly noise). The old objective took a FLAT average over all
// random forward windows — but those windows are overwhelmingly SHORT (only the
// deepest-past dates can host a multi-year window), so the flat average was ~98%
// driven by short horizons. The optimizer then happily traded away the rare
// multi-year monster-winners (MU +1379%, AVGO +719%) for marginal short-horizon
// gains — "winning" on a number disconnected from the cards. We now bucket each
// window by its horizon and weight it EXACTLY like the cards' reliability score,
// so optimizing this capture optimizes what the user actually reads.
export type HorizonKey = '1m' | '3m' | '6m' | '1y' | '5y';
const HORIZON_ORDER: HorizonKey[] = ['1m', '3m', '6m', '1y', '5y'];
// Same spirit as modelVersions PERIOD_WEIGHTS, renormalised over the 5 horizons a
// forward window can fall into (1d is excluded — minFwd ≥ 21 days).
export const HORIZON_WEIGHTS: Record<HorizonKey, number> = {
  '1m': 0.10, '3m': 0.20, '6m': 0.20, '1y': 0.25, '5y': 0.25,
};
function horizonBucket(days: number): HorizonKey {
  if (days < 45) return '1m';
  if (days < 135) return '3m';
  if (days < 270) return '6m';
  if (days < 540) return '1y';
  return '5y';
}

// ── Loss aversion (why fitness ≠ capture) ────────────────────────────────────
// Every GUARD in the model (rebound, overheat, blow-off EXT, cyclical-VQ discount)
// exists to AVOID LOSSES, not to catch winners — so each guard costs a little
// capture. A capture-only optimizer therefore STRIPS the guards for free, and then
// a stripped guard lets a blow-off into the picks that craters a specific card
// (M24 bought INTU −47%, ADBE −66% at 5Y). The app's own reliability score already
// solves this: it multiplies capture by a beatFactor that punishes underperforming
// SPX, ASYMMETRICALLY and horizon-scaled — a 5Y loss is catastrophic, a 1M loss is
// noise. fitness mirrors that score, so the optimizer can no longer remove a guard
// whose job is to prevent a 5Y blow-off without tanking its own number. Same numbers
// as modelVersions PERIOD_LOSS_SEVERITY.
const HORIZON_LOSS_SEVERITY: Record<HorizonKey, number> = {
  '1m': 0.6, '3m': 1.0, '6m': 1.5, '1y': 2.5, '5y': 5.0,
};

export interface SweepEval {
  fitness: number;                          // THE OBJECTIVE — capture × loss-averse beatFactor (mirrors the app's reliability score)
  capture: number;                          // HORIZON-WEIGHTED capture (matches the cards)
  captureFlat: number;                      // old flat average, kept for reference
  beatFactor: number;                       // 0..1 — horizon-scaled "did it beat SPX without catastrophic losses"
  beatSpx: number; basketVsSpx: number; nDates: number;
  byHorizon: Record<HorizonKey, { capture: number; n: number }>; // per-card capture so the 5Y/1Y number is VISIBLE
}

export function evaluate(slices: DateSlice[], params: ModelParams, kwin = 25, npicks = ACCEL_MAX): SweepEval {
  let capSum = 0, capN = 0, beatSum = 0, basketVsSpxSum = 0, nWithSpx = 0;
  // Per-horizon accumulators — capture (objective + reporting) and beatScore (loss aversion).
  const hCapSum: Record<HorizonKey, number> = { '1m': 0, '3m': 0, '6m': 0, '1y': 0, '5y': 0 };
  const hCapN:   Record<HorizonKey, number> = { '1m': 0, '3m': 0, '6m': 0, '1y': 0, '5y': 0 };
  const hBeatSum: Record<HorizonKey, number> = { '1m': 0, '3m': 0, '6m': 0, '1y': 0, '5y': 0 };
  const hBeatN:   Record<HorizonKey, number> = { '1m': 0, '3m': 0, '6m': 0, '1y': 0, '5y': 0 };
  for (const sl of slices) {
    if (sl.windows.length === 0) continue;
    // Score the past date ONCE — picks don't depend on which future we measure. Use the
    // precomputed features when available (the per-trial fast path); fall back otherwise.
    const scored = sl.features
      ? scoreFromFeatures(sl.features, params)
      : scoreFromFeatures(computeRotationFeatures(sl.inputs), params);
    // M24: the sleeve slot count is now a tunable param — round to an int, clamp ≥ 0.
    const preSlots = Math.max(0, Math.round(params.preSlots));
    const picks = selectPicks(scored, npicks, preSlots).map(s => s.item.symbol).filter(s => s !== SPX);
    for (const w of sl.windows) {
      let hits = 0, fwdSum = 0, fwdN = 0;
      for (const sym of picks) {
        if (w.winners.has(sym)) hits++;
        const f = w.fwd.get(sym);
        if (f != null) { fwdSum += f; fwdN++; }
      }
      const cap = hits / kwin;
      capSum += cap; capN++;
      const hk = horizonBucket(w.horizonDays);
      hCapSum[hk] += cap; hCapN[hk]++;
      if (w.spxFwd != null && fwdN > 0) {
        const basket = fwdSum / fwdN;
        const alpha = basket - w.spxFwd;
        basketVsSpxSum += alpha;
        if (alpha > 0) beatSum++;
        nWithSpx++;
        // beatScore: WIN = flat +1 (magnitude ignored → one huge pick can't inflate),
        // LOSS = −severity (horizon-scaled: a 5Y miss is catastrophic, a 1M miss noise).
        hBeatSum[hk] += alpha >= 0 ? 1 : -HORIZON_LOSS_SEVERITY[hk];
        hBeatN[hk]++;
      }
    }
  }
  // Horizon-weighted capture AND beatFactor: average WITHIN each bucket, then weight
  // buckets like the cards. A bucket with no windows is dropped (weights renormalise).
  const byHorizon = {} as Record<HorizonKey, { capture: number; n: number }>;
  let wCapSum = 0, wCapW = 0, wBeatSum = 0, wBeatW = 0;
  for (const hk of HORIZON_ORDER) {
    const n = hCapN[hk];
    const c = n ? hCapSum[hk] / n : 0;
    byHorizon[hk] = { capture: c, n };
    if (n > 0) { wCapSum += HORIZON_WEIGHTS[hk] * c; wCapW += HORIZON_WEIGHTS[hk]; }
    if (hBeatN[hk] > 0) { wBeatSum += HORIZON_WEIGHTS[hk] * (hBeatSum[hk] / hBeatN[hk]); wBeatW += HORIZON_WEIGHTS[hk]; }
  }
  const capture = wCapW ? wCapSum / wCapW : 0;
  // beatFactor maps the weighted mean beatScore (∈ [−severity, 1]) into [0,1], exactly
  // like computeReliability: a set that loses badly at 5Y collapses it toward 0.
  const meanBeat = wBeatW ? wBeatSum / wBeatW : 0;
  const beatFactor = Math.max(0, Math.min(1, (meanBeat + 1) / 2));
  return {
    fitness: capture * beatFactor, // capture you keep ONLY IF you also didn't take catastrophic losses
    capture,
    captureFlat: capN ? capSum / capN : 0,
    beatFactor,
    beatSpx: nWithSpx ? beatSum / nWithSpx : 0,
    basketVsSpx: nWithSpx ? basketVsSpxSum / nWithSpx : 0,
    nDates: slices.length,
    byHorizon,
  };
}

// Sweep bounds per parameter — centred near the live values, wide enough to explore.
export const BOUNDS: Record<keyof ModelParams, [number, number]> = {
  wRS: [0.10, 0.45], // M28 — the RS backbone can be tuned but not zeroed out
  wAcc: [0.05, 0.45], wVQ: [0.10, 0.35], wTrend: [0.0, 0.20], wCycle: [0.0, 0.16],
  wLead: [0.04, 0.28], wRegime: [0.0, 0.10], wVolume: [0.0, 0.08], wMacd: [0.0, 0.08],
  wExt: [0.05, 0.35], overheatCyclical: [0.0, 0.25], overheatDefault: [0.0, 0.10],
  reboundWeight: [0.0, 0.50], cyclicalVqDiscount: [0.30, 1.0], lowVqFloor: [0.0, 0.60],
  lowVqWeight: [0.0, 0.50], secularLow: [0.40, 0.70], secularHigh: [0.70, 0.90],
  commodityExtWeight: [0.20, 0.45],
  // M24 — the pre-breakout sleeve, now tunable. Centred on the live M17/M19 values,
  // wide enough to let the optimizer open the sleeve up OR shut it down if it doesn't
  // pay. preSlots is a float here (rounded to an int at use); 0 = sleeve disabled.
  preSlots: [0, 12], prePos52wMin: [0, 45], preR1mFloor: [-55, -10],
  preVqMin: [0.40, 0.85], preCycMin: [0.0, 0.55], preMa200Min: [0.55, 0.92],
  preScorePos: [0.0, 0.6], preScoreCyc: [0.0, 0.7], preScoreVq: [0.0, 0.7],
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

// Coordinate descent: for each parameter in order, scan STEPS evenly-spaced values
// across its full BOUNDS range while holding all other params fixed, keep the best.
// One full pass covers all 18 parameters. Multiple passes refine further.
// Returns per-parameter results so the UI can show which param moved and by how much.
export interface CoordStep {
  key: keyof ModelParams;
  oldVal: number;
  newVal: number;
  oldCapture: number;  // fitness before this param's scan (named *Capture for back-compat with the UI)
  newCapture: number;  // fitness after
}
export function coordinateDescent(
  slices: DateSlice[],
  startParams: ModelParams,
  kwin: number,
  npicks: number,
  stepsPerParam = 80,
): { params: ModelParams; steps: CoordStep[]; finalEval: SweepEval } {
  let p = { ...startParams };
  const steps: CoordStep[] = [];
  for (const k of KEYS) {
    const [lo, hi] = BOUNDS[k];
    const oldVal = p[k];
    // Optimize FITNESS (capture × loss aversion), not raw capture — otherwise the scan
    // would happily zero out a guard to gain a little capture and take blow-off losses.
    const oldFitness = evaluate(slices, p, kwin, npicks).fitness;
    let bestFitness = oldFitness;
    let bestVal = oldVal;
    for (let i = 0; i <= stepsPerParam; i++) {
      const v = lo + (i / stepsPerParam) * (hi - lo);
      const candidate = { ...p, [k]: v };
      // Enforce secularHigh > secularLow + 0.05
      if (k === 'secularLow' && candidate.secularHigh <= v + 0.05) candidate.secularHigh = Math.min(v + 0.1, 0.9);
      if (k === 'secularHigh' && v <= p.secularLow + 0.05) continue;
      const f = evaluate(slices, candidate, kwin, npicks).fitness;
      if (f > bestFitness) { bestFitness = f; bestVal = v; }
    }
    p = { ...p, [k]: bestVal };
    steps.push({ key: k, oldVal, newVal: bestVal, oldCapture: oldFitness, newCapture: bestFitness });
  }
  return { params: p, steps, finalEval: evaluate(slices, p, kwin, npicks) };
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
    if (e.fitness > best.e.fitness || (e.fitness === best.e.fitness && e.basketVsSpx > best.e.basketVsSpx)) {
      best = { params: p, e };
    }
  }
  return { best, trials };
}
