// ─────────────────────────────────────────────────────────────────────────────
// DALIO EMS — EARLY-MOMENTUM COMPOSITE SCORE (directive v2 + final Q&A)
//
// The shared Dalio math: this module is the single source of the EMS pieces,
// consumed by BOTH the live rotation model (MODEL_MODE = 'dalio' in
// lib/rotationModel.ts — quadrant, Accelerating list, backtest) and the
// transparency panel (components/sections/DalioPanel.tsx).
//
//   Variables (per asset, daily data):
//     VolRatio = 5d ADV ÷ 60d ADV, smoothed with a 5-day rolling average.
//                Missing volume → 1.0 NEUTRAL baseline (final directive #4:
//                "assign a default volume score so they don't fall behind").
//     Ret20    = 20 trading-day price return.
//     DistMA   = Price/MA200 − 1.
//     HighDist = Price/52wHigh − 1  (≤ 0; 0 = at the high).
//
//   Sub-scores:
//     V = max(0, VolRatio − 1.1)
//     M = PercentileRank(Ret20 · I(Ret20 > 0))   (final directive #3: normalize —
//         raw returns are not comparable across asset classes; percentile 0–1)
//     C = 1 if (HighDist ≥ −0.05 AND DistMA ≤ 0.15)          — healthy momentum
//           OR (HighDist <  −0.05 AND VolRatio < 1.2)         — normal flow
//         else 0                                              (final directive #1:
//         a modest gap from the high with solid volume = healthy; a LARGE gap
//         from the high WITH a volume surge = potential blow-off → dropped)
//
//   Composite (hard-gate variant, as in the worked example):
//     EMS = C · (0.45·V + 0.45·M)
//
//   Relative strength (final directive #2): RelStr = Ret20 − benchmark Ret20 is
//   a HARD PRE-FILTER (> 0 required to enter the ranking) and then a tie-break.
//
//   Ranking rule: drop C = 0 / RelStr ≤ 0 / EMS = 0, sort descending by EMS,
//   tie-break by VolRatio then Ret20.
//
//   Cycle phase (for "how each asset class is in the cycle"): derived from the
//   same C inputs — bottoming (below MA200), recovering (above trend, >5% off
//   the high, no volume spike), early trend (the C = 1 near-high zone),
//   stretched (15–20% above MA200), blow-off (>20% above MA200, or >5% below
//   the high on a volume spike ≥ 1.2×).
//
//   SeasonFactor deliberately deferred (directive #8 of v1).
// ─────────────────────────────────────────────────────────────────────────────

// Numbers from the directives themselves — not tuned coefficients.
export const DALIO_W_V = 0.45;             // weight on the volume-surge sub-score
export const DALIO_W_M = 0.45;             // weight on the normalized momentum sub-score
export const DALIO_VOL_FLOOR = 1.1;        // V = max(0, VolRatio − 1.1)
export const DALIO_VOL_SPIKE = 1.2;        // volume-spike threshold in the C gate
export const DALIO_DISTMA_MAX = 0.15;      // C branch 1: ≤ 15% above the 200D MA
export const DALIO_HIGHDIST_MIN = -0.05;   // "within 5% of the 52w high" boundary
export const DALIO_MA200_BLOWOFF = 0.20;   // cycle phase: > 20% above MA200 = blow-off
export const DALIO_NEUTRAL_VOLRATIO = 1.0; // missing volume → neutral baseline
export const DALIO_BENCHMARK = '^GSPC';    // relative-strength benchmark

// ── Volume ratios (shared by the live route AND the backtest) ────────────────
// ADV over the trailing n days ending at index `end` (inclusive). Null when the
// window has too few valid (positive) volume days to be trustworthy.
export function advAt(vols: (number | null | undefined)[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let sum = 0, cnt = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const v = vols[i];
    if (v != null && v > 0) { sum += v; cnt++; }
  }
  // Require at least 2/3 of the window to have real volume (index tickers often report 0).
  return cnt >= Math.ceil((2 * n) / 3) ? sum / cnt : null;
}

// Dalio spec: Ratio_t = ADV5_t / ADV60_t computed per day, then the SHORT (5d)
// ratio is smoothed with a 5-day SMA; the MEDIUM (20d) ratio stays raw.
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

// ── The EMS sub-scores ────────────────────────────────────────────────────────
export function dalioVSub(volRatio: number | null | undefined): number {
  return Math.max(0, (volRatio ?? DALIO_NEUTRAL_VOLRATIO) - DALIO_VOL_FLOOR);
}

export interface DalioCParts {
  C: 0 | 1;
  distMA: number | null;    // decimal, e.g. 0.12 = 12% above the 200d MA
  highDist: number | null;  // decimal ≤ 0, e.g. −0.03 = 3% below the 52w high
  nearHigh: boolean;        // within 5% of the 52-week high
  volSpike: boolean;        // VolRatio ≥ 1.2 (neutral 1.0 when volume missing)
}

// The dual-branch cycle gate (final directive #1). Missing data is never read as
// "bad": no 52w high → treated as not-near-high (falls to branch 2); no MA200 →
// the DistMA condition passes.
export function dalioCGate(
  price: number | null | undefined,
  ma200: number | null | undefined,
  high52w: number | null | undefined,
  volRatio: number | null | undefined,
): DalioCParts | null {
  if (price == null || price <= 0) return null;
  const distMA = ma200 != null && ma200 > 0 ? price / ma200 - 1 : null;
  const highDist = high52w != null && high52w > 0 ? price / high52w - 1 : null;
  const vr = volRatio ?? DALIO_NEUTRAL_VOLRATIO;
  const nearHigh = highDist != null && highDist >= DALIO_HIGHDIST_MIN;
  const volSpike = vr >= DALIO_VOL_SPIKE;
  // Branch 1: near the high AND not stretched above trend → genuine momentum, keep.
  const b1 = nearHigh && (distMA == null || distMA <= DALIO_DISTMA_MAX);
  // Branch 2: >5% below the high AND volume NOT spiking → normal flow, keep.
  //           (A large gap from the high WITH a volume surge = potential blow-off.)
  const b2 = !nearHigh && !volSpike;
  return { C: b1 || b2 ? 1 : 0, distMA, highDist, nearHigh, volSpike };
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
  if (volSpike) return 'blow-off'; // >5% off the high on a volume surge = over-extension/distribution
  if (distMA < 0) return 'bottoming';
  return 'recovering';
}

// ── Panel-facing evaluation (the transparency view) ──────────────────────────
export interface DalioInput {
  symbol: string;
  name: string;
  group: string;
  price: number | null;      // latest close
  ma200: number | null;
  high52w: number | null;
  rvol5: number | null;      // smoothed 5d/60d volume ratio (= VolRatio)
  rvol20: number | null;     // raw 20d/60d volume ratio (context only)
  r20: number | null;        // 20 trading-day return %
  r1m: number | null;        // fallback for r20 (~21 trading days)
  r3m: number | null;        // unused by EMS — kept for input compatibility
}

export interface EmsEval {
  symbol: string;
  name: string;
  group: string;
  hasVolume: boolean;        // false → VolRatio = 1.0 neutral ("momentum-only")
  volRatio: number | null;   // smoothed VolRatio (rvol5); null shown as neutral
  ret20: number | null;      // 20d return, % (r20, or r1m fallback)
  rs20: number | null;       // Ret20 − benchmark (pp) — the HARD pre-filter
  distMA: number | null;
  highDist: number | null;
  V: number;                 // max(0, VolRatio − 1.1); 0 when volume missing
  M: number;                 // percentile rank of positive Ret20 (0–1)
  C: 0 | 1 | null;           // null = no price data
  ems: number | null;        // C · (0.45·V + 0.45·M)
  ranked: boolean;           // passes the full ranking rule
  phase: CyclePhase | null;
  macroFlagged: boolean;     // ⭐ human macro pin (display only — not in the formula)
  reasons: string[];         // why the asset is not ranked
}

/**
 * Score and rank the whole universe with the EMS formula (final directives).
 * Returns EVERY asset: ranked ones first (desc EMS, tie-break VolRatio then
 * Ret20), then the rest (same ordering) so the UI can show why each one is out.
 */
export function rankEms(items: DalioInput[], macroFlagged: Set<string> = new Set()): EmsEval[] {
  const retOf = (i: DalioInput) => i.r20 ?? i.r1m;
  const bench = items.find(i => i.symbol === DALIO_BENCHMARK);
  const benchRet = bench ? retOf(bench) : null;

  // M = PercentileRank of the POSITIVE 20d return (final directive #3). Assets
  // with Ret20 ≤ 0 get M = 0 — only positive momentum earns credit.
  const positives = items
    .map(retOf)
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b);
  const pctOfPositive = (v: number): number => {
    if (positives.length < 2) return positives.length === 1 ? 1 : 0;
    let lo = 0;
    while (lo < positives.length && positives[lo] < v) lo++;
    return lo / (positives.length - 1);
  };

  const evals: EmsEval[] = items.map(it => {
    const hasVolume = it.rvol5 != null;
    const reasons: string[] = [];
    if (!hasVolume) reasons.push('no volume data → VolRatio 1.0 neutral (momentum-only)');

    const ret = retOf(it);
    const Mraw = ret != null && ret > 0 ? ret : 0;
    const M = Mraw > 0 ? pctOfPositive(Mraw) : 0;
    const V = dalioVSub(it.rvol5);
    const parts = dalioCGate(it.price, it.ma200, it.high52w, it.rvol5);
    const C = parts?.C ?? null;
    const rs20 = ret != null && benchRet != null ? ret - benchRet : null;
    const ems = C == null ? null : C * (DALIO_W_V * V + DALIO_W_M * M);

    let ranked = C === 1;
    if (C == null) reasons.push('no price data');
    if (C === 0 && parts) {
      reasons.push(parts.nearHigh
        ? `cycle gate: ${((parts.distMA ?? 0) * 100).toFixed(0)}% above 200D MA near the high (over-extension)`
        : `blow-off guard: ${(Math.abs(parts.highDist ?? 0) * 100).toFixed(1)}% below 52w high on a ${(it.rvol5 ?? 1).toFixed(2)}× volume spike`);
    }
    if (ranked && it.symbol !== DALIO_BENCHMARK && rs20 != null && rs20 <= 0) {
      ranked = false;
      reasons.push(`RelStr pre-filter: ${rs20.toFixed(1)}pp vs ${DALIO_BENCHMARK} ≤ 0`);
    }
    if (it.symbol === DALIO_BENCHMARK) { ranked = false; reasons.push('benchmark itself'); }
    if (ranked && ems != null && ems <= 0) {
      ranked = false;
      reasons.push('EMS = 0: no volume surge and no positive 20d momentum');
    }

    return {
      symbol: it.symbol, name: it.name, group: it.group,
      hasVolume, volRatio: it.rvol5,
      ret20: ret,
      rs20,
      distMA: parts?.distMA ?? null, highDist: parts?.highDist ?? null,
      V, M, C, ems, ranked,
      phase: dalioPhase(parts),
      macroFlagged: macroFlagged.has(it.symbol),
      reasons,
    };
  });

  // Sort: EMS desc → VolRatio desc → Ret20 desc (the written tie-break order,
  // with the neutral 1.0 standing in for missing volume).
  const order = (a: EmsEval, b: EmsEval) =>
    ((b.ems ?? -1) - (a.ems ?? -1)) ||
    ((b.volRatio ?? DALIO_NEUTRAL_VOLRATIO) - (a.volRatio ?? DALIO_NEUTRAL_VOLRATIO)) ||
    ((b.ret20 ?? -Infinity) - (a.ret20 ?? -Infinity));

  const rankedList = evals.filter(e => e.ranked).sort(order);
  const rest = evals.filter(e => !e.ranked).sort(order);
  return [...rankedList, ...rest];
}
