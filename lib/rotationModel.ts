/**
 * Shared rotation-scoring model — the SINGLE source of truth for the
 * Accelerating shortlist AND the Rotation Quadrant Y-axis AND the backtest.
 *
 * Everything is built from quantities computable IDENTICALLY from price history
 * at ANY point in time (r1m, r3m, r6m, r1y, price, 200-day MA, realized vol).
 * That makes the historical backtest a FAITHFUL reproduction of the live
 * formula: at a past date we recompute the exact same inputs with no
 * look-ahead, so "what would it have flagged then" is honest.
 *
 * ── Why v2 ───────────────────────────────────────────────────────────────────
 * The first model measured acceleration from a SINGLE window (r1m vs r3m). The
 * backtest exposed its weakness: it could not tell a durable, building trend
 * (NVDA) apart from a one-month blow-off on top of an already-decelerating base
 * (energy/commodities mid-2021, META). Both have "last month faster than the
 * quarter", so the old formula bought both — and the blow-offs mean-reverted.
 *
 * v2 fixes this with a PACE LADDER across the whole curve plus a blow-off guard.
 *
 * ── Acceleration: the pace ladder ────────────────────────────────────────────
 * Convert each horizon's cumulative return into a geometric MONTHLY pace:
 *
 *   p1 = r1m                                   (last ~1 month)
 *   p3 = ((1+r3m/100)^(1/3) − 1)·100           (avg monthly over last 3 months)
 *   p6 = ((1+r6m/100)^(1/6) − 1)·100           (avg monthly over last 6 months)
 *
 * Two successive accelerations:
 *   aRecent = p1 − p3   (is the last month faster than the quarter?)
 *   aBuild  = p3 − p6   (is the quarter faster than the half-year? → BUILDING)
 *
 *   ACCEL = 0.6·aRecent + 0.4·aBuild           (composite, percentage points)
 *
 * A genuine, durable accelerator needs BOTH legs positive: the curve is bending
 * up across the WHOLE window, not just spiking in the last month. A dead-cat
 * bounce / blow-off has aRecent>0 but aBuild<0 (the medium term is already
 * rolling over) → it is now rejected by the gate.
 *
 * ── Blow-off guard (over-extension) ──────────────────────────────────────────
 * A parabolic top is a price stretched far above its 200-day MA RELATIVE to its
 * own volatility. We measure stretch in monthly-σ units and subtract it, so the
 * model prefers accelerations that are still early over ones that have already
 * gone vertical and are prone to revert:
 *
 *   stretch = max(0, price/MA200 − 1)·100 / monthlyVol    (monthly-σ above MA200)
 *
 * ── Score ────────────────────────────────────────────────────────────────────
 *   Score = 0.50·ACC + 0.25·TRD + 0.15·REG − 0.10·EXT     (each input 0..1)
 *     ACC — acceleration percentile (the pace-ladder composite above)
 *     TRD — r3m percentile (the move is real and in the right direction)
 *     REG — regime: price above its 200-day MA (1.0) / below (0.2) / no data (0.5)
 *     EXT — over-extension percentile (SUBTRACTED): the blow-off guard
 *
 *   Gate (shown in the Accelerating shortlist only if):
 *     r1m > 0  AND  r3m > 0  AND  aRecent > 0  AND  aBuild > 0  AND  r1m < cap
 *   — rising AND accelerating in a BUILDING way. Top ACCEL_LIMIT by score.
 *
 * ── v4: commodity blow-off control ───────────────────────────────────────────
 * Commodities mean-revert harder than equities. The backtest showed event-driven
 * commodity spikes (Iran war → Brent/WTI; fear → Silver/Gold) get bought then
 * crash, while the missed winners are tech/semis. So commodities get a heavier
 * extension weight (0.32 vs 0.20) and a tighter single-month blow-off cap
 * (25% vs 50%). The penalty scales with extension, so a commodity early in a
 * genuine secular trend (low stretch) is untouched.
 */

export const MODEL_WEIGHTS = {
  acceleration: 0.45, // ACC — pace-ladder composite (percentile)
  trend:        0.25, // TRD — r3m percentile
  regime:       0.10, // REG — price vs 200-day MA
  extension:    0.20, // EXT — over-extension: max(stretch above MA200, r1m magnitude)
} as const;

// ── Commodity blow-off control (v4) ──────────────────────────────────────────
// Commodities mean-revert HARDER than equities: their momentum is driven by
// supply/demand shocks and fear spikes (Iran war → Brent/WTI; panic → Silver/
// Gold) that snap back, whereas equity/tech trends ride durable earnings growth.
// The backtest confirmed it: nearly every commodity the model bought on a spike
// reversed (Silver +41%→−15%, Palladium +39%→−37%, WTI +44%→−25%), while the
// winners it missed were tech/semis. So commodities get a STRONGER blow-off
// guard — but one that scales with extension, so a commodity EARLY in a genuine
// secular trend (low stretch, e.g. the multi-year gold bull) is NOT penalised.
export const COMMODITY_EXT_WEIGHT = 0.32; // vs 0.20 for everything else
export const R1M_CAP          = 50; // hard blow-off cap on single-month return
export const COMMODITY_R1M_CAP = 25; // commodities blow off sooner → tighter cap

function isCommodity(i: ModelInput): boolean {
  return (i.group ?? '').toLowerCase().startsWith('commodit');
}

// How many names the "Accelerating" shortlist shows (top N by score).
export const ACCEL_LIMIT = 8;

export interface ModelInput {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m?: number | null;     // needed for the pace-ladder build leg
  r1y: number | null;
  price: number | null;
  ma200: number | null;    // 200-day SMA (null → data unavailable, not "below")
  group?: string;          // asset class (e.g. 'Commodities') → enables class-aware blow-off control
  vol?: number | null;     // realized MONTHLY volatility in % (null → unavailable)
  sma200w?: number | null;  // kept for callers; not used by the score (backtest can't compute it)
  volRatio?: number | null; // kept for callers; not used by the score (no historical volume)
}

export interface ScoredItem<T extends ModelInput> {
  item: T;
  score: number;       // composite (higher = stronger acceleration candidate)
  accel: number;       // raw pace-ladder acceleration in percentage points
  accPctile: number;   // cross-sectional percentile of accel (0..1) — the Quadrant Y-axis
  aRecent: number;     // p1 − p3 (recent leg)
  aBuild: number;      // p3 − p6 (build leg)
  stretch: number;     // monthly-σ above the 200-day MA (blow-off measure)
  passesGate: boolean; // r1m>0 AND r3m>0 AND aRecent>0 AND aBuild>0
}

function toP(rank: number, n: number): number {
  return n > 1 ? rank / (n - 1) : 0.5;
}

// Geometric monthly pace implied by a cumulative return over `months` months.
function paceMonthly(r: number, months: number): number {
  const g = 1 + r / 100;
  if (g <= 0) return r / months; // guard (return < −100% is impossible; be safe)
  return (Math.pow(g, 1 / months) - 1) * 100;
}

export interface AccelParts { accel: number; aRecent: number; aBuild: number }

// Pace-ladder acceleration. r6m optional: without it the build leg is unknown and
// reported as 0 (which fails the strict >0 gate — a build signal is required).
export function computeAccel(r1m: number, r3m: number, r6m?: number | null): AccelParts {
  const p1 = r1m;
  const p3 = paceMonthly(r3m, 3);
  const aRecent = p1 - p3;
  const aBuild = r6m == null ? 0 : p3 - paceMonthly(r6m, 6);
  const accel = 0.6 * aRecent + 0.4 * aBuild;
  return { accel, aRecent, aBuild };
}

// Over-extension above the 200-day MA, in monthly-σ units. Only the stretch ABOVE
// the MA is a blow-off risk; below the MA is handled by the regime term, so it
// contributes 0 here. Larger = more parabolic = more revert-prone.
function computeStretch(price: number | null, ma200: number | null, vol: number | null | undefined): number {
  if (price == null || ma200 == null || ma200 <= 0) return 0;
  const abovePct = Math.max(0, (price / ma200 - 1) * 100);
  const denom = vol != null && vol > 0 ? vol : 10; // fallback scale when vol unknown
  return abovePct / denom;
}

export function scoreRotation<T extends ModelInput>(items: T[]): ScoredItem<T>[] {
  const valid = items.filter(i => i.r1m != null && i.r3m != null);
  const n = valid.length;

  const accelOf = (i: ModelInput) => computeAccel(i.r1m as number, i.r3m as number, i.r6m).accel;
  const stretchOf = (i: ModelInput) => computeStretch(i.price, i.ma200, i.vol);
  // Absolute r1m magnitude: penalises extreme recent movers regardless of direction.
  // Assets with very high r1m (blow-off months like +60%) tend to mean-revert; those
  // with moderate r1m (+5-20%) tend to continue. This is the key pattern the backtest exposed.
  const r1mAbsOf = (i: ModelInput) => Math.abs(i.r1m ?? 0);

  // Ascending-rank helpers (rank 0 = worst, rank n-1 = best) → cross-sectional percentiles.
  const byR3mAsc     = [...valid].sort((a, b) => a.r3m! - b.r3m!);
  const byAccelAsc   = [...valid].sort((a, b) => accelOf(a) - accelOf(b));
  const byStretchAsc = [...valid].sort((a, b) => stretchOf(a) - stretchOf(b));
  const byR1mAbsAsc  = [...valid].sort((a, b) => r1mAbsOf(a) - r1mAbsOf(b));
  const rankR3mAsc     = new Map(byR3mAsc.map((r, i) => [r.symbol, i]));
  const rankAccelAsc   = new Map(byAccelAsc.map((r, i) => [r.symbol, i]));
  const rankStretchAsc = new Map(byStretchAsc.map((r, i) => [r.symbol, i]));
  const rankR1mAbsAsc  = new Map(byR1mAbsAsc.map((r, i) => [r.symbol, i]));

  return items.map(item => {
    const hasReturns = item.r1m != null && item.r3m != null;
    const parts = hasReturns
      ? computeAccel(item.r1m as number, item.r3m as number, item.r6m)
      : { accel: 0, aRecent: 0, aBuild: 0 };
    const stretch = stretchOf(item);

    const accPctile  = hasReturns ? toP(rankAccelAsc.get(item.symbol) ?? 0, n) : 0;
    const p3m        = toP(rankR3mAsc.get(item.symbol) ?? 0, n);
    const pStretch   = toP(rankStretchAsc.get(item.symbol) ?? 0, n);
    const pR1mAbs    = toP(rankR1mAbsAsc.get(item.symbol) ?? 0, n);
    // EXT = worst of: (a) price stretched far above MA200 in vol units, or
    // (b) extreme recent 1M magnitude. The backtest showed that top r1m gainers
    // (+40-80%) reliably reverse — this catches them even when stretch is diluted
    // by a sector-wide rally (e.g., all commodities extended together).
    const pExt = Math.max(pStretch, pR1mAbs);

    // Regime: above the 200-day MA = structural tailwind. 200-day (not 200W) is
    // used because it is computable identically in the historical backtest.
    const above200d = item.price != null && item.ma200 != null && item.price > item.ma200;
    const reg = above200d ? 1.0 : item.ma200 == null ? 0.5 : 0.2;

    // Commodities carry a heavier over-extension penalty (they snap back harder),
    // but because the penalty scales with pExt a commodity that is only modestly
    // stretched — i.e. early in a real trend — is barely touched.
    const W = MODEL_WEIGHTS;
    const extWeight = isCommodity(item) ? COMMODITY_EXT_WEIGHT : W.extension;
    const score = hasReturns
      ? W.acceleration * accPctile + W.trend * p3m + W.regime * reg - extWeight * pExt
      : -1;

    // BUILDING acceleration required: both legs positive AND r1m not a blow-off spike.
    // The hard cap on r1m hard-excludes extreme single-month outliers (Ondo +64%,
    // Zcash +82%) that the scoring EXT penalty alone can't fully demote because ACC
    // rewards them just as strongly. Commodities use a TIGHTER cap (25% vs 50%):
    // the backtest showed commodity spikes above ~25%/month (Silver +41%, WTI +44%,
    // Palladium +39%) reliably reverse, while equity moves of that size can persist.
    const r1mCap = isCommodity(item) ? COMMODITY_R1M_CAP : R1M_CAP;
    const passesGate = hasReturns && item.r1m! > 0 && item.r1m! < r1mCap && item.r3m! > 0
      && parts.aRecent > 0 && parts.aBuild > 0;

    return {
      item, score, accel: parts.accel, accPctile,
      aRecent: parts.aRecent, aBuild: parts.aBuild, stretch, passesGate,
    };
  });
}

// ── Realized volatility helper ──────────────────────────────────────────────
// Monthly realized volatility (%) from a series of daily closes — the stdev of
// daily simple returns scaled by √21. Used by both the live route and the
// backtest so "stretch in σ units" means the same thing at any date. Lookback
// defaults to ~3 months (63 trading days) to track the current vol regime.
export function realizedMonthlyVol(closes: number[], lookback = 63): number | null {
  if (closes.length < 21) return null;
  const window = closes.slice(-lookback);
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1], b = window[i];
    if (a > 0) rets.push(b / a - 1);
  }
  if (rets.length < 15) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(21) * 100;
}
