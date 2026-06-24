/**
 * Shared rotation-scoring model — the SINGLE source of truth for the
 * Accelerating shortlist AND the Rotation Quadrant Y-axis AND the backtest.
 *
 * The whole model is built from quantities that can be computed identically
 * from price history at ANY point in time (r1m, r3m, r1y, price, 200-day MA).
 * That is deliberate: it makes the historical backtest a FAITHFUL reproduction
 * of the live formula — at a past date we recompute exactly the same inputs
 * with no look-ahead, so "what would it have flagged then" is honest.
 *
 * ── Acceleration (the core idea) ─────────────────────────────────────────────
 * True acceleration is the SECOND derivative of the price path: is the asset
 * speeding UP, not just rising? We measure it as the gap between the most recent
 * month's pace and the pace of the two months before it:
 *
 *   g1 = 1 + r1m/100                  (growth factor, last ~1 month)
 *   g3 = 1 + r3m/100                  (growth factor, last ~3 months)
 *   priorMonthly = √(g3 / g1) − 1     (monthly pace of the 2 months BEFORE last)
 *   ACCEL = r1m − priorMonthly×100    (percentage points)
 *
 * ACCEL > 0  ⇒ the last month outpaced the previous two ⇒ genuinely accelerating
 * (the price curve is convex up). This is per-asset — it does not depend on what
 * the rest of the universe did, unlike a pure leaderboard-rank shuffle.
 *
 * ── Score ────────────────────────────────────────────────────────────────────
 *   Score = Σ weightᵢ × componentᵢ      (each component is a 0..1 percentile/level)
 *     ACC  — acceleration percentile (the main signal, see above)
 *     TRD  — r3m percentile (the move is real and in the right direction)
 *     REG  — regime: price above its 200-day MA (1.0) / below (0.2) / no data (0.5)
 *     EXT  — r1y percentile (SUBTRACTED): prefers earlier accelerations to late ones
 *
 *   Gate (shown in the Accelerating shortlist only if): r1m > 0 AND r3m > 0 AND ACCEL > 0
 *   — i.e. rising AND speeding up. The list then shows the top ACCEL_LIMIT by score.
 */

export const MODEL_WEIGHTS = {
  acceleration: 0.50, // ACC — month-over-prior-months pace increase (percentile)
  trend:        0.25, // TRD — r3m percentile
  regime:       0.15, // REG — price vs 200-day MA
  extension:    0.10, // EXT — r1y percentile (subtracted)
} as const;

// How many names the "Accelerating" shortlist shows (top N by score).
export const ACCEL_LIMIT = 8;

export interface ModelInput {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r1y: number | null;
  price: number | null;
  ma200: number | null;    // 200-day SMA (null → data unavailable, not "below")
  sma200w?: number | null;  // kept for callers; not used by the score (backtest can't compute it)
  volRatio?: number | null; // kept for callers; not used by the score (no historical volume)
}

export interface ScoredItem<T extends ModelInput> {
  item: T;
  score: number;       // composite (higher = stronger acceleration candidate)
  accel: number;       // raw acceleration in percentage points (can be negative)
  accPctile: number;   // cross-sectional percentile of accel (0..1) — the Quadrant Y-axis
  passesGate: boolean; // r1m>0 AND r3m>0 AND accel>0
}

function toP(rank: number, n: number): number {
  return n > 1 ? rank / (n - 1) : 0.5;
}

// Acceleration in percentage points: last month's pace minus the geometric
// monthly pace of the two months before it. Positive = speeding up.
export function computeAccel(r1m: number, r3m: number): number {
  const g1 = 1 + r1m / 100;
  const g3 = 1 + r3m / 100;
  // Growth factors are always > 0 (an asset cannot lose more than 100%); guard anyway.
  if (g1 <= 0 || g3 <= 0) return r1m;
  const priorMonthly = (Math.sqrt(g3 / g1) - 1) * 100;
  return r1m - priorMonthly;
}

export function scoreRotation<T extends ModelInput>(items: T[]): ScoredItem<T>[] {
  const valid = items.filter(i => i.r1m != null && i.r3m != null);
  const n = valid.length;

  const accelOf = (i: ModelInput) => computeAccel(i.r1m as number, i.r3m as number);

  // Ascending-rank helpers (rank 0 = worst, rank n-1 = best) → cross-sectional percentiles.
  const byR3mAsc   = [...valid].sort((a, b) => a.r3m! - b.r3m!);
  const byR1yAsc   = [...valid].sort((a, b) => (a.r1y ?? -Infinity) - (b.r1y ?? -Infinity));
  const byAccelAsc = [...valid].sort((a, b) => accelOf(a) - accelOf(b));
  const rankR3mAsc   = new Map(byR3mAsc.map((r, i) => [r.symbol, i]));
  const rankR1yAsc   = new Map(byR1yAsc.map((r, i) => [r.symbol, i]));
  const rankAccelAsc = new Map(byAccelAsc.map((r, i) => [r.symbol, i]));

  return items.map(item => {
    const hasReturns = item.r1m != null && item.r3m != null;
    const accel = hasReturns ? accelOf(item) : 0;

    const accPctile = hasReturns ? toP(rankAccelAsc.get(item.symbol) ?? 0, n) : 0;
    const p3m = toP(rankR3mAsc.get(item.symbol) ?? 0, n);
    const p1y = toP(rankR1yAsc.get(item.symbol) ?? 0, n);

    // Regime: above the 200-day MA = structural tailwind. 200-day is used (not 200W)
    // because it is computable identically in the historical backtest.
    const above200d = item.price != null && item.ma200 != null && item.price > item.ma200;
    const reg = above200d ? 1.0 : item.ma200 == null ? 0.5 : 0.2;

    const W = MODEL_WEIGHTS;
    const score = hasReturns
      ? W.acceleration * accPctile + W.trend * p3m + W.regime * reg - W.extension * p1y
      : -1;

    const passesGate = hasReturns && item.r1m! > 0 && item.r3m! > 0 && accel > 0;

    return { item, score, accel, accPctile, passesGate };
  });
}
