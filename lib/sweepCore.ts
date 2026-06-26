// ── Sweep core — shared by the offline script AND the Vercel sweep route ─────
// One implementation of: build the as-of date grid (with forward winners),
// evaluate a parameter set across ALL dates, and sample parameter sets. Both the
// CLI sweep (scripts/sweep.ts) and the in-app optimizer (/api/rotation-sweep)
// import from here so they tune the exact same way.
import { subDays } from 'date-fns';
import { scoreRotation, selectPicks, ModelParams, DEFAULT_PARAMS, ACCEL_MAX, PRE_BREAKOUT_SLOTS } from './rotationModel';
import { buildInputsAsOf, retBetween, fmt, BtMeta, Hist } from './backtestCore';

export const SPX = '^GSPC';

// `fwd` is the forward MEASUREMENT MODE, not a fixed window:
//   'today'  → forward return from each as-of date to TODAY (end of data). This is
//              EXACTLY what the on-screen backtest cards measure, so the optimizer
//              tunes the same yardstick you judge — and crucially it REWARDS catching
//              the multi-year 10-baggers (MU, AVGO at the 5Y as-of date), which a
//              fixed short window can never see.
//   number   → legacy fixed N-day forward window (kept for the offline CLI).
// `minBack` is how close to today the nearest as-of date sits (a 30-day-back slice
//   measures ~1-month forward, a 1825-day-back slice measures ~5-year forward — so a
//   single 'today' mode over a dense as-of grid covers 1M…5Y in one objective).
export interface SliceOpts { fwd: number | 'today'; minBack: number; kwin: number; step: number; maxDays: number }
export const DEFAULT_SLICE_OPTS: SliceOpts = { fwd: 'today', minBack: 30, kwin: 25, step: 45, maxDays: 5 * 365 + 120 };

export interface DateSlice {
  asOf: string;
  inputs: ReturnType<typeof buildInputsAsOf>;
  fwd: Map<string, number>;   // symbol -> forward return %
  winners: Set<string>;       // top-K by forward return
  spxFwd: number | null;
}

// Precompute, ONCE per as-of date: model inputs + forward returns + actual top-K
// winners. Parameter sweeps reuse these slices — only the (cheap) re-scoring varies.
export function buildSlices(universe: BtMeta[], histMap: Map<string, Hist>, opts: SliceOpts = DEFAULT_SLICE_OPTS): DateSlice[] {
  const { fwd: FWD, kwin: KWIN, step: STEP, maxDays } = opts;
  const minBack = opts.minBack ?? (typeof FWD === 'number' ? FWD + 5 : 30);
  const today = new Date();
  const todayStr = fmt(today);
  const slices: DateSlice[] = [];
  for (let days = minBack; days <= maxDays; days += STEP) {
    const asOfDate = subDays(today, days);
    // Forward window ends TODAY (showcase metric) unless a fixed N-day legacy window is requested.
    const fwdStr = FWD === 'today' ? todayStr : fmt(subDays(today, Math.max(0, days - FWD)));
    const inputs = buildInputsAsOf(universe, histMap, asOfDate);
    const fwd = new Map<string, number>();
    for (const m of universe) {
      const h = histMap.get(m.symbol) ?? [];
      const r = retBetween(h, fmt(asOfDate), fwdStr);
      if (r != null) fwd.set(m.symbol, r);
    }
    const ranked = [...fwd.entries()].filter(([s]) => s !== SPX).sort((a, b) => b[1] - a[1]);
    const winners = new Set(ranked.slice(0, KWIN).map(([s]) => s));
    slices.push({ asOf: fmt(asOfDate), inputs, fwd, winners, spxFwd: fwd.get(SPX) ?? null });
  }
  return slices;
}

export interface SweepEval { capture: number; beatSpx: number; basketVsSpx: number; nDates: number }

export function evaluate(slices: DateSlice[], params: ModelParams, kwin = 25, npicks = ACCEL_MAX): SweepEval {
  let capSum = 0, beatSum = 0, basketVsSpxSum = 0, nWithSpx = 0;
  for (const sl of slices) {
    const scored = scoreRotation(sl.inputs, params);
    const picks = selectPicks(scored, npicks, PRE_BREAKOUT_SLOTS).map(s => s.item.symbol).filter(s => s !== SPX);
    let hits = 0, fwdSum = 0, fwdN = 0;
    for (const sym of picks) {
      if (sl.winners.has(sym)) hits++;
      const f = sl.fwd.get(sym);
      if (f != null) { fwdSum += f; fwdN++; }
    }
    capSum += hits / kwin;
    if (sl.spxFwd != null && fwdN > 0) {
      const basket = fwdSum / fwdN;
      basketVsSpxSum += basket - sl.spxFwd;
      if (basket > sl.spxFwd) beatSum++;
      nWithSpx++;
    }
  }
  const n = slices.length || 1;
  return {
    capture: capSum / n,
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
