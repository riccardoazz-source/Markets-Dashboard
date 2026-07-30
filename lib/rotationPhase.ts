// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// BOTH axes are absolute quantities measured on the asset itself, and both are
// centred on zero. That is what lets every asset ORBIT the centre rather than sit
// pinned to one side of it:
//
//   X = 3-month return (%)                     — where the price has been
//   Y = acceleration (percentage points/month) — whether the move is speeding up
//                                                or slowing down (computeAccel)
//
// The Y axis used to be the model score's cross-sectional PERCENTILE. A percentile
// is ordinal: it says how many assets are between you and the median, and nothing
// about how far you actually moved. Two consequences, both wrong:
//
//   • amplitude was destroyed. A broad index and a high-beta stock have completely
//     different swing sizes, and that difference IS the information — the S&P
//     should orbit in a small circle near the centre, Micron in a wide one. A rank
//     cannot express that.
//   • a broad index could never cross the median of a universe containing its own
//     best components, so it never rotated at all: it sat in the bottom half and
//     could only ever be Fading or Lagging, whatever the price did.
//
// With an absolute Y, distance from the centre means what it looks like it means —
// how big the move is — and the four quadrants become the actual cycle, travelled
// clockwise: Recovering → Trending → Fading → Lagging → Recovering.
//
//   Recovering (top-left)    : 3M still negative, but accelerating up — the entry
//   Trending   (top-right)   : rising and still accelerating
//   Fading     (bottom-right): still up over 3M but decelerating — the exit
//   Lagging    (bottom-left) : falling and still decelerating — wait
//
// It also costs nothing: no universe to rank, so an asset's own history is enough
// and adding a thousand tickers changes neither the answer nor the price of it.
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

// accel: acceleration in percentage points per month (computeAccel), 0 = steady.
// r3m: 3-month return %. Null when either is unknown — an asset with no 3-month
// history cannot be placed on the X axis at all.
export function classifyPhase(accel: number | null, r3m: number | null | undefined): RotationPhase | null {
  if (accel == null || r3m == null) return null;
  const top = accel > 0;
  const right = r3m > 0;
  if (top) return right ? 'Trending' : 'Recovering';
  return right ? 'Fading' : 'Lagging';
}

/**
 * The asset's position in the quadrant as a POINT, not just a name: which quadrant,
 * how far from the centre, and at what angle.
 *
 * Distance from the centre is the size of the swing — a broad index orbits close in,
 * a high-beta name orbits wide — and it is the part a phase label throws away. To
 * measure it the two axes have to be in the same unit, so X is converted from a
 * 3-month return to the monthly pace that produced it; Y is already points per
 * month. The radius is then a real distance in %/month, and nothing is being added
 * to something it cannot be added to.
 *
 * The angle turns CLOCKWISE through the cycle — Recovering 135°, Trending 45°,
 * Fading 315°, Lagging 225° — so a falling angle is an asset going round the way the
 * model says it should. That makes "does it actually rotate?" a number rather than
 * an impression.
 */
export interface QuadrantPosition {
  phase: RotationPhase | null;
  /** X in %/month: the monthly pace implied by the 3-month return. */
  x: number;
  /** Y in pp/month: the acceleration. */
  y: number;
  /** Distance from the centre, %/month. */
  radius: number;
  /** 0° = due right, increasing anticlockwise; the cycle runs the other way. */
  angle: number;
}

/** Monthly pace implied by a return over `months` — compounded, not divided. */
function paceMonthly(r: number, months: number): number {
  const g = 1 + r / 100;
  if (g <= 0) return r / months;
  return (Math.pow(g, 1 / months) - 1) * 100;
}

export function quadrantPosition(accel: number | null, r3m: number | null | undefined): QuadrantPosition | null {
  if (accel == null || r3m == null) return null;
  const x = paceMonthly(r3m, 3);
  const y = accel;
  const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { phase: classifyPhase(accel, r3m), x, y, radius: Math.hypot(x, y), angle };
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — down over 3 months but the move is accelerating upward: turning up early, before it shows in the 3-month number. The entry.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — up over 3 months and still accelerating: a confirmed uptrend running at full speed.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — still up over 3 months but decelerating: the move is running out of pace. The exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — down over 3 months and still decelerating: no turn yet, wait for Recovering.',
  },
};
