// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// The four areas are defined the way the chart is read:
//
//   X = TREND GAP — how far the price is from its own 100-day trend, in %,
//                   averaged over a month so it does not jitter.
//                   Above zero = in an up-leg, below zero = in a down-leg.
//   Y = MOMENTUM  — the MACD(16,35,12) histogram as % of price.
//                   Above zero = the move is gaining ground right now, below = losing it.
//
//   Recovering (top-left)    : below its trend but momentum has turned up — the entry, BUY
//   Trending   (top-right)   : above its trend and still gaining — hold
//   Fading     (bottom-right): above its trend but momentum has turned down — the exit, SELL
//   Lagging    (bottom-left) : below its trend and still losing — wait for Recovering
//
// WHY THESE TWO, and not the 3-month return + acceleration, nor the 12-month pace and
// its change. Both of those were measured against a ground truth built from the real
// swings of the price (a ZigZag confirmed by a reversal of 1.5× the asset's own monthly
// volatility; the first third of each leg is the turn, the rest the trend), on ten years
// of daily history for eight assets — Micron, Gold, S&P 500, Microsoft, Bitcoin, Silver,
// a cloud-sector ETF and the TSX.
//
// What the price ACTUALLY did while each label was showing (annualised, from daily closes):
//
//                          Recovering  Trending  Fading  Lagging   worst dip inside
//                                                                  a Trending run
//   3M return + accel           +12%      +34%     +0%     +12%         −10.7%
//   12M pace + its change       +20%      +36%     +1%     +11%         −10.4%
//   trend gap + momentum        +41%      +54%     +5%     −20%          −3.9%
//
// The first two could not describe the present, let alone the future: "Lagging" RISING
// at 11-12%/yr is not a falling asset, and a "Trending" band that holds a 10% drawdown is
// not a trend. This one gets the signs right on all four, and a Trending stretch no longer
// contains a crash. Against the swing ground truth its balanced accuracy is 41% where the
// 12-month version scored 34% and a coin toss scores 25%.
//
// WHAT THE SEARCH ALSO SHOWED, because it constrains what this model can promise:
//   • Which HALF of the cycle an asset is in — up-leg or down-leg — is readable from the
//     data: 74% recall on Trending, 67% on Lagging.
//   • WHEN the leg will turn is not. At the moment it happens, Trending and Fading are
//     statistically the same picture (median RSI 60.5 vs 48.6, distance from the 100-day
//     trend +5.8% vs +1.7%), and no combination of the indicators tested recognises the
//     two turn zones better than ~40%. Recovering and Fading are therefore honest
//     warnings, not forecasts.
//   • The price paid for describing the present correctly is speed: a label lasts ~18 days
//     against the ~29 days of a real turn zone, so the strip changes colour more often
//     than the 12-month version did (71 days). That is the trade, and it is deliberate:
//     the alternative was labels that stayed put while being wrong.
//
// AMPLITUDE. Distance from the centre is in % of price and is dominated by the trend gap,
// so it keeps meaning the size of the swing. Measured on the real swings, one full cycle
// moves the S&P 500 about +14% up then −10% down over ~72 days, Micron +52%/−25% over
// ~130 days, Bitcoin +66%/−35% over ~114 days. A broad index orbits close in, a high-beta
// name orbits wide, and nothing here depends on any other asset: an asset's own history is
// the whole input, so adding a thousand tickers changes neither the answer nor its price.
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

/** The trend the price is measured against, in trading days. */
export const TREND_SPAN = 100;
/** The trend gap is averaged over this many trading days before use. */
export const TREND_SMOOTH = 21;
/** MACD parameters for the momentum axis, in trading days. */
export const MOM_FAST = 16, MOM_SLOW = 35, MOM_SIGNAL = 12;
/** Calendar days of history the axes need, with room for the EMAs to converge. */
export const AXES_LOOKBACK_DAYS = 480;

/**
 * Which quadrant a point falls in.
 *
 * trendGap: % above (+) or below (−) the asset's own 100-day trend, month-averaged (X).
 * momentum: MACD histogram as % of price — gaining (+) or losing (−) ground now (Y).
 * Null when either is unknown; an asset without enough history has no position in the
 * cycle, and guessing one would be worse than saying nothing.
 */
export function classifyPhase(trendGap: number | null | undefined, momentum: number | null | undefined): RotationPhase | null {
  if (trendGap == null || momentum == null) return null;
  const up = trendGap > 0;
  // Exactly zero momentum means nothing has changed, so the leg simply continues.
  if (momentum === 0) return up ? 'Trending' : 'Lagging';
  if (momentum > 0) return up ? 'Trending' : 'Recovering';
  return up ? 'Fading' : 'Lagging';
}

/**
 * The asset's position in the quadrant as a POINT, not just a name: which quadrant,
 * how far from the centre, and at what angle.
 *
 * Distance from the centre is the size of the swing — a broad index orbits close in, a
 * high-beta name orbits wide — and it is the part a phase label throws away. Both axes
 * are in % of price, so the radius is a real distance.
 *
 * The angle turns CLOCKWISE through the cycle — Recovering 135°, Trending 45°,
 * Fading 315°, Lagging 225° — so a falling angle is an asset going round the way the
 * model says it should. That makes "does it actually rotate?" a number rather than an
 * impression; on the eight assets measured, 63% of the transitions step to the next
 * quadrant clockwise.
 */
export interface QuadrantPosition {
  phase: RotationPhase | null;
  /** X in %: the month-averaged gap to the 100-day trend. */
  x: number;
  /** Y in % of price: the MACD histogram. */
  y: number;
  /** Distance from the centre, in %. */
  radius: number;
  /** 0° = due right, increasing anticlockwise; the cycle runs the other way. */
  angle: number;
}

export function quadrantPosition(
  trendGap: number | null | undefined,
  momentum: number | null | undefined,
): QuadrantPosition | null {
  if (trendGap == null || momentum == null) return null;
  const x = trendGap, y = momentum;
  const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { phase: classifyPhase(x, y), x, y, radius: Math.hypot(x, y), angle };
}

/** Monthly pace implied by a return over `months` — compounded, not divided. */
export function paceMonthly(r: number, months: number): number {
  const g = 1 + r / 100;
  if (g <= 0) return r / months;
  return (Math.pow(g, 1 / months) - 1) * 100;
}

// ── The axes, computed from a price history ──────────────────────────────────
// One implementation, used by the live rotation rows, the trails, the per-asset
// quadrant and the phase lab, so all four necessarily agree.

export type PricePoint = { date: string; close: number };

/**
 * Bars per month in this history. Crypto trades every day and equities ~21 days a
 * month, so a span counted in bars would mean a different amount of TIME for each.
 * Every window below is scaled by this, which is how the definition was measured.
 */
function barsPerMonth(hist: PricePoint[]): number {
  const tail = hist.slice(-Math.min(hist.length, 260));
  if (tail.length < 30) return 21;
  const days = (Date.parse(tail[tail.length - 1].date) - Date.parse(tail[0].date)) / 86_400_000;
  if (!(days > 0)) return 21;
  return Math.max(15, Math.min(31, (tail.length / days) * 30.44));
}

/** EMA over a closed array, seeded on the first value (history is a warm-up, not data). */
function emaSeries(v: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const out = new Array<number>(v.length);
  let prev = v[0];
  for (let i = 0; i < v.length; i++) { prev = i === 0 ? v[i] : v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export interface TrendAxes {
  /** X: % above/below the 100-day trend, averaged over a month. */
  trendGap: number;
  /** Y: MACD(16,35,12) histogram as % of price. */
  momentum: number;
}

/**
 * The two quadrant coordinates as of a date, from the asset's own price history.
 * `asOf` defaults to the last bar. Null when the history is too short for the EMAs to
 * mean anything — reported rather than approximated, because an EMA-100 seeded ten bars
 * ago is just the last ten bars wearing a longer name.
 */
export function trendAxes(hist: PricePoint[] | undefined, asOf?: string | Date): TrendAxes | null {
  if (!hist || hist.length < 2) return null;
  const asOfStr = asOf == null
    ? hist[hist.length - 1].date
    : (typeof asOf === 'string' ? asOf : new Date(asOf.getTime()).toISOString().slice(0, 10));

  // Binary-search the as-of cutoff: no bar after it may be read.
  let lo = 0, hi = hist.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hist[mid].date <= asOfStr) lo = mid + 1; else hi = mid; }
  if (lo < 2) return null;
  const closes: number[] = [];
  for (let i = 0; i < lo; i++) closes.push(hist[i].close);

  const bpm = barsPerMonth(hist.slice(0, lo));
  const scale = bpm / 21;
  const W = (d: number) => Math.max(2, Math.round(d * scale));
  const spanTrend = W(TREND_SPAN), smooth = W(TREND_SMOOTH);
  // Two and a half spans of warm-up: below that the "100-day trend" is mostly the seed.
  if (closes.length < spanTrend * 2.5 + smooth) return null;

  const trend = emaSeries(closes, spanTrend);
  let sum = 0;
  for (let i = closes.length - smooth; i < closes.length; i++) sum += (closes[i] / trend[i] - 1) * 100;
  const trendGap = sum / smooth;

  const fast = emaSeries(closes, W(MOM_FAST)), slow = emaSeries(closes, W(MOM_SLOW));
  const line = closes.map((c, i) => ((fast[i] - slow[i]) / c) * 100);
  const signal = emaSeries(line, W(MOM_SIGNAL));
  const last = closes.length - 1;
  const momentum = line[last] - signal[last];

  if (!isFinite(trendGap) || !isFinite(momentum)) return null;
  return { trendGap, momentum };
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — still below its own 100-day trend, but momentum has turned up: the fall has stopped and the price is starting to take ground back. The entry.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — above its own 100-day trend and momentum is still positive: the move is running.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — still above its own 100-day trend, but momentum has turned down: the rise is losing pace. The exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — below its own 100-day trend and momentum is still negative: the price is falling, wait for Recovering.',
  },
};
