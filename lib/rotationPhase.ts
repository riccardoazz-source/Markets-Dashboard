// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// Both axes are absolute quantities measured on the asset ITSELF, both centred on
// zero, so every asset orbits the centre instead of being pinned to one side of it,
// and the distance from the centre is the SIZE of the swing:
//
//   X = TREND   — the monthly pace of the trailing 12-month move (%/month),
//                 averaged over the last two months so it does not jitter.
//   Y = IMPULSE — how much that pace has changed over the last month (pp/month).
//                 Positive = the trend is strengthening, negative = weakening.
//
// Y is the DERIVATIVE OF X, which is what makes the picture a real cycle: a point
// travelling on (x, ẋ) can only go round clockwise, so the four boxes are visited
// in order and "does it rotate?" stops being a matter of opinion —
//
//   Recovering (top-left)    : 12M pace still negative but improving — the entry, BUY
//   Trending   (top-right)   : rising and still strengthening — hold
//   Fading     (bottom-right): still up over 12M but losing pace — the exit, SELL
//   Lagging    (bottom-left) : falling and still weakening — wait for Recovering
//
// WHY 12 MONTHS AND A DERIVATIVE, and not the previous "3-month return vs
// computeAccel". Measured on ten years of daily history for eight assets
// (Micron, Gold, S&P 500, Microsoft, Bitcoin, Silver, a cloud sector ETF, TSX),
// weekly observations, forward 3-month return per phase:
//
//                       Recovering  Trending  Fading  Lagging   spread   clockwise
//   3M return + accel        +5.1      +8.3    +7.5     +5.1    +1.0pp        54%
//   12M pace + its change   +10.3     +10.1    +2.9     +4.0    +6.9pp        66%
//
// The old definition could not tell the two halves of the cycle apart: Fading, the
// phase whose whole purpose is to warn, paid +7.5% over the next quarter — more
// than Recovering, the phase meant to be the entry. And it flipped label every
// ~24 days, because acceleration changes sign every few weeks, so only 54% of its
// transitions moved to the next quadrant round.
//
// The new definition puts Recovering and Trending (the two sides worth owning)
// three times higher than Fading and Lagging, holds a label for ~11 weeks, and
// two thirds of its transitions rotate the right way. Split by sub-period the
// ordering survives (2016-21 spread +4.3pp, 2021-26 +8.7pp) — the old one inverted
// in the second half (−1.1pp). Traded literally — long only while Recovering or
// Trending, weekly — it returned 17.9%/yr against 18.4% for buy-and-hold while
// invested just 53% of the time; the old definition returned 10.8%.
//
// It still costs nothing: no universe to rank, an asset's own history is the whole
// input, so adding a thousand tickers changes neither the answer nor its price.
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

/** Trend horizon: the pace is measured over the trailing 12 months. */
export const TREND_MONTHS = 12;
/** The pace is averaged over this many weekly samples (~2 months) before use. */
export const TREND_SMOOTH_WEEKS = 9;
/** The impulse is the change in that averaged pace over this many days. */
export const IMPULSE_DAYS = 30;
/** Calendar days of history the axes need: 12 months + smoothing + impulse. */
export const AXES_LOOKBACK_DAYS = 365 + 7 * (TREND_SMOOTH_WEEKS - 1) + IMPULSE_DAYS + 15;

/**
 * Which quadrant a point falls in.
 *
 * trendPace: monthly pace of the trailing 12-month move, %/month (X).
 * trendImpulse: change in that pace over the last month, pp/month (Y).
 * Null when either is unknown — an asset without a year of history has no
 * position in the cycle, and guessing one would be worse than saying nothing.
 */
export function classifyPhase(trendPace: number | null | undefined, trendImpulse: number | null | undefined): RotationPhase | null {
  if (trendPace == null || trendImpulse == null) return null;
  const up = trendPace > 0;
  // Exactly zero impulse means the pace has not changed at all, so the trend simply
  // continues — an unchanged uptrend is Trending, an unchanged downtrend Lagging.
  // Rounding it into Fading (or Recovering) would call a perfectly steady riser an
  // exit signal.
  if (trendImpulse === 0) return up ? 'Trending' : 'Lagging';
  if (trendImpulse > 0) return up ? 'Trending' : 'Recovering';
  return up ? 'Fading' : 'Lagging';
}

/**
 * The asset's position in the quadrant as a POINT, not just a name: which quadrant,
 * how far from the centre, and at what angle.
 *
 * Distance from the centre is the size of the swing — a broad index orbits close in,
 * a high-beta name orbits wide — and it is the part a phase label throws away. Both
 * axes are already monthly rates (%/month and pp/month), so the radius is a real
 * distance and nothing is added to something it cannot be added to.
 *
 * The angle turns CLOCKWISE through the cycle — Recovering 135°, Trending 45°,
 * Fading 315°, Lagging 225° — so a falling angle is an asset going round the way the
 * model says it should. That makes "does it actually rotate?" a number rather than
 * an impression.
 */
export interface QuadrantPosition {
  phase: RotationPhase | null;
  /** X in %/month: the smoothed 12-month pace. */
  x: number;
  /** Y in pp/month: the change in that pace over the last month. */
  y: number;
  /** Distance from the centre, %/month. */
  radius: number;
  /** 0° = due right, increasing anticlockwise; the cycle runs the other way. */
  angle: number;
}

export function quadrantPosition(
  trendPace: number | null | undefined,
  trendImpulse: number | null | undefined,
): QuadrantPosition | null {
  if (trendPace == null || trendImpulse == null) return null;
  const x = trendPace, y = trendImpulse;
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

/** Last close at or before `dateStr`; history must be ascending by date. */
function closeAsOf(hist: PricePoint[], dateStr: string): number | null {
  let lo = 0, hi = hist.length - 1, res: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hist[mid].date <= dateStr) { res = hist[mid].close; lo = mid + 1; }
    else hi = mid - 1;
  }
  return res;
}

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shift = (dateStr: string, days: number) => dayStr(Date.parse(dateStr + 'T00:00:00Z') - days * 86_400_000);

/** Monthly pace of the trailing 12-month return ending at `dateStr`. */
function paceAt(hist: PricePoint[], dateStr: string): number | null {
  const now = closeAsOf(hist, dateStr);
  const then = closeAsOf(hist, shift(dateStr, 365));
  if (now == null || then == null || then <= 0) return null;
  // Guard against a "12-month" window that is really the start of the file: the
  // earliest bar would be reused for every lookback and invent a flat pace.
  if (hist[0].date > shift(dateStr, 365 - 10)) return null;
  return paceMonthly((now / then - 1) * 100, TREND_MONTHS);
}

/** The averaged pace (X) as of a date — mean of weekly samples over ~2 months. */
function smoothPaceAt(hist: PricePoint[], dateStr: string): number | null {
  let sum = 0, n = 0;
  for (let w = 0; w < TREND_SMOOTH_WEEKS; w++) {
    const p = paceAt(hist, shift(dateStr, w * 7));
    if (p != null) { sum += p; n++; }
  }
  // Anything less than the full window is a different measurement, not a noisier
  // one: the average would cover a shorter span and the impulse would compare two
  // unequal windows.
  return n === TREND_SMOOTH_WEEKS ? sum / n : null;
}

export interface TrendAxes { trendPace: number; trendImpulse: number }

/**
 * The two quadrant coordinates as of a date, from the asset's own price history.
 * `asOf` defaults to the last bar. Null when the history is too short.
 */
export function trendAxes(hist: PricePoint[] | undefined, asOf?: string | Date): TrendAxes | null {
  if (!hist || hist.length < 2) return null;
  const asOfStr = asOf == null
    ? hist[hist.length - 1].date
    : (typeof asOf === 'string' ? asOf : dayStr(asOf.getTime()));
  const now = smoothPaceAt(hist, asOfStr);
  const prev = smoothPaceAt(hist, shift(asOfStr, IMPULSE_DAYS));
  if (now == null || prev == null) return null;
  return { trendPace: now, trendImpulse: now - prev };
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — the 12-month pace is still negative but it is improving: the fall has stopped and the price is turning up. The entry.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — rising over 12 months and still gaining pace: a confirmed uptrend running at full speed.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — still up over 12 months but losing pace: the move is running out. The exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — falling over 12 months and still losing pace: no turn yet, wait for Recovering.',
  },
};
