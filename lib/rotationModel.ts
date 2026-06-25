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
 *   ACCEL = 0.50·aRecent + 0.35·aBuild + 0.15·aLong  (3-horizon, M9 symmetric aLong)
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
 * ── M6: volatility is the ENGINE, not the enemy ──────────────────────────────
 * The backtest exposed the core flaw: the old TRD divided return by volatility
 * (a Sharpe-like term, SHA). That REWARDS smooth low-vol assets and PENALISES
 * the volatile ones — but the biggest winners ARE the volatile ones. At the 5Y
 * date the model bought ADBE (+16%, then −66%) and INTU (−46%) — smooth, low-vol
 * software — and MISSED MU (+1178%) and AVGO (+726%) — high-vol semis. A bond can
 * "accelerate" but will never 10× because its volatility caps it; you WANT the
 * assets with the capacity for big moves. So M6 deletes SHA and adds volQuality:
 *
 *   volEdge = upsideSemiDev − downsideSemiDev   (net "good" volatility, %/month)
 *   VQ = pctile(volEdge)
 *
 * volEdge is HIGH for an asset whose big daily moves are mostly UP (a real engine:
 * NVDA, MU), ~0 for a low-vol bond (no capacity) AND for a symmetric churner, and
 * NEGATIVE for a downside-heavy/crashing asset. It rewards capacity-with-direction.
 *
 * ── Cycle guard (CYC) ────────────────────────────────────────────────────────
 * A cyclical asset can have acceleration AND good upside volatility yet blow off
 * and crash on an external shock (oil +44% then −25% on the Iran war). The tell:
 * a secular compounder marches up persistently for a year+ (high long-horizon
 * trend R²); a cyclical pop is a flat/choppy base with a recent vertical spike
 * (low long-horizon R²). CYC = pctile(trendR2 over ~12 months) separates them —
 * it counterweights VQ so peak-cycle pops (high upside vol, low long-trend R²)
 * are demoted, while genuine compounders (high on both) are rewarded.
 *
 * ── Pre-breakout sleeve (M7) ─────────────────────────────────────────────────
 * The momentum gate by design rejects an asset that is not accelerating RIGHT
 * NOW — but the backtest showed the biggest 5Y winners were falling at the pick
 * date (MU −2.3%, AVGO −1.2% the month before Jun 2021) and only accelerated
 * later. So a few slots are reserved for "coiled springs": a real year-long
 * uptrend (r1y>0) pausing near its 52-week high, above its 200-day MA, whose flat
 * last month makes it FAIL the momentum gate. selectPicks() fills these reserved
 * slots first, then the momentum names. Commodities are excluded (their high
 * bases are cyclical tops). See PRE_BREAKOUT_* constants.
 *
 * ── M8: RSI overheat guard (the cyclical adjustment) + MACD confirmation ──────
 * Two classic close-only indicators, used the RIGHT way:
 *
 *   MACD (12/26/9): the histogram (macdLine − signal) IS a momentum-change
 *   measure — the same family as ACC. So it does NOT get its own pillar; it folds
 *   in as a small CONFIRMATION leg (pctile of histogram/price). It corroborates
 *   acceleration rather than adding a new axis.
 *
 *   RSI (Wilder 14): naively "buy low RSI" is ANTI-momentum — it would tell us to
 *   avoid the very winners that are accelerating. The valuable use is the cyclical
 *   adjustment we kept circling: an OVERBOUGHT cyclical is about to mean-revert
 *   (oil at RSI ~90 right before the Iran-war crash), while a secular compounder
 *   can sit at RSI 80 for months and keep winning. So RSI feeds an OVERHEAT PENALTY
 *   that bites HARD on cyclicals (commodities, crypto) and barely on everything
 *   else: overheat = clamp((rsi−70)/30, 0, 1), subtracted with a class-dependent
 *   weight. NVDA running hot is untouched; an oil/crypto blow-off is demoted.
 *
 *   ADX is intentionally NOT added: the true ADX needs intraday high/low we don't
 *   have in the backtest, and its job (trend strength/cleanliness) is already done
 *   by trendR2 (LEAD) and trendR2Long (CYC), which are close-only.
 *
 * ── Score ────────────────────────────────────────────────────────────────────
 *   Score = 0.34·ACC + 0.26·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG
 *           + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND
 *     ACC — 3-horizon pace-ladder percentile (primary acceleration signal)
 *           M9: aLong now SYMMETRIC (0.50·aRecent + 0.35·aBuild + 0.15·aLong)
 *     VQ  — net upside volatility percentile (M6 engine; M14 raised 0.22→0.26)
 *     TRD — 0.70·r1m-pctile + 0.30·r3m-pctile (M11: r1m primary → enables Recovering quadrant)
 *           M8 trimmed 0.14→0.10. r6m leaves TRD; it lives in ACC (aBuild) and CYC.
 *           An asset turning up (r1m>0, r3m<0) now scores near-neutral on TRD instead of
 *           being penalised, letting ACC carry the recovering signal to the top-left quadrant.
 *     CYC — long-horizon (~12mo) trend-persistence R² percentile (M7 cut 0.12→0.08)
 *     LEAD— 0.50·pos52w + 0.50·trendR2 percentile (M11: trendR2 equal to pos52w;
 *           a smooth recovery earns trend quality even without 52w-high leadership)
 *           M9: 0.10→0.12; best predictor of continued winner status
 *     REG — regime: pctile(price/MA200−1) graduated (M9: 0.08→0.06; gate already ensures above MA200)
 *     VOL — volume confirmation: latestVol/avg20dVol percentile (null→0.5 neutral)
 *     MACD— pctile(histogram/price) (M8 acceleration confirmation; null→0.5 neutral)
 *     EXT — over-extension percentile (SUBTRACTED): the blow-off guard
 *     OH  — RSI overheat (SUBTRACTED): clamp((rsi−70)/30,0,1), the cyclical guard
 *     wEXT: 0.20 standard · 0.32 commodities
 *     wOH : 0.12 cyclicals (commodities, crypto) · 0.03 everything else
 *   Picks: top 22 by score from gate-passers + 4 coiled-spring sleeve = up to 22 total
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
  acceleration: 0.34, // ACC — 3-horizon pace-ladder percentile (the #1 pillar: how & how much it accelerated)
  volQuality:   0.26, // VQ  — net upside volatility (M14: 0.22→0.26; every real top-25 winner is a high-beta upside engine — semis, miners, high-vol crypto — so tilt harder here to sink low-vol defensives that beat SPX but never lead)
  trend:        0.08, // TRD — near-term direction: 0.70·r1m-pctile + 0.30·r3m-pctile (M14: 0.10→0.08, 0.02 to VQ)
  cycle:        0.08, // CYC — long-horizon (~12mo) trend-persistence R² (M7: 0.12→0.08; it had over-rewarded smooth toppers)
  lead:         0.12, // LEAD — quality leadership: 52w-range position + short-trend smoothness (M9: 0.10→0.12)
  regime:       0.04, // REG — price vs 200-day MA (M14: 0.06→0.04, 0.02 to VQ; gate already ensures above MA200, LEAD is more predictive)
  volume:       0.04, // VOL — volume confirmation (null→0.5 neutral, so backtest unaffected)
  macd:         0.04, // MACD — histogram/price percentile (M8 acceleration confirmation; null→0.5 neutral)
  extension:    0.20, // EXT — over-extension penalty (wEXT = 0.20; commodities 0.32)
} as const;

// ── M8: RSI overheat guard (the cyclical adjustment) ─────────────────────────
// An OVERBOUGHT cyclical is about to mean-revert (oil at RSI ~90 right before the
// Iran-war crash); a secular compounder can run hot for months and keep winning.
// So overheat = clamp((rsi − 70)/30, 0, 1) is SUBTRACTED with a class-dependent
// weight: heavy on cyclicals (commodities + crypto, which blow off hardest), light
// on everything else (so NVDA at RSI 80 is barely touched). RSI is close-only, so
// it computes identically live and in the backtest with no look-ahead.
export const OVERHEAT_RSI_START = 70;   // penalty starts here, full at RSI 100
export const OVERHEAT_WEIGHT_CYCLICAL = 0.12; // commodities + crypto
export const OVERHEAT_WEIGHT_DEFAULT  = 0.03; // everything else (light touch)

// ── M13: RSI oversold REBOUND bonus (the other half of RSI) ──────────────────
// RSI is symmetric: overbought (>70) flags a blow-off, oversold (<40) flags a
// buy-the-dip. M8 only used the overbought side as a penalty. M13 adds the
// oversold side as a BONUS — but only where mean-reversion goes UP, never down:
//   • QUALITY SECULAR names only (scaled by CYC = 12mo trend persistence). A
//     genuine compounder oversold after a pullback (MU/CRDO at −16/−23% the month
//     before a +200% leg) snaps back; an oversold junk name keeps falling.
//   • Requires a structural year-long uptrend (r1y > 0) — no falling knives.
//   • Cyclicals get NOTHING (oversold crypto/commodity keeps crashing; their
//     overheat penalty stays, so RSI is a pure brake on them, a two-way signal
//     only on quality seculars). This mirrors the overheat asymmetry exactly.
//   oversold = clamp((40 − rsi)/(40 − 10), 0, 1)
//   bonus    = REBOUND_WEIGHT · oversold · pCyc   (added to score, quality-scaled)
export const OVERSOLD_RSI_START = 40;   // bonus starts when RSI drops below 40
export const OVERSOLD_RSI_FLOOR = 10;   // full bonus at RSI 10 (deeply oversold)
export const REBOUND_WEIGHT = 0.10;     // max lift for a deeply-oversold top-quality secular

// Cyclical asset classes: they mean-revert hardest off an overbought RSI, so the
// overheat guard bites them. Commodities (supply/demand & fear spikes) and crypto
// (pump-and-dump cycles) are the two most reflexive classes in the universe.
function isCyclical(i: ModelInput): boolean {
  const g = (i.group ?? '').toLowerCase();
  return g.startsWith('commodit') || g === 'crypto';
}

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
// actually qualify — it can be 3 in a shock or 22 in a broad rally. This only
// prevents the list from ballooning to the entire universe in a mega-bull;
// names are ranked by score, so the strongest always come first.
// History: M3 cut this 25→12 to chase basket RETURN. But the capture-first
// reliability later showed M3 caught the FEWEST real winners (13/53) — the
// concentration optimised the wrong thing. M4 widened back to 20: more breadth =
// more winners caught. M5 tried per-group caps to break correlated ETF clusters,
// but that just "shot into the crowd" (forced diversification dilutes conviction).
// M6 drops the caps entirely and instead fixes the ROOT cause — the model was
// picking low-volatility losers over high-volatility winners (see volQuality).
// M9 raises to 22: at 1Y backtest, MU passed the main gate but was ranked 21st+
// by score and was cut. Two extra slots reduce "gate-passed but ranked out" misses
// without shooting into the crowd — breadth has consistently helped capture rate.
// M13 raises to 25: capture rate was still 5-10/22; three more slots catch more of
// the real winners ranked just below the cut. pickFactor (min(1,avgPicks/6)) is
// already maxed at 6, so wider picks don't dilute the reliability score — and the
// names are score-ranked, so the strongest always come first.
export const ACCEL_MAX = 25;

// ── Pre-breakout sleeve (M7) ──────────────────────────────────────────────────
// The backtest's biggest blind spot: the largest 5Y winners were FALLING at the
// pick date (MU −2.3%, AVGO −1.2%, TSMC −5.1% the month before Jun 2021), so the
// acceleration gate correctly rejected them — they hadn't accelerated YET. To
// catch this profile we reserve a few slots for "coiled spring" names: a real
// year-long uptrend (r1y>0), still basing near its 52-week high (not a falling
// knife), structurally intact (price ≥ MA200), that the MAIN momentum gate
// rejected because its last month was flat/down. These are the pullbacks-within-
// uptrends that precede the next leg. Commodities are excluded (their "bases" are
// cyclical tops that break DOWN). M12: the sleeve now covers TWO profiles under
// the same criteria: (a) the original coiled spring near its 52w high, and (b) a
// quality pullback — a secular engine (high CYC/VQ) that has corrected more deeply
// but is still in a structural uptrend (r1y>0). The preScore ranking (CYC+VQ
// heavier than pos52w) ensures genuine engines (semis: high CYC, high VQ) outrank
// cyclical names (crypto: low CYC) when both qualify for the sleeve.
export const PRE_BREAKOUT_SLOTS = 6;     // M14: 4→6. The sleeve holds the biggest missed winners (semis/miners falling at the pick date — MU, AVGO, CRDO). Now that crypto coins are excluded, the extra slots go to quality seculars, not cyclical pops.
export const PRE_BREAKOUT_POS52W_MIN = 40; // M12: 60→40 — quality pullbacks allowed, not just near-52w-high names
export const PRE_BREAKOUT_R1M_FLOOR = -25; // M12: -20→-25 — catches CRDO-type −22.9% monthly drops

export interface ModelInput {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m?: number | null;     // needed for the pace-ladder build leg
  r1y: number | null;
  price: number | null;
  ma200: number | null;    // 200-day SMA (null → data unavailable, not "below")
  group?: string;          // asset class (e.g. 'Commodities') → enables class-aware blow-off control
  vol?: number | null;     // realized MONTHLY volatility in % (null → unavailable; feeds EXT stretch)
  volEdge?: number | null; // net upside volatility (upside − downside semidev, %/month) — VQ signal
  pos52w?: number | null;  // 0–100 position of the latest close in its 52-week range (LEAD signal)
  trendR2?: number | null; // 0–1 smoothness of the trailing ~6mo uptrend (LEAD signal; 0 if downtrend)
  trendR2Long?: number | null; // 0–1 ~12mo trend persistence (CYC signal; secular vs cyclical)
  rsi?: number | null;      // Wilder 14-day RSI 0–100 (M8 overheat guard; null → no penalty)
  macdHist?: number | null; // MACD histogram as % of price (M8 acceleration confirmation; null → 0.5)
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
  passesPreBreakout: boolean; // coiled-spring sleeve: year-long uptrend basing near its 52w high (M7)
  preScore: number;     // ranking score WITHIN the pre-breakout sleeve (0..1)
  rsi: number | null;   // Wilder 14-day RSI (M8; null when unavailable)
  overheat: number;     // 0..1 RSI-overheat amount actually penalised (M8 cyclical guard)
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
// With full data:   ACCEL = 0.50·aRecent + 0.35·aBuild + 0.15·aLong  (M9 symmetric)
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
  // aLong is now SYMMETRIC (M9). aLong > 0 means "6M monthly pace > 1Y monthly
  // pace" — the WHOLE curve is bending up, a genuine new leg is starting (NVDA
  // entering the AI era). We no longer suppress the positive side, because M8's
  // RSI overheat guard + commodity EXT penalties already handle the cyclical-pop
  // risk (Sugar/Wheat/Corn getting RSI 90 then crashing). Weight slightly reduced
  // 0.20→0.15 since the signal now contributes on both sides. aLong<0 (winding-
  // down trend) still brakes the score — just a bit less aggressively.
  const accel = 0.50 * aRecent + 0.35 * aBuild + 0.15 * aLong;
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
  const byR1mAsc     = [...valid].sort((a, b) => a.r1m! - b.r1m!);
  const byAccelAsc   = [...valid].sort((a, b) => accelOf(a) - accelOf(b));
  const byStretchAsc = [...valid].sort((a, b) => stretchOf(a) - stretchOf(b));
  const byR1mAbsAsc  = [...valid].sort((a, b) => r1mAbsOf(a) - r1mAbsOf(b));
  const rankR3mAsc     = new Map(byR3mAsc.map((r, i) => [r.symbol, i]));
  const rankR1mAsc     = new Map(byR1mAsc.map((r, i) => [r.symbol, i]));
  const rankAccelAsc   = new Map(byAccelAsc.map((r, i) => [r.symbol, i]));
  const rankStretchAsc = new Map(byStretchAsc.map((r, i) => [r.symbol, i]));
  const rankR1mAbsAsc  = new Map(byR1mAbsAsc.map((r, i) => [r.symbol, i]));
  // Graduated REG: percentile of (price/MA200 − 1) across universe.
  // M1 gave all above-MA200 assets REG=1.0 (no discrimination). Graduated REG
  // distinguishes a structural bull leader (far above MA200) from a fresh breakout
  // (barely above). Assets below MA200 rank low but the gate already hard-excludes them.
  // Null MA200 → 0.5 neutral (no data is not punished).
  const regValOf = (i: ModelInput): number | null =>
    i.price != null && i.ma200 != null && i.ma200 > 0 ? (i.price / i.ma200 - 1) * 100 : null;
  const validWithReg  = valid.filter(i => regValOf(i) != null);
  const nReg          = validWithReg.length;
  const byRegAsc      = [...validWithReg].sort((a, b) => (regValOf(a) ?? 0) - (regValOf(b) ?? 0));
  const rankRegAsc    = new Map(byRegAsc.map((r, i) => [r.symbol, i]));

  // LEAD inputs — cross-sectional percentiles of 52w-range position and trend R².
  // Each only ranks items that actually have the datum; missing → 0.5 neutral, so
  // assets without the data (and any caller that doesn't supply it) are unaffected.
  const validWithPos  = valid.filter(i => i.pos52w != null);
  const nPos          = validWithPos.length;
  const byPosAsc      = [...validWithPos].sort((a, b) => (a.pos52w ?? 0) - (b.pos52w ?? 0));
  const rankPosAsc    = new Map(byPosAsc.map((r, i) => [r.symbol, i]));
  const validWithTq   = valid.filter(i => i.trendR2 != null);
  const nTq           = validWithTq.length;
  const byTqAsc       = [...validWithTq].sort((a, b) => (a.trendR2 ?? 0) - (b.trendR2 ?? 0));
  const rankTqAsc     = new Map(byTqAsc.map((r, i) => [r.symbol, i]));

  // Volume confirmation: cross-sectional percentile of latestVol/avg20dVol.
  // Only items with a real volRatio participate; items without (backtest, most
  // crypto) get the neutral 0.5 rank — so the backtest is completely unaffected
  // and live mode gets real volume signal for assets that have the data.
  const validWithVol   = valid.filter(i => i.volRatio != null);
  const nVol           = validWithVol.length;
  const byVolRatioAsc  = [...validWithVol].sort((a, b) => (a.volRatio ?? 0) - (b.volRatio ?? 0));
  const rankVolRatioAsc = new Map(byVolRatioAsc.map((r, i) => [r.symbol, i]));
  // r6m is no longer ranked in TRD (M11). It still feeds ACC (aBuild = p3 − p6)
  // and CYC (12mo trend R²), where its 6-month durability signal belongs.
  // VQ — net upside volatility (M6). The biggest winners are HIGH-volatility
  // assets; a low-vol asset (bond, utility) literally cannot 10× because its
  // volatility caps it. The OLD model divided return by vol (Sharpe), rewarding
  // the smooth losers (ADBE/INTU) over the volatile winners (MU/AVGO). volEdge
  // ranks by upsideSemiDev − downsideSemiDev: high = an upside-dominated engine,
  // ~0 = a low-vol bond OR a symmetric churner, negative = downside-heavy/crashing.
  // Null → neutral 0.5 (assets without daily-return history aren't penalised).
  const validWithVQ  = valid.filter(i => i.volEdge != null);
  const nVQ          = validWithVQ.length;
  const byVQAsc      = [...validWithVQ].sort((a, b) => (a.volEdge ?? 0) - (b.volEdge ?? 0));
  const rankVQAsc    = new Map(byVQAsc.map((r, i) => [r.symbol, i]));
  // CYC — long-horizon (~12mo) trend persistence. Separates a secular compounder
  // (marches up for a year+ → high R²) from a cyclical pop (flat/choppy base with
  // a recent vertical spike → low R²) that blows off and crashes on an external
  // shock. Counterweights VQ: a peak-cycle pop scores high on VQ but low on CYC.
  const validWithCyc  = valid.filter(i => i.trendR2Long != null);
  const nCyc          = validWithCyc.length;
  const byCycAsc      = [...validWithCyc].sort((a, b) => (a.trendR2Long ?? 0) - (b.trendR2Long ?? 0));
  const rankCycAsc    = new Map(byCycAsc.map((r, i) => [r.symbol, i]));
  // MACD (M8) — histogram/price percentile, a CONFIRMATION of acceleration (same
  // family as ACC, so small weight). A rising/positive histogram = momentum still
  // building; negative = the trend is rolling over. Null → 0.5 neutral (backtest/
  // asset-safe), so items without enough history aren't penalised.
  const validWithMacd = valid.filter(i => i.macdHist != null);
  const nMacd         = validWithMacd.length;
  const byMacdAsc     = [...validWithMacd].sort((a, b) => (a.macdHist ?? 0) - (b.macdHist ?? 0));
  const rankMacdAsc   = new Map(byMacdAsc.map((r, i) => [r.symbol, i]));

  return items.map(item => {
    const hasReturns = item.r1m != null && item.r3m != null;
    const parts = hasReturns
      ? computeAccel(item.r1m as number, item.r3m as number, item.r6m, item.r1y)
      : { accel: 0, aRecent: 0, aBuild: 0, aLong: null as number | null };
    const stretch = stretchOf(item);

    const accPctile  = hasReturns ? toP(rankAccelAsc.get(item.symbol) ?? 0, n) : 0;
    const p3m        = toP(rankR3mAsc.get(item.symbol) ?? 0, n);
    // TRD = near-term direction (M11): 0.70·r1m-pctile + 0.30·r3m-pctile.
    // r1m is the primary signal: an asset turning up (r1m>0, r3m<0) scores near-
    // neutral on TRD instead of being penalised. The 3M leg acts as a quality filter
    // only — it keeps dead-cat bounces (good r1m on a still-crashing 3M) from scoring
    // too high on TRD, but it no longer dominates. r6m leaves TRD entirely; its
    // durability signal lives in ACC (aBuild = p3 − p6) and CYC (12mo trend R²).
    const p1m_trd  = toP(rankR1mAsc.get(item.symbol) ?? 0, n);
    const pTrend   = 0.70 * p1m_trd + 0.30 * p3m;
    const pStretch   = toP(rankStretchAsc.get(item.symbol) ?? 0, n);
    const pR1mAbs    = toP(rankR1mAbsAsc.get(item.symbol) ?? 0, n);
    // EXT = worst of: (a) price stretched far above MA200 in vol units, or
    // (b) extreme recent 1M magnitude. The backtest showed that top r1m gainers
    // (+40-80%) reliably reverse — this catches them even when stretch is diluted
    // by a sector-wide rally (e.g., all commodities extended together).
    const pExt = Math.max(pStretch, pR1mAbs);

    // Graduated REG: percentile of (price/MA200 − 1). Null MA200 → 0.5 neutral.
    // Far above MA200 = high rank, just above = mid, below = low rank.
    // The gate still hard-excludes below-MA200 assets from the shortlist;
    // graduated REG only refines the score among assets that PASS the gate.
    const regRaw = regValOf(item);
    const reg = regRaw != null && nReg > 0 ? toP(rankRegAsc.get(item.symbol) ?? 0, nReg) : 0.5;

    // Commodities carry a heavier over-extension penalty (they snap back harder),
    // but because the penalty scales with pExt a commodity that is only modestly
    // stretched — i.e. early in a real trend — is barely touched.
    // Volume confirmation: high-vol breakout = stronger signal.
    // Items with volRatio=null (backtest, crypto) get 0.5 (neutral) so they're
    // unaffected; among live assets with real volume data it's a meaningful tie-breaker.
    const pVol = item.volRatio != null && nVol > 0
      ? toP(rankVolRatioAsc.get(item.symbol) ?? 0, nVol)
      : 0.5;

    // LEAD — quality-leadership: 0.50·pos52w + 0.50·trendR2 (M11: equal weight).
    // pos52w: 52w-high momentum persists — George & Hwang 2004. High for trending names.
    // trendR2: smooth trends continue, jumpy ones reverse — "frog in the pan", Da et al.
    //   2014. A recovering asset can earn high trendR2 even when its pos52w is low.
    // M11 gives trendR2 equal weight so quality-of-recovery (smooth reversal) can lift
    // LEAD for turning assets. Trending leaders still score high on BOTH legs.
    // Missing data → 0.5 neutral (backtest/asset-safe).
    const pPos = item.pos52w != null && nPos > 0 ? toP(rankPosAsc.get(item.symbol) ?? 0, nPos) : 0.5;
    const pTq  = item.trendR2 != null && nTq  > 0 ? toP(rankTqAsc.get(item.symbol) ?? 0, nTq) : 0.5;
    const lead = 0.50 * pPos + 0.50 * pTq;

    // VQ — net upside volatility percentile (the "good volatility" engine). High =
    // capacity for big moves with an upside tilt; null → 0.5 neutral.
    const pVQ  = item.volEdge != null && nVQ > 0 ? toP(rankVQAsc.get(item.symbol) ?? 0, nVQ) : 0.5;
    // CYC — long-horizon trend persistence percentile (secular vs cyclical).
    const pCyc = item.trendR2Long != null && nCyc > 0 ? toP(rankCycAsc.get(item.symbol) ?? 0, nCyc) : 0.5;
    // MACD — acceleration confirmation percentile (M8). Null → 0.5 neutral.
    const pMacd = item.macdHist != null && nMacd > 0 ? toP(rankMacdAsc.get(item.symbol) ?? 0, nMacd) : 0.5;

    // OH — RSI overheat (M8 cyclical guard). Zero until RSI clears 70, full at 100.
    // Subtracted with a class-dependent weight: heavy on cyclicals (commodities,
    // crypto), light elsewhere — an overbought oil/crypto blow-off is demoted while
    // a secular grower running hot is barely touched. Null RSI → no penalty.
    const overheat = item.rsi != null
      ? Math.max(0, Math.min(1, (item.rsi - OVERHEAT_RSI_START) / (100 - OVERHEAT_RSI_START)))
      : 0;
    const ohWeight = isCyclical(item) ? OVERHEAT_WEIGHT_CYCLICAL : OVERHEAT_WEIGHT_DEFAULT;

    // M13 — RSI oversold REBOUND bonus (the buy-the-dip half of RSI). Mirrors the
    // overheat penalty: zero until RSI drops below 40, full at RSI 10. Added ONLY
    // for quality seculars in a structural uptrend (scaled by pCyc), so an oversold
    // compounder (MU/CRDO before its next leg) gets lifted while an oversold cyclical
    // or a name with no year-long uptrend gets nothing — no falling knives.
    const oversold = item.rsi != null
      ? Math.max(0, Math.min(1, (OVERSOLD_RSI_START - item.rsi) / (OVERSOLD_RSI_START - OVERSOLD_RSI_FLOOR)))
      : 0;
    const structuralUptrend = item.r1y != null && item.r1y > 0;
    const reboundWeight = (!isCyclical(item) && structuralUptrend) ? REBOUND_WEIGHT : 0;
    const reboundBonus = reboundWeight * oversold * pCyc;

    const W = MODEL_WEIGHTS;
    const extWeight = isCommodity(item) ? COMMODITY_EXT_WEIGHT : W.extension;
    const score = hasReturns
      ? W.acceleration * accPctile + W.volQuality * pVQ + W.trend * pTrend + W.cycle * pCyc
        + W.lead * lead + W.regime * reg + W.volume * pVol + W.macd * pMacd
        - extWeight * pExt - ohWeight * overheat + reboundBonus
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

    // ── Pre-breakout sleeve (M7) ──────────────────────────────────────────────
    // M12 pre-breakout sleeve: two profiles, one set of criteria.
    //   (a) Coiled spring (original M7): r1y>0, still near 52w high, structurally intact.
    //   (b) Quality pullback (new M12): a secular engine (semis, tech) in a deeper
    //       correction. Same r1y>0 quality bar; pos52w ≥ 40 (not at absolute bottom);
    //       price within 13% of MA200 (genuine dip, not a structural breakdown).
    //       This catches MU/CRDO-type names that have corrected 15-25% from highs
    //       before their next rocket leg — the single biggest source of missed winners.
    //
    // The preScore ranking (CYC+VQ weighted heavier than pos52w) sorts the sleeve
    // so secular engines (semis: high CYC + high VQ) always win over cyclicals
    // (crypto: low CYC) even if both qualify. A crypto name near its 52w high scores
    // high on pPos but low on pCyc; MU after a correction scores low on pPos but
    // high on pCyc + pVQ and therefore ranks first.
    //
    // Falling knives are rejected by the r1y>0 floor (structural uptrend must exist),
    // the r1m floor (−25%: a correction, not a crash), the pos52w floor (40%: not at
    // the bottom of the range), and the MA200 proximity check (price/MA200 ≥ 0.87).
    const preRegimeOk = item.ma200 != null && item.price != null
      && item.price / item.ma200 >= 0.87; // M12: allows pullbacks up to ~13% below MA200 (was strict ≥)
    // M14: exclude ALL cyclicals (crypto coins AND commodities), not just commodities.
    // The 3M backtest showed the sleeve filling with crypto-coin "rebounds" (Ondo,
    // Tron, Bitcoin, Litecoin, Sui) that DON'T lead the next leg — a basing crypto
    // coin is a cyclical top, not a coiled spring. They ate slots while the real
    // winners (CRDO, AMD, Semiconductors) were missed. isCyclical catches group
    // 'Crypto' (the coins) but NOT group 'Stocks' — so the winning bitcoin MINERS
    // (RIOT, IREN, WULF, CIFR, all 'Stocks') stay fully eligible for the sleeve.
    const passesPreBreakout = hasReturns && !passesGate && !isCyclical(item)
      && item.r1y != null && item.r1y > 0
      && item.pos52w != null && item.pos52w >= PRE_BREAKOUT_POS52W_MIN
      && item.r1m != null && item.r1m > PRE_BREAKOUT_R1M_FLOOR
      && preRegimeOk;
    // Rank within the sleeve: CYC (secular quality) + VQ (upside engine) heavy,
    // pos52w light. M12: 0.5/0.3/0.2 → 0.3/0.4/0.3. Semis beat crypto in this ranking
    // because semis have far higher CYC (12mo trend R²) and VQ (upside vol dominance).
    const preScore = 0.30 * pPos + 0.40 * pCyc + 0.30 * pVQ;

    return {
      item, score, accel: parts.accel, accPctile,
      aRecent: parts.aRecent, aBuild: parts.aBuild, aLong: parts.aLong,
      stretch, passesGate, passesPreBreakout, preScore,
      rsi: item.rsi ?? null, overheat: hasReturns ? overheat : 0,
    };
  });
}

// ── Pick selection (shared by the live list and the backtest) ────────────────
// M10: PURE SCORE. There is no binary gate gating membership any more — the SCORE
// alone decides. Top `maxTotal` by score = the Accelerating list = the backtest's
// picks = the top of the Quadrant. This is the "one formula" the whole tool is
// built on: change ANY weight and the membership, the ordering AND the quadrant
// positions all move together, because they all read this one number.
//
// Why the gate is gone: a binary gate (r1m>0 ∧ r3m>0 ∧ price≥MA200) FROZE the list
// — in a bull market ~25 names passed it and the same 22 always showed, so tuning
// the score weights changed nothing visible. The score already rewards rising,
// accelerating, above-MA200 names (that's what ACC/REG/LEAD are), so the gate was
// redundant AND it hid every formula change. Removing it makes the model fully
// responsive: the formula is the score, end to end.
//
// The pre-breakout sleeve is kept: up to `preSlots` reserved for the highest-
// ranked coiled-spring names (year-long uptrend basing near its 52w high), which
// can score mid-pack yet are the profile of the biggest 5Y winners at their base.
export function selectPicks<T extends ModelInput>(
  scored: ScoredItem<T>[],
  maxTotal = ACCEL_MAX,
  preSlots = PRE_BREAKOUT_SLOTS,
): ScoredItem<T>[] {
  const pre = scored
    .filter(s => s.passesPreBreakout)
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, preSlots);
  const preSet = new Set(pre.map(s => s.item.symbol));
  const mainSlots = Math.max(0, maxTotal - pre.length);
  // Pure score ranking. score === -1 marks items with no return data (scoreRotation
  // sentinel) — exclude them so only real, scorable assets fill the slots.
  const main = scored
    .filter(s => s.score > -1 && !preSet.has(s.item.symbol))
    .sort((a, b) => b.score - a.score)
    .slice(0, mainSlots);
  return [...main, ...pre];
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

// ── Net upside volatility (the "good volatility" engine — M6) ────────────────
// Splits daily returns into ups and downs and returns the difference of their
// root-mean-squares, scaled to a monthly %. This is the signal the old Sharpe
// term got backwards: instead of PENALISING volatility, it REWARDS the volatility
// that points UP and penalises the volatility that points DOWN.
//   upRms   = √(mean(r²) over positive days)   → magnitude of up-moves
//   downRms = √(mean(r²) over negative days)   → magnitude of down-moves
//   volEdge = (upRms − downRms)·√21·100
// HIGH  → an upside-dominated engine (NVDA, MU: big up moves, contained downside)
// ~0    → a low-vol bond (no capacity) OR a symmetric churner (ups ≈ downs)
// <0    → downside-heavy / crashing. Computed identically live and in backtest
// (both feed daily closes up to the as-of date) so it never look-aheads.
export function upsideVolEdge(closes: number[], lookback = 63): number | null {
  if (closes.length < 21) return null;
  const window = closes.slice(-lookback);
  const up: number[] = [], down: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1], b = window[i];
    if (a > 0) { const r = b / a - 1; if (r >= 0) up.push(r); else down.push(r); }
  }
  if (up.length + down.length < 15) return null;
  const rms = (xs: number[]) => xs.length ? Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) : 0;
  return (rms(up) - rms(down)) * Math.sqrt(21) * 100;
}

// ── Trend quality (the "smooth trend" / frog-in-the-pan signal) ──────────────
// R² of an OLS fit of log(close) on time over the trailing window. A high R²
// means the uptrend is smooth and persistent (a durable compounder marching up
// in small steps — the kind that keeps winning); a low R² means the gain came
// from a few violent jumps (a pump prone to reverse). We only credit UPtrends:
// a smooth DOWNtrend would also have high R², so when the fitted slope ≤ 0 we
// return 0. Computed identically live and in the backtest (both feed it closes
// up to the as-of date), so it never look-aheads. ~126 closes ≈ 6 trading months,
// which fits inside the live route's 375-day fetch.
export function trendQualityR2(closes: number[], lookback = 126): number | null {
  const w = closes.slice(-lookback).filter(c => c > 0);
  const n = w.length;
  if (n < 40) return null;
  const ys = w.map(c => Math.log(c));
  // x = 0..n-1; closed-form OLS slope + R².
  const sumX = (n - 1) * n / 2;
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6;
  let sumY = 0, sumXY = 0;
  for (let i = 0; i < n; i++) { sumY += ys[i]; sumXY += i * ys[i]; }
  const denomX = n * sumX2 - sumX * sumX;
  if (denomX === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denomX;
  if (slope <= 0) return 0; // only reward genuine uptrends
  const meanY = sumY / n;
  const intercept = meanY - slope * (sumX / n);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * i;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  if (ssTot === 0) return 0;
  return Math.max(0, Math.min(1, 1 - ssRes / ssTot));
}

// ── RSI (Wilder, close-only) — the overheat guard's input (M8) ───────────────
// Classic 14-day Wilder RSI from daily closes: seed with the simple average gain/
// loss over the first `period` changes, then Wilder-smooth across the rest. 0–100.
// Computed identically live and in the backtest (both feed closes up to the as-of
// date) so it never look-aheads. null when there isn't enough history.
export function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d >= 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD histogram (close-only) — the acceleration confirmation (M8) ─────────
// Standard 12/26/9 MACD: histogram = (EMA12 − EMA26) − signal(EMA9 of that line),
// returned as a % of the latest price so it's comparable across assets at any
// scale. Positive = trend accelerating up; negative = momentum rolling over. The
// EMAs seed from the first close and converge well within our 400+-day window.
// Close-only → identical live and in the backtest, no look-ahead. null when short.
export function macdHistogram(closes: number[], fast = 12, slow = 26, signal = 9): number | null {
  if (closes.length < slow + signal) return null;
  const ema = (period: number): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = closes[0];
    for (let i = 0; i < closes.length; i++) {
      prev = i === 0 ? closes[0] : closes[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  };
  const emaFast = ema(fast), emaSlow = ema(slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const k = 2 / (signal + 1);
  let sig = macdLine[0];
  for (let i = 1; i < macdLine.length; i++) sig = macdLine[i] * k + sig * (1 - k);
  const last = closes[closes.length - 1];
  if (last <= 0) return null;
  const hist = macdLine[macdLine.length - 1] - sig;
  return (hist / last) * 100;
}
