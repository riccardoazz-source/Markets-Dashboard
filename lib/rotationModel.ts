/**
 * Shared rotation-scoring model.
 *
 * IMPORTANT: MODEL_WEIGHTS below is the single source of truth for the formula.
 * The on-screen legend in RotationSection renders these exact numbers, so editing
 * them here updates both the calculation AND the documented formula automatically.
 *
 * Score = Σ weightᵢ × componentᵢ   (every component is a cross-sectional percentile, 0..1)
 *   ACC  — acceleration: climbed the 1M leaderboard vs 3M (main early-rotation signal)
 *   TRD  — trend strength: r3m percentile (confirms the move is real, not a blip)
 *   REG  — regime: structural tailwind (above 200W→1.0, above 200D→0.6, below→0.2)
 *   VOL  — volume: capital moving in (guarded — neutral 0.5 when data unavailable)
 *   EXT  — extension penalty (SUBTRACTED): r1y percentile (penalises crowded / already-ran)
 *
 * Gate (minimum bar before the score counts): r1m > 0 AND r3m > 0.
 * The live table then shows only the TOP `ACCEL_LIMIT` by score — a focused shortlist.
 *
 * Used by both the live Rotation table and the historical backtest, so both always
 * test exactly the same logic.
 */

export const MODEL_WEIGHTS = {
  acceleration: 0.40, // ACC — 1M-vs-3M leaderboard climb
  trend:        0.25, // TRD — r3m percentile
  regime:       0.15, // REG — 200D / 200W structural position
  volume:       0.10, // VOL — volume vs 20-day average
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
  sma200w: number | null;  // 200-week SMA
  volRatio?: number | null; // latestVol / avg20dVol; null → treat as neutral
}

export interface ScoredItem<T extends ModelInput> {
  item: T;
  score: number;       // composite 0..1 (higher = stronger rotation candidate)
  rankDelta: number;   // raw position-climb for arrow display
  accPctile: number;   // acceleration component alone (0..1)
  passesGate: boolean; // r1m>0 AND r3m>0
}

function toP(rank: number, n: number): number {
  return n > 1 ? rank / (n - 1) : 0.5;
}

export function scoreRotation<T extends ModelInput>(items: T[]): ScoredItem<T>[] {
  const valid = items.filter(i => i.r1m != null && i.r3m != null);
  const n = valid.length;

  // Ascending-rank helpers (rank 0 = worst, rank n-1 = best)
  const byR3mAsc = [...valid].sort((a, b) => a.r3m! - b.r3m!);
  const byR1yAsc = [...valid].sort((a, b) => (a.r1y ?? -Infinity) - (b.r1y ?? -Infinity));
  const rankR3mAsc = new Map(byR3mAsc.map((r, i) => [r.symbol, i]));
  const rankR1yAsc = new Map(byR1yAsc.map((r, i) => [r.symbol, i]));

  // Descending-rank helpers for rank-delta (rank 0 = best, consistent with existing arrow logic)
  const byR1mDesc = [...valid].sort((a, b) => b.r1m! - a.r1m!);
  const byR3mDesc = [...valid].sort((a, b) => b.r3m! - a.r3m!);
  const rankR1mDesc = new Map(byR1mDesc.map((r, i) => [r.symbol, i]));
  const rankR3mDesc = new Map(byR3mDesc.map((r, i) => [r.symbol, i]));

  // Acceleration = how many positions an asset climbed from 3M to 1M leaderboard
  const rawDeltas = valid.map(r => ({
    symbol: r.symbol,
    delta: (rankR3mDesc.get(r.symbol) ?? 0) - (rankR1mDesc.get(r.symbol) ?? 0),
  }));
  const sortedDeltaVals = [...rawDeltas].sort((a, b) => a.delta - b.delta);
  const deltaRankAsc = new Map(sortedDeltaVals.map((d, i) => [d.symbol, i]));
  const rawDeltaMap = new Map(rawDeltas.map(d => [d.symbol, d.delta]));

  return items.map(item => {
    const hasReturns = item.r1m != null && item.r3m != null;

    const p3m = toP(rankR3mAsc.get(item.symbol) ?? 0, n);
    const p1y = toP(rankR1yAsc.get(item.symbol) ?? 0, n);
    const accPctile = toP(deltaRankAsc.get(item.symbol) ?? 0, n);
    const rankDelta = rawDeltaMap.get(item.symbol) ?? 0;

    // Regime: how structurally bullish is the asset right now
    const above200w = item.price != null && item.sma200w != null && item.price > item.sma200w;
    const above200d = item.price != null && item.ma200 != null && item.price > item.ma200;
    const noMaData = item.ma200 == null && item.sma200w == null;
    const reg = above200w ? 1.0 : above200d ? 0.6 : noMaData ? 0.5 : 0.2;

    // Volume: guarded neutral when unavailable (Indexes/Commodities often have no volume)
    const vr = item.volRatio ?? null;
    const vol = vr != null && vr > 0
      ? Math.max(0, Math.min(1, (vr - 0.7) / 1.3))
      : 0.5;

    const W = MODEL_WEIGHTS;
    const score = hasReturns
      ? W.acceleration * accPctile + W.trend * p3m + W.regime * reg + W.volume * vol - W.extension * p1y
      : -1;

    const passesGate = hasReturns && item.r1m! > 0 && item.r3m! > 0;

    return { item, score, rankDelta, accPctile, passesGate };
  });
}
