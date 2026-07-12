// ─────────────────────────────────────────────────────────────────────────────
// DALIO EMS v4 — un-biasing the guards (Ray's correction of the v3 collapse)
//
// v3 collapsed to reliability 0.0 (it bought world indices and MISSED every
// individual winner) because two HARD gates — DistMA ≤ 0.15 and R2_12m > 0.5 —
// structurally excluded high-beta stocks (they run far above their MA with a
// spikier, lower-R² path) and admitted only smooth low-vol indices. Ray's fix:
// SOFTEN both guards so the winners survive.
//
//   Score = decay · (0.45·V + 0.45·M + 0.10·Persistence) · (1 − 0.5·Overheat) · ExitFactor
//           + 0.15·TrendQuality
//
//   decay (replaces the DistMA hard cap — the #1 fix): only bites when the move
//     is BOTH far above the MA AND a short-term blow-off:
//       decay = exp(−k·max(0, DistMA − 0.15))  when Ret20 > 30%,  else 1   (k = 0.7)
//     A stock 40% above its MA with modest recent gains keeps a full score;
//     one 40% above AND up 35% in a month is damped.
//
//   TrendQuality (replaces the R² hard gate): a SOFT additive reward, not a gate:
//       TrendQuality = min(1, R2_12m / 0.8)   ·   weight 0.15
//     Clean trends get a boost, but a volatile winner is no longer disqualified.
//
//   V           = max(0, VolRatio − 1.1)   (volume-blind → 0.20·RangeExpansion)
//   M           = 0.4·pctile(Ret20) + 0.3·pctile(Ret60) + 0.3·pctile(Ret12m)
//   Persistence = pctile(Ret20 / Ret60)   (acceleration)
//   Overheat    = commodity late-cycle brake (Price/Median12m>1.5 & VolRatio>1.3)
//   ExitFactor  = (Ret20 ≥ Ret60 ? 1 : 0.7) · (R2_12m < 0.5 ? 0.8 : 1)
//
//   Ranking is GLOBAL by Score (top N), tie-break VolRatio then RelStr. There is
//   no hard cycle gate any more — the high-return winners rise to the top on M,
//   which is what the capture objective needs. (Ray also proposed per-asset-class
//   slots for portfolio diversification; deliberately NOT applied here because
//   capping stock slots would cap the very stock-capture we optimise for — it is
//   a risk-management overlay, not a capture booster. Easy to add if wanted.)
//   Ret60 ≈ 3-month, Ret12m ≈ 1-year, R2_12m = trailing ~12-month trend R².
// ─────────────────────────────────────────────────────────────────────────────

export const DALIO_W_V = 0.45;
export const DALIO_W_M = 0.45;
export const DALIO_W_P = 0.10;
export const DALIO_W_TREND = 0.15;          // additive TrendQuality weight (soft R²)
export const DALIO_VOL_FLOOR = 1.1;         // V = max(0, VolRatio − 1.1)
export const DALIO_DISTMA_KNEE = 0.15;      // decay knee: no penalty until >15% above MA
export const DALIO_DECAY_K = 0.7;           // decay steepness
export const DALIO_DECAY_RET = 30;          // decay only triggers when Ret20 > 30%
export const DALIO_TREND_SCALE = 0.8;       // TrendQuality = min(1, R²/0.8)
export const DALIO_R2_MIN = 0.5;            // exit-factor + phase threshold
export const DALIO_MBLEND_W = [0.4, 0.3, 0.3] as const; // Ret20 / Ret60 / Ret12m
export const DALIO_RANGE_BOOST = 0.20;      // volume-blind V = 0.20 · RangeExpansion
export const DALIO_OVERHEAT_PRICE = 1.5;    // commodity overheat: Price/Median12m threshold
export const DALIO_OVERHEAT_VOL = 1.3;      // commodity overheat: VolRatio threshold
export const DALIO_EXIT_DECEL = 0.7;        // ExitFactor when Ret20 < Ret60
export const DALIO_EXIT_R2 = 0.8;           // extra ExitFactor when R2_12m < 0.5
export const DALIO_MA200_BLOWOFF = 0.20;    // cycle phase label: > 20% above MA200
// ── v5 additions (Ray's capture-gap fixes) ──────────────────────────────────
export const DALIO_W_ACCEL = 0.10;          // acceleration overlay weight (Ray: 5–10%)
export const DALIO_W_DRAWDOWN = 0.30;       // quiet-accumulation (falling-winner) weight
export const DALIO_DD_BASE_SCALE = 0.20;    // base-proximity decay scale (near MA → 1)
export const DALIO_DD_ACCUM_SCALE = 0.25;   // accumulation normalization
export const DALIO_DD_DIST_MIN = -0.35;     // shallow/basing floor (−35%..+5%)
export const DALIO_DD_DIST_DEEP = -0.60;    // deep-drawdown floor (−60%..−35%, strict signature)
export const DALIO_DD_DIST_MAX = 0.05;      // must be at/below the MA (basing), not extended
export const DALIO_DD_DEEP_VOL = 1.5;       // deep tier: VolRatio surge threshold
export const DALIO_DD_DEEP_FLOW = 0.1;      // deep tier: net-buying (≈ Up/Down-Vol-Ratio > 1.2)
// Class tilt (Ray: stocks a slight edge, indices a slight discount — diversification
// without hard slots). The winners are individual stocks, so this lifts capture.
export const DALIO_CLASS_WEIGHT: Record<string, number> = {
  Stocks: 1.2, Sectors: 1.0, Crypto: 1.1, Commodities: 0.9, Indexes: 0.8,
};
export const DALIO_BENCHMARK = '^GSPC';

// ── Volume ratios (shared by the live route AND the backtest) ────────────────
export function advAt(vols: (number | null | undefined)[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let sum = 0, cnt = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const v = vols[i];
    if (v != null && v > 0) { sum += v; cnt++; }
  }
  return cnt >= Math.ceil((2 * n) / 3) ? sum / cnt : null;
}

export function dalioVolumeRatios(vols: (number | null | undefined)[]): { rvol5: number | null; rvol20: number | null } {
  const last = vols.length - 1;
  if (last < 64) return { rvol5: null, rvol20: null };
  const ratios: number[] = [];
  for (let k = 0; k < 5; k++) {
    const end = last - k;
    const a5 = advAt(vols, end, 5);
    const a60 = advAt(vols, end, 60);
    if (a5 != null && a60 != null && a60 > 0) ratios.push(a5 / a60);
  }
  const rvol5 = ratios.length >= 3 ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;
  const a20 = advAt(vols, last, 20);
  const a60 = advAt(vols, last, 60);
  const rvol20 = a20 != null && a60 != null && a60 > 0 ? a20 / a60 : null;
  return { rvol5, rvol20 };
}

// ── Range-expansion proxy (flow substitute for volume-blind assets) ──────────
export function rangeExpansion(closes: number[]): number | null {
  if (closes.length < 65) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.abs(closes[i] / closes[i - 1] - 1));
  }
  if (rets.length < 60) return null;
  const recent = rets.slice(-5).reduce((s, r) => s + r, 0) / 5;
  const base = rets.slice(-60).reduce((s, r) => s + r, 0) / 60;
  return base > 0 ? Math.max(0, Math.min(1, recent / base - 1)) : 0;
}

// ── Money flow (v5) — net buying pressure over the last n days ───────────────
// (up-day volume − down-day volume) / total volume ∈ [−1, 1]. A Chaikin-style
// accumulation gauge: positive = net buying even when price is flat/down. Needs
// real volume, so it is null for volume-blind assets (indices/futures).
export function moneyFlow20(closes: number[], vols: (number | null | undefined)[], n = 20): number | null {
  const len = closes.length;
  if (len < n + 1) return null;
  let up = 0, down = 0, tot = 0;
  for (let i = len - n; i < len; i++) {
    const v = vols[i];
    if (v == null || v <= 0) continue;
    if (closes[i] > closes[i - 1]) up += v;
    else if (closes[i] < closes[i - 1]) down += v;
    tot += v;
  }
  return tot > 0 ? (up - down) / tot : null;
}

// ── 5 trading-day return (v5 acceleration overlay input) ─────────────────────
export function ret5Trading(closes: number[]): number | null {
  if (closes.length < 6) return null;
  const cur = closes[closes.length - 1], past = closes[closes.length - 6];
  return past > 0 ? (cur / past - 1) * 100 : null;
}

// ── Acceleration overlay (Ray's #1 highest-impact change) ────────────────────
// accel = Ret5 / Ret20. Boost ramps 0→1 as accel goes 1.0→2.0, only when the
// 20-day trend is up. Catches names turning up faster than their own trend.
export function dalioAccelBoost(ret5: number | null | undefined, ret20: number | null | undefined): number {
  if (ret20 == null || ret20 <= 0 || ret5 == null) return 0;
  const accel = ret5 / ret20;
  return Math.max(0, Math.min(1, accel - 1));
}

// ── Quiet-accumulation / drawdown-quality (the falling-winner fix, v6) ───────
// Three tiers of "buyers accumulating before the crowd" (Ray): moneyFlow is the
// 20-day net directional volume — it doubles as OBV-slope-up AND Up/Down-Volume-
// Ratio, so a positive value is Ray's transaction signature.
//   • SHALLOW basing (−35%..+5% of MA), quality name (Ret12m > 0): volume building
//     (VolRatio ≥ 1.1) + net buying. Full weight.
//   • DEEP drawdown (−60%..−35%): the STRICT signature only — a real volume surge
//     (VolRatio ≥ 1.5) AND strong net buying (moneyFlow > 0.1 ≈ UDR > 1.2). No
//     Ret12m gate (deep winners have crashed), capped at half weight — separates a
//     base from a knife by transaction flow, not by price.
//   • THIN history (no Ret12m — spin-offs/IPOs like SNDK): a short-term uptrend
//     (Ret20 > 0 AND Ret5 > 0) + volume accumulation, lower weight.
// Returns 0 unless a tier's conditions align, so a falling knife (moneyFlow ≤ 0)
// never scores.
export function dalioDrawdownQuality(
  distMA: number | null,
  rvol5: number | null | undefined,
  moneyFlow: number | null | undefined,
  r2_12m: number | null | undefined,
  r1y: number | null | undefined,
  r20: number | null | undefined,
  r5: number | null | undefined,
): number {
  if (distMA == null || distMA > DALIO_DD_DIST_MAX || distMA < DALIO_DD_DIST_DEEP) return 0;
  if (rvol5 == null || moneyFlow == null) return 0;

  // DEEP drawdown (−60%..−35%): strict transaction signature, no trend gate.
  if (distMA < DALIO_DD_DIST_MIN) {
    if (rvol5 < DALIO_DD_DEEP_VOL || moneyFlow <= DALIO_DD_DEEP_FLOW) return 0;
    const accum = Math.min(1, ((rvol5 - 1) * moneyFlow) / DALIO_DD_ACCUM_SCALE);
    return 0.5 * accum;
  }

  // SHALLOW/basing (−35%..+5%): a quality uptrend OR a thin-history early uptrend.
  const uptrend = r1y != null && r1y > 0;
  const thin = r1y == null && r20 != null && r20 > 0 && r5 != null && r5 > 0;
  if (!uptrend && !thin) return 0;
  if (rvol5 < 1.1 || moneyFlow <= 0) return 0;
  const baseProximity = Math.exp(-Math.abs(distMA) / DALIO_DD_BASE_SCALE);
  const accum = Math.min(1, ((rvol5 - 1) * moneyFlow) / DALIO_DD_ACCUM_SCALE);
  const trendStrength = uptrend ? Math.max(0, Math.min(1, r2_12m ?? 0.4)) : 0.4; // thin → neutral
  const w = thin ? 0.6 : 1.0; // thin-history sleeve gets a lower weight (Ray)
  return w * baseProximity * accum * trendStrength;
}

export function dalioClassWeight(group: string): number {
  return DALIO_CLASS_WEIGHT[group] ?? 1.0;
}

// ── Median of the trailing n closes (commodity-overheat reference) ───────────
export function medianClose(closes: number[], n = 252): number | null {
  const w = closes.slice(-n).filter(c => c > 0).sort((a, b) => a - b);
  if (w.length < 30) return null;
  const m = Math.floor(w.length / 2);
  return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
}

// ── V sub-score ──────────────────────────────────────────────────────────────
export function dalioVSub(volRatio: number | null | undefined, rangeExp: number | null | undefined): number {
  if (volRatio != null) return Math.max(0, volRatio - DALIO_VOL_FLOOR);
  return DALIO_RANGE_BOOST * (rangeExp ?? 0);
}

// ── DistMA decay (Ray's fix #1 — soft, conditional blow-off brake) ───────────
// Returns the multiplicative factor in (0, 1]. 1 unless the move is BOTH far
// above the MA (>15%) AND a short-term blow-off (Ret20 > 30%). distMA passed
// through for display; null MA → no penalty.
export function dalioDecay(distMA: number | null, ret20Pct: number | null | undefined): number {
  if (distMA == null || ret20Pct == null || ret20Pct <= DALIO_DECAY_RET) return 1;
  const over = Math.max(0, distMA - DALIO_DISTMA_KNEE);
  return over > 0 ? Math.exp(-DALIO_DECAY_K * over) : 1;
}

// ── TrendQuality (Ray's fix #2 — soft R² reward, not a gate) ─────────────────
export function dalioTrendQuality(r2_12m: number | null | undefined): number {
  if (r2_12m == null) return 0.5; // thin history → neutral, never disqualifying
  return Math.min(1, Math.max(0, r2_12m) / DALIO_TREND_SCALE);
}

// ── Commodity overheat penalty (0–1) ─────────────────────────────────────────
export function dalioOverheat(
  isCommodity: boolean,
  price: number | null | undefined,
  median12m: number | null | undefined,
  volRatio: number | null | undefined,
): number {
  if (!isCommodity || price == null || median12m == null || median12m <= 0 || volRatio == null) return 0;
  const priceRatio = price / median12m;
  if (priceRatio > DALIO_OVERHEAT_PRICE && volRatio > DALIO_OVERHEAT_VOL) {
    const raw = Math.min(1, (priceRatio - DALIO_OVERHEAT_PRICE) / 0.5) * (volRatio - DALIO_OVERHEAT_VOL);
    return Math.max(0, Math.min(1, raw));
  }
  return 0;
}

// ── Exit / exhaustion factor (0.56–1) ────────────────────────────────────────
export function dalioExitFactor(ret20: number | null | undefined, ret60: number | null | undefined, r2_12m: number | null | undefined): number {
  let f = ret20 != null && ret60 != null && ret20 >= ret60 ? 1 : DALIO_EXIT_DECEL;
  if (r2_12m != null && r2_12m < DALIO_R2_MIN) f *= DALIO_EXIT_R2;
  return f;
}

export type CyclePhase = 'bottoming' | 'recovering' | 'early trend' | 'stretched' | 'blow-off';

export function dalioPhase(distMA: number | null, r2_12m: number | null): CyclePhase | null {
  if (distMA == null) return null;
  if (distMA > DALIO_MA200_BLOWOFF) return 'blow-off';
  if (distMA > DALIO_DISTMA_KNEE) return 'stretched';
  if (distMA < 0) return 'bottoming';
  if (r2_12m != null && r2_12m > DALIO_R2_MIN) return 'early trend';
  return 'recovering';
}

// ── Panel-facing evaluation (the transparency view) ──────────────────────────
export interface DalioInput {
  symbol: string;
  name: string;
  group: string;
  price: number | null;
  ma200: number | null;
  median12m: number | null;
  rvol5: number | null;
  rvol20: number | null;
  rangeExp: number | null;
  r5: number | null;         // Ret5 (5 trading-day return) — acceleration overlay
  r20: number | null;        // Ret20
  r1m: number | null;        // fallback for r20
  r3m: number | null;        // Ret60 (≈3-month)
  r1y: number | null;        // Ret12m (≈1-year)
  trendR2Long: number | null;// R2_12m
  moneyFlow: number | null;  // net buying pressure −1..1 (quiet-accumulation sleeve)
}

export interface EmsEval {
  symbol: string;
  name: string;
  group: string;
  hasVolume: boolean;
  volRatio: number | null;
  ret20: number | null;
  rs20: number | null;
  distMA: number | null;
  r2_12m: number | null;
  V: number;
  M: number;
  persistPct: number;
  trendQuality: number;
  decay: number;
  overheat: number;
  exitFactor: number;
  accelBoost: number;        // acceleration overlay contribution (0–1)
  drawdownQuality: number;   // quiet-accumulation contribution (0–1)
  ems: number | null;
  ranked: boolean;
  phase: CyclePhase | null;
  macroFlagged: boolean;
  reasons: string[];
}

function pctileIn(sorted: number[], v: number): number {
  if (sorted.length < 2) return 0.5;
  let lo = 0;
  while (lo < sorted.length && sorted[lo] < v) lo++;
  return lo / (sorted.length - 1);
}

const isCommodityGroup = (g: string) => g === 'Commodities';

/**
 * Score and rank the whole universe with EMS v4. Ranked (eligible) assets first,
 * sorted by Score desc, tie-break VolRatio then RelStr; then the rest.
 */
export function rankEms(items: DalioInput[], macroFlagged: Set<string> = new Set()): EmsEval[] {
  const r20Of = (i: DalioInput) => i.r20 ?? i.r1m;
  const bench = items.find(i => i.symbol === DALIO_BENCHMARK);
  const benchRet = bench ? r20Of(bench) : null;

  const s20 = items.map(r20Of).filter((v): v is number => v != null).sort((a, b) => a - b);
  const s60 = items.map(i => i.r3m).filter((v): v is number => v != null).sort((a, b) => a - b);
  const s12 = items.map(i => i.r1y).filter((v): v is number => v != null).sort((a, b) => a - b);
  const accelOf = (i: DalioInput): number | null => {
    const r20 = r20Of(i);
    return r20 != null && i.r3m != null && i.r3m > 0 ? r20 / i.r3m : null;
  };
  const sAccel = items.map(accelOf).filter((v): v is number => v != null).sort((a, b) => a - b);

  const evals: EmsEval[] = items.map(it => {
    const hasVolume = it.rvol5 != null;
    const reasons: string[] = [];
    if (!hasVolume) reasons.push('no volume → V from range-expansion proxy');

    const ret = r20Of(it);
    const p20 = ret != null ? pctileIn(s20, ret) : 0.5;
    const p60 = it.r3m != null ? pctileIn(s60, it.r3m) : 0.5;
    const p12 = it.r1y != null ? pctileIn(s12, it.r1y) : 0.5;
    const M = DALIO_MBLEND_W[0] * p20 + DALIO_MBLEND_W[1] * p60 + DALIO_MBLEND_W[2] * p12;
    const aj = accelOf(it);
    const persistPct = aj != null ? pctileIn(sAccel, aj) : 0;

    const V = dalioVSub(it.rvol5, it.rangeExp);
    const distMA = it.price != null && it.ma200 != null && it.ma200 > 0 ? it.price / it.ma200 - 1 : null;
    const decay = dalioDecay(distMA, ret);
    const trendQuality = dalioTrendQuality(it.trendR2Long);
    const overheat = dalioOverheat(isCommodityGroup(it.group), it.price, it.median12m, it.rvol5);
    const exitFactor = dalioExitFactor(ret, it.r3m, it.trendR2Long);
    const rs20 = ret != null && benchRet != null ? ret - benchRet : null;

    const accelBoost = dalioAccelBoost(it.r5, ret);
    const drawdownQuality = dalioDrawdownQuality(distMA, it.rvol5, it.moneyFlow, it.trendR2Long, it.r1y, ret, it.r5);
    const base = DALIO_W_V * V + DALIO_W_M * M + DALIO_W_P * persistPct;
    const core = decay * base * (1 - 0.5 * overheat) * exitFactor + DALIO_W_TREND * trendQuality;
    const ems = it.price == null
      ? null
      : (core + DALIO_W_ACCEL * accelBoost + DALIO_W_DRAWDOWN * drawdownQuality) * dalioClassWeight(it.group);

    let ranked = it.symbol !== DALIO_BENCHMARK && ems != null && ems > 0;
    if (it.symbol === DALIO_BENCHMARK) reasons.push('benchmark itself');
    if (ems == null) reasons.push('no price data');
    if (drawdownQuality > 0) reasons.push(`quiet accumulation in a base (${(drawdownQuality * 100).toFixed(0)}%)`);
    if (accelBoost > 0) reasons.push(`accelerating (5d/20d) +${(accelBoost * 100).toFixed(0)}%`);
    if (decay < 1) reasons.push(`blow-off decay ${decay.toFixed(2)}× (${((distMA ?? 0) * 100).toFixed(0)}% above MA + ${ret?.toFixed(0)}% in 20d)`);
    if (overheat > 0) reasons.push(`commodity overheat −${(overheat * 50).toFixed(0)}%`);
    if (exitFactor < 1) reasons.push(`exhaustion ExitFactor ${exitFactor.toFixed(2)}`);

    return {
      symbol: it.symbol, name: it.name, group: it.group,
      hasVolume, volRatio: it.rvol5, ret20: ret, rs20,
      distMA, r2_12m: it.trendR2Long,
      V, M, persistPct, trendQuality, decay, overheat, exitFactor, accelBoost, drawdownQuality, ems, ranked,
      phase: dalioPhase(distMA, it.trendR2Long),
      macroFlagged: macroFlagged.has(it.symbol),
      reasons,
    };
  });

  const order = (a: EmsEval, b: EmsEval) =>
    ((b.ems ?? -1) - (a.ems ?? -1)) ||
    ((b.volRatio ?? 1.0) - (a.volRatio ?? 1.0)) ||
    ((b.rs20 ?? -Infinity) - (a.rs20 ?? -Infinity));

  const rankedList = evals.filter(e => e.ranked).sort(order);
  const rest = evals.filter(e => !e.ranked).sort(order);
  return [...rankedList, ...rest];
}
