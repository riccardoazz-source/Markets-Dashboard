// ─────────────────────────────────────────────────────────────────────────────
// DALIO EMS — EARLY-MOMENTUM COMPOSITE SCORE (directive v2 + refinement Q&A)
//
// The shared Dalio math: consumed by BOTH the live rotation model
// (MODEL_MODE = 'dalio' in lib/rotationModel.ts — quadrant, Accelerating list,
// backtest) and the transparency panel (components/sections/DalioPanel.tsx).
//
//   EMS = C · (wV·V + wM·M_final + wP·PersistenceNorm)   wV=0.40 wM=0.40 wP=0.20
//
//   V  (flow / transaction size):
//        volume assets  → max(0, VolRatio − 1.1)      VolRatio = 5d ADV ÷ 60d ADV, 5d-smoothed
//        volume-blind   → 0.20 · RangeExpansion       (indices/futures/foreign listings keep
//                         the flow thesis alive via a daily-range-expansion proxy, same 0–0.2 scale)
//
//   M_final (multi-horizon momentum, confirmed, blow-off-penalised):
//        M_blend   = 0.5·pctile(Ret20) + 0.3·pctile(Ret60) + 0.2·pctile(Ret180)
//        Confirmed = Price > MA200 AND Ret60 > 0            (else M_final = 0)
//        BlowOff   = Ret20 > 0.30 AND VolRatio < 1.2 → penalty = 0.5·(Ret20−0.30)/(1−0.30)
//        M_final   = M_blend · Confirmed · (1 − BlowOff)
//        (Ret20 = 20 trading-day return; Ret60 ≈ 3-month; Ret180 ≈ 6-month.)
//
//   PersistenceNorm = pctile( Ret60 / Ret20 )   for Ret20 > 0   — trend quality:
//        a short-term pop that is part of a longer up-trend (durable compounder)
//        outranks an isolated one-month spike.
//
//   C (cycle gate — 3 branches, must show SUSTAINABILITY, not just be off the high):
//        C = 1 if (near the 52w high AND ≤15% above the 200D MA)               // healthy momentum
//              OR (>5% below the high AND VolRatio ≥ 1.2 AND Price > MA200)     // volume-driven rebound
//              OR (Price > MA200 AND Ret180 > 0)                               // above trend + 6-month uptrend
//            else 0.
//
//   Pre-filter: RelStr = Ret20 − ^GSPC Ret20 > 0 (hard) then tie-break.
//   Ranking: drop C = 0 / RelStr ≤ 0 / EMS = 0 · sort desc EMS · ties VolRatio, then Ret20.
//   SeasonFactor deliberately deferred.
//
//   INTERPRETATION NOTES (assembled from the refinement answers — the final
//   consolidated block arrived truncated, so these are my reconciliations):
//   • V keeps the "surge above baseline" floor (max(0, VolRatio−1.1)); the
//     volume-blind proxy is scaled to the SAME 0–0.2 band (0.20·RangeExpansion)
//     rather than the literal "1.0 + 0.2·RangeExpansion", which would have made
//     no-volume assets dominate the floored volume assets — the opposite of intent.
//   • Ret60/Ret180 map to the 3-month/6-month returns already computed everywhere.
//   • RangeExpansion is a close-only proxy (recent vs baseline mean |daily return|)
//     so it needs no extra data plumbing and works for volume-blind assets too.
// ─────────────────────────────────────────────────────────────────────────────

export const DALIO_W_V = 0.40;
export const DALIO_W_M = 0.40;
export const DALIO_W_P = 0.20;
export const DALIO_VOL_FLOOR = 1.1;        // V = max(0, VolRatio − 1.1)
export const DALIO_VOL_SPIKE = 1.2;        // volume-spike threshold (C gate + blow-off)
export const DALIO_DISTMA_MAX = 0.15;      // ≤ 15% above the 200D MA
export const DALIO_HIGHDIST_MIN = -0.05;   // "within 5% of the 52w high" boundary
export const DALIO_BLOWOFF_RET = 0.30;     // Ret20 above this without a volume spike = blow-off
export const DALIO_RANGE_BOOST = 0.20;     // volume-blind V = 0.20 · RangeExpansion
export const DALIO_MA200_BLOWOFF = 0.20;   // cycle phase: > 20% above MA200 = blow-off
export const DALIO_MBLEND_W = [0.5, 0.3, 0.2] as const; // Ret20 / Ret60 / Ret180 blend weights
export const DALIO_BENCHMARK = '^GSPC';    // relative-strength benchmark

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
// recent 5-day mean |daily return| ÷ baseline 60-day mean, clamped to 0–1.
// >0 means the daily range is expanding (rising participation) even when there
// is no reported volume. Close-only, so identical live and in the backtest.
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

// ── V sub-score ──────────────────────────────────────────────────────────────
export function dalioVSub(volRatio: number | null | undefined, rangeExp: number | null | undefined): number {
  if (volRatio != null) return Math.max(0, volRatio - DALIO_VOL_FLOOR);
  return DALIO_RANGE_BOOST * (rangeExp ?? 0); // volume-blind flow proxy (0–0.2)
}

// ── Blow-off penalty on the momentum term ────────────────────────────────────
// Ret20 given in PERCENT. A large short-term jump with no volume surge is likely
// a speculative blow-off → linearly discount M up to 50% at Ret20 = 100%.
export function dalioBlowOffPenalty(ret20Pct: number | null | undefined, volRatio: number | null | undefined): number {
  if (ret20Pct == null) return 0;
  const r = ret20Pct / 100;
  const vr = volRatio ?? 1.0; // volume-blind → treated as no spike (penalty applies)
  if (r > DALIO_BLOWOFF_RET && vr < DALIO_VOL_SPIKE) {
    return Math.max(0, Math.min(0.5, 0.5 * (r - DALIO_BLOWOFF_RET) / (1 - DALIO_BLOWOFF_RET)));
  }
  return 0;
}

// ── Cycle gate C (3 branches) ────────────────────────────────────────────────
export interface DalioCParts {
  C: 0 | 1;
  distMA: number | null;    // decimal above/below the 200d MA
  highDist: number | null;  // decimal ≤ 0 (0 = at the 52w high)
  nearHigh: boolean;
  volSpike: boolean;
  aboveMA: boolean;
}

// Missing data is never read as "bad": null MA200 → aboveMA true (not penalised)
// and the DistMA condition passes; null 52w high → treated as not-near-high.
export function dalioCGate(
  price: number | null | undefined,
  ma200: number | null | undefined,
  high52w: number | null | undefined,
  volRatio: number | null | undefined,
  r6mPct: number | null | undefined,
): DalioCParts | null {
  if (price == null || price <= 0) return null;
  const distMA = ma200 != null && ma200 > 0 ? price / ma200 - 1 : null;
  const highDist = high52w != null && high52w > 0 ? price / high52w - 1 : null;
  const vr = volRatio ?? 1.0;
  const nearHigh = highDist != null && highDist >= DALIO_HIGHDIST_MIN;
  const volSpike = vr >= DALIO_VOL_SPIKE;
  const aboveMA = ma200 == null || ma200 <= 0 || price > ma200;
  const trend6mPos = r6mPct != null && r6mPct > 0;
  // Branch 1: near the high AND not stretched above trend → healthy momentum.
  const b1 = nearHigh && (distMA == null || distMA <= DALIO_DISTMA_MAX);
  // Branch 2: below the high BUT a volume surge above the long-term average → rebound.
  const b2 = !nearHigh && volSpike && aboveMA;
  // Branch 3: above the 200D MA AND a 6-month uptrend → sustainable structural trend.
  const b3 = aboveMA && trend6mPos;
  return { C: b1 || b2 || b3 ? 1 : 0, distMA, highDist, nearHigh, volSpike, aboveMA };
}

export type CyclePhase = 'bottoming' | 'recovering' | 'early trend' | 'stretched' | 'blow-off';

export function dalioPhase(parts: DalioCParts | null): CyclePhase | null {
  if (!parts || parts.distMA == null) return null;
  const { distMA, nearHigh, volSpike } = parts;
  if (nearHigh) {
    if (distMA > DALIO_MA200_BLOWOFF) return 'blow-off';
    if (distMA > DALIO_DISTMA_MAX) return 'stretched';
    return 'early trend';
  }
  if (volSpike) return 'blow-off'; // >5% off the high on a volume surge = distribution/over-extension
  if (distMA < 0) return 'bottoming';
  return 'recovering';
}

// ── Panel-facing evaluation (the transparency view) ──────────────────────────
export interface DalioInput {
  symbol: string;
  name: string;
  group: string;
  price: number | null;
  ma200: number | null;
  high52w: number | null;
  rvol5: number | null;      // VolRatio (null → volume-blind, uses rangeExp)
  rvol20: number | null;     // context only
  rangeExp: number | null;   // range-expansion proxy (volume-blind flow)
  r20: number | null;        // Ret20 (20 trading-day return %)
  r1m: number | null;        // fallback for r20
  r3m: number | null;        // Ret60 (≈3-month)
  r6m: number | null;        // Ret180 (≈6-month)
}

export interface EmsEval {
  symbol: string;
  name: string;
  group: string;
  hasVolume: boolean;
  volRatio: number | null;
  ret20: number | null;
  rs20: number | null;       // Ret20 − benchmark (pp) — hard pre-filter + tie-break
  distMA: number | null;
  highDist: number | null;
  V: number;
  mBlend: number;            // 0.5·p20 + 0.3·p60 + 0.2·p180 (before confirm/blow-off)
  confirmed: boolean;        // Price > MA200 AND Ret60 > 0
  mFinal: number;            // mBlend · confirmed · (1 − blowOff)
  persistPct: number;        // pctile(Ret60/Ret20) — trend-quality axis
  C: 0 | 1 | null;
  ems: number | null;
  ranked: boolean;
  phase: CyclePhase | null;
  macroFlagged: boolean;
  reasons: string[];
}

// Ascending percentile of v among a sorted array (0..1); neutral 0.5 if too few.
function pctileIn(sorted: number[], v: number): number {
  if (sorted.length < 2) return 0.5;
  let lo = 0;
  while (lo < sorted.length && sorted[lo] < v) lo++;
  return lo / (sorted.length - 1);
}

/**
 * Score and rank the whole universe with the revised EMS (v2). Ranked assets
 * first (desc EMS, tie-break VolRatio then Ret20), then the rest so the UI can
 * show why each one is out.
 */
export function rankEms(items: DalioInput[], macroFlagged: Set<string> = new Set()): EmsEval[] {
  const r20Of = (i: DalioInput) => i.r20 ?? i.r1m;
  const bench = items.find(i => i.symbol === DALIO_BENCHMARK);
  const benchRet = bench ? r20Of(bench) : null;

  // Cross-sectional percentile pools for the momentum blend.
  const s20  = items.map(r20Of).filter((v): v is number => v != null).sort((a, b) => a - b);
  const s60  = items.map(i => i.r3m).filter((v): v is number => v != null).sort((a, b) => a - b);
  const s180 = items.map(i => i.r6m).filter((v): v is number => v != null).sort((a, b) => a - b);
  const persistOf = (i: DalioInput): number | null => {
    const r20 = r20Of(i);
    return r20 != null && r20 > 0 && i.r3m != null ? i.r3m / r20 : null;
  };
  const sPersist = items.map(persistOf).filter((v): v is number => v != null).sort((a, b) => a - b);

  const evals: EmsEval[] = items.map(it => {
    const hasVolume = it.rvol5 != null;
    const reasons: string[] = [];
    if (!hasVolume) reasons.push('no volume → V from range-expansion proxy');

    const ret = r20Of(it);
    const p20  = ret != null ? pctileIn(s20, ret) : 0.5;
    const p60  = it.r3m != null ? pctileIn(s60, it.r3m) : 0.5;
    const p180 = it.r6m != null ? pctileIn(s180, it.r6m) : 0.5;
    const mBlend = DALIO_MBLEND_W[0] * p20 + DALIO_MBLEND_W[1] * p60 + DALIO_MBLEND_W[2] * p180;
    const confirmed = (it.ma200 == null || (it.price != null && it.price > it.ma200)) && it.r3m != null && it.r3m > 0;
    const blowOff = dalioBlowOffPenalty(ret, it.rvol5);
    const mFinal = confirmed ? mBlend * (1 - blowOff) : 0;
    const pj = persistOf(it);
    const persistPct = pj != null ? pctileIn(sPersist, pj) : 0;

    const V = dalioVSub(it.rvol5, it.rangeExp);
    const parts = dalioCGate(it.price, it.ma200, it.high52w, it.rvol5, it.r6m);
    const C = parts?.C ?? null;
    const rs20 = ret != null && benchRet != null ? ret - benchRet : null;
    const ems = C == null ? null : C * (DALIO_W_V * V + DALIO_W_M * mFinal + DALIO_W_P * persistPct);

    let ranked = C === 1;
    if (C == null) reasons.push('no price data');
    if (C === 0) reasons.push('cycle gate C = 0 (not near-high/no rebound/not in a 6-month uptrend above MA200)');
    if (ranked && !confirmed) reasons.push('momentum not confirmed (need Price > MA200 and 3-month return > 0)');
    if (ranked && it.symbol !== DALIO_BENCHMARK && rs20 != null && rs20 <= 0) {
      ranked = false;
      reasons.push(`RelStr ${rs20.toFixed(1)}pp vs ${DALIO_BENCHMARK} ≤ 0`);
    }
    if (it.symbol === DALIO_BENCHMARK) { ranked = false; reasons.push('benchmark itself'); }
    if (ranked && (ems == null || ems <= 0)) {
      ranked = false;
      reasons.push('EMS = 0 (no flow, and momentum unconfirmed or ≤ 0)');
    }

    return {
      symbol: it.symbol, name: it.name, group: it.group,
      hasVolume, volRatio: it.rvol5, ret20: ret, rs20,
      distMA: parts?.distMA ?? null, highDist: parts?.highDist ?? null,
      V, mBlend, confirmed, mFinal, persistPct, C, ems, ranked,
      phase: dalioPhase(parts),
      macroFlagged: macroFlagged.has(it.symbol),
      reasons,
    };
  });

  const order = (a: EmsEval, b: EmsEval) =>
    ((b.ems ?? -1) - (a.ems ?? -1)) ||
    ((b.volRatio ?? 1.0) - (a.volRatio ?? 1.0)) ||
    ((b.ret20 ?? -Infinity) - (a.ret20 ?? -Infinity));

  const rankedList = evals.filter(e => e.ranked).sort(order);
  const rest = evals.filter(e => !e.ranked).sort(order);
  return [...rankedList, ...rest];
}
