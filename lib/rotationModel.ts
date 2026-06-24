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
 *   p1  = r1m                                   (last ~1 month)
 *   p3  = ((1+r3m/100)^(1/3) − 1)·100           (avg monthly over last 3 months)
 *   p6  = ((1+r6m/100)^(1/6) − 1)·100           (avg monthly over last 6 months)
 *   p1y = ((1+r1y/100)^(1/12) − 1)·100          (avg monthly over last 12 months)
 *
 * Three successive accelerations (v5):
 *   aRecent = p1 − p3    (last month vs quarter)
 *   aBuild  = p3 − p6    (quarter vs half-year → building)
 *   aLong   = p6 − p1y   (half-year vs annual  → the whole curve is re-accelerating)
 *
 *   ACCEL = 0.50·aRecent + 0.30·aBuild + 0.20·aLong  (3-horizon; all data available)
 *   ACCEL = 0.60·aRecent + 0.40·aBuild               (fallback when r1y absent)
 *
 * aLong distinguishes a maturing trend (1Y pace > 6M pace → the run is winding
 * down) from a genuine new acceleration (6M pace > 1Y pace → momentum building
 * into every horizon). A classic blow-off scores well on aRecent but has aLong<0
 * because the year-long pace was higher than the current 6M pace.
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
 *   Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL − wEXT·EXT   (each input 0..1)
 *     ACC — 3-horizon pace-ladder percentile (primary acceleration signal)
 *     TRD — r3m/r6m blend percentile (the move is real and sustained)
 *     REG — regime: price above its 200-day MA (1.0) / below (0.2) / no data (0.5)
 *     VOL — volume confirmation: latestVol/avg20dVol percentile (null→0.5 neutral)
 *     EXT — over-extension percentile (SUBTRACTED): the blow-off guard
 *     wEXT: 0.20 standard · 0.32 commodities
 *
 *   Gate (shown in the Accelerating shortlist only if):
 *     r1m > 0  AND  r3m > 0  AND  aRecent > 0  AND  r1m < cap
 *   — rising AND recently accelerating. aBuild is a ranking signal, NOT a gate
 *   blocker: hard-excluding it in shock periods produces too few picks. Assets
 *   with strong aBuild still rank higher via ACCEL. Top ACCEL_LIMIT by score.
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
  acceleration: 0.45, // ACC — 3-horizon pace-ladder percentile
  trend:        0.25, // TRD — r3m/r6m blend percentile
  regime:       0.10, // REG — price vs 200-day MA
  extension:    0.20, // EXT — over-extension penalty (wEXT = 0.20; commodities 0.32)
  volume:       0.04, // VOL — volume confirmation (null→0.5 neutral, so backtest unaffected)
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

// Size of the "who actually won" leaderboard in the backtest (top N by forward
// return). This is a BENCHMARK size, NOT a cap on the model's picks.
export const ACCEL_LIMIT = 8;

// Safety ceiling on the Accelerating shortlist. The GATE decides how many names
// actually qualify — it can be 3 in a shock or 20 in a broad rally. This only
// prevents the list from ballooning to the entire universe in a mega-bull;
// names are ranked by score, so the strongest always come first.
export const ACCEL_MAX = 25;

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
  score: number;        // composite (higher = stronger acceleration candidate)
  accel: number;        // raw pace-ladder acceleration in percentage points
  accPctile: number;    // cross-sectional percentile of accel (0..1) — the Quadrant Y-axis
  aRecent: number;      // p1 − p3 (recent leg)
  aBuild: number;       // p3 − p6 (build leg)
  aLong: number | null; // p6 − p1y_pace (long leg; null when r1y unavailable)
  stretch: number;      // monthly-σ above the 200-day MA (blow-off measure)
  passesGate: boolean;  // r1m>0 AND r3m>0 AND aRecent>0 AND r1m<cap
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

export interface AccelParts { accel: number; aRecent: number; aBuild: number; aLong: number | null }

// 3-horizon pace-ladder acceleration.
// r6m: needed for the build leg (3M vs 6M). Without it build leg = 0.
// r1y: needed for the long leg (6M vs 1Y). Without it aLong = null.
//
// With full data:   ACCEL = 0.50·aRecent + 0.30·aBuild + 0.20·aLong
// Without r1y:      ACCEL = 0.60·aRecent + 0.40·aBuild  (v4 formula)
// Without r6m:      ACCEL = aRecent
//
// aLong catches maturing trends: if the 1Y pace > 6M pace the run is winding
// down (aLong<0), dragging ACCEL lower even when aRecent is still positive.
export function computeAccel(r1m: number, r3m: number, r6m?: number | null, r1y?: number | null): AccelParts {
  const p1 = r1m;
  const p3 = paceMonthly(r3m, 3);
  const aRecent = p1 - p3;

  if (r6m == null) {
    return { accel: aRecent, aRecent, aBuild: 0, aLong: null };
  }
  const p6    = paceMonthly(r6m, 6);
  const aBuild = p3 - p6;

  if (r1y == null) {
    const accel = 0.60 * aRecent + 0.40 * aBuild;
    return { accel, aRecent, aBuild, aLong: null };
  }
  const p1y  = paceMonthly(r1y, 12);
  const aLong = p6 - p1y;
  // aLong is a BRAKE, never a booster: only its NEGATIVE side feeds the score.
  // A maturing trend (1Y pace > 6M pace → aLong<0) is demoted, but a dormant asset
  // that just woke up (flat 1Y, recent pop → aLong>0) gets NO bonus — otherwise the
  // pace ladder would reward exactly the commodity pops (Sugar/Wheat/Corn) that
  // mean-revert. The recent/build legs already capture genuine acceleration.
  const accel = 0.55 * aRecent + 0.35 * aBuild + 0.20 * Math.min(0, aLong);
  return { accel, aRecent, aBuild, aLong };
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

  const accelOf = (i: ModelInput) => computeAccel(i.r1m as number, i.r3m as number, i.r6m, i.r1y).accel;
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
  // Volume confirmation: cross-sectional percentile of latestVol/avg20dVol.
  // Only items with a real volRatio participate; items without (backtest, most
  // crypto) get the neutral 0.5 rank — so the backtest is completely unaffected
  // and live mode gets real volume signal for assets that have the data.
  const validWithVol   = valid.filter(i => i.volRatio != null);
  const nVol           = validWithVol.length;
  const byVolRatioAsc  = [...validWithVol].sort((a, b) => (a.volRatio ?? 0) - (b.volRatio ?? 0));
  const rankVolRatioAsc = new Map(byVolRatioAsc.map((r, i) => [r.symbol, i]));
  // r6m rank — used as secondary trend signal in TRD. Only items with r6m data
  // participate (their pool is n6m, not n), so null-r6m items aren't penalised.
  const validWith6m  = valid.filter(i => i.r6m != null);
  const n6m          = validWith6m.length;
  const byR6mAsc     = [...validWith6m].sort((a, b) => a.r6m! - b.r6m!);
  const rankR6mAsc   = new Map(byR6mAsc.map((r, i) => [r.symbol, i]));

  return items.map(item => {
    const hasReturns = item.r1m != null && item.r3m != null;
    const parts = hasReturns
      ? computeAccel(item.r1m as number, item.r3m as number, item.r6m, item.r1y)
      : { accel: 0, aRecent: 0, aBuild: 0, aLong: null as number | null };
    const stretch = stretchOf(item);

    const accPctile  = hasReturns ? toP(rankAccelAsc.get(item.symbol) ?? 0, n) : 0;
    const p3m        = toP(rankR3mAsc.get(item.symbol) ?? 0, n);
    // TRD = composite trend signal: primary 3M (captures recent momentum), secondary
    // 6M (captures medium-term trend when 3M is a poor measurement snapshot). The
    // blend reduces sensitivity to the exact measurement date — e.g. an asset in a
    // strong 6M uptrend that pulls back slightly before measurement still gets TRD
    // credit from the 6M leg, avoiding it being penalised for the short-term dip.
    const p6m_trd  = item.r6m != null && n6m > 0 ? toP(rankR6mAsc.get(item.symbol) ?? 0, n6m) : p3m;
    const pTrend   = item.r6m != null ? 0.65 * p3m + 0.35 * p6m_trd : p3m;
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
    // Volume confirmation: high-vol breakout = stronger signal.
    // Items with volRatio=null (backtest, crypto) get 0.5 (neutral) so they're
    // unaffected; among live assets with real volume data it's a meaningful tie-breaker.
    const pVol = item.volRatio != null && nVol > 0
      ? toP(rankVolRatioAsc.get(item.symbol) ?? 0, nVol)
      : 0.5;

    const W = MODEL_WEIGHTS;
    const extWeight = isCommodity(item) ? COMMODITY_EXT_WEIGHT : W.extension;
    const score = hasReturns
      ? W.acceleration * accPctile + W.trend * pTrend + W.regime * reg + W.volume * pVol - extWeight * pExt
      : -1;

    // Gate: r1m > 0 (rising), r1m < cap (not a blow-off), r3m > 0 (real trend),
    // aRecent > 0 (last month faster than the quarter → acceleration signal).
    // aBuild (quarter vs half-year) is intentionally NOT in the hard gate because:
    //   (a) it is already captured in ACCEL (0.4·aBuild), so building trends rank
    //       higher naturally; (b) excluding it as a gate in volatile/shock periods
    //       (e.g. tariff selloff March 2026) would leave fewer than 4 valid picks —
    //       the model showed only 4 picks in a universe of 60+, which is unusable.
    // The hard cap on r1m stays: single-month outliers (Ondo +64%, Zcash +82%)
    // that EXT alone can't demote (because ACC rewards them just as strongly).
    // Commodities: tighter cap (25% vs 50%) — event spikes above this threshold
    // reliably mean-revert (Silver +41%, WTI +44%, Palladium +39%).
    // Regime confirmation: a pick must NOT be trading below its 200-day MA. This
    // is the quality bar the backtest was missing — in shock periods the gate let
    // through low-quality momentum pops (Sugar/Wheat/Corn flashing up while still
    // below their 200d MA) that then mean-reverted, dragging the basket negative.
    // A genuine rebound that has reclaimed its 200d MA still qualifies (Semis, EV
    // off a correction), so the model's V-shape capability is preserved. When the
    // 200d MA is unknown (recently-listed asset, too little history) we DON'T
    // exclude — missing data must not be read as "below".
    const regimeOk = item.ma200 == null || item.price == null || item.price >= item.ma200;
    const r1mCap = isCommodity(item) ? COMMODITY_R1M_CAP : R1M_CAP;
    const passesGate = hasReturns && item.r1m! > 0 && item.r1m! < r1mCap && item.r3m! > 0
      && parts.aRecent > 0 && regimeOk;

    return {
      item, score, accel: parts.accel, accPctile,
      aRecent: parts.aRecent, aBuild: parts.aBuild, aLong: parts.aLong,
      stretch, passesGate,
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
