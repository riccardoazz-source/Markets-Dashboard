// ─────────────────────────────────────────────────────────────────────────────
// DALIO EMS — EARLY-MOMENTUM COMPOSITE SCORE (directive v2, formula-based)
//
// Implements EXACTLY the written formula, replacing the v1 gate-only model:
//
//   Variables (per asset, daily data):
//     ADV60      = 60-day average daily volume (baseline)
//     ADV5       = 5-day average daily volume
//     VolRatio   = ADV5 / ADV60, smoothed with a 5-day rolling average
//     Ret20      = 20 trading-day price return (decimal)
//     DistMA     = (Price − MA200) / MA200
//     HighDist   = (Price − 52wHigh) / 52wHigh   (≤ 0; 0 = at the high)
//
//   Sub-scores:
//     V = max(0, VolRatio − 1.1)            — volume surge above baseline
//     M = Ret20 · I(Ret20 > 0)              — positive momentum only
//     C = 1 if DistMA < 0.15 AND HighDist > −0.05, else 0
//                                           — cycle/trend confirmation gate
//   Composite:
//     EMS = wV·V + wM·M + wC·C   with wV = 0.45, wM = 0.45, wC = 0.10
//
//   Ranking rule: drop assets with C = 0 (or no signal at all), sort
//   descending by EMS, tie-break by VolRatio then Ret20.
//
//   Cycle phase (for "how each asset class is in the cycle"): derived from
//   DistMA / HighDist — bottoming (below MA200), recovering (above trend,
//   still >5% off the high), early trend (C = 1 zone), stretched (15–20%
//   above MA200), blow-off (>20% above MA200).
//
//   Assets without reliable volume (futures, indices, some foreign listings)
//   get V = 0 and are ranked on momentum + cycle gate only ("momentum-only",
//   per directive #9 of v1). SeasonFactor deliberately deferred (directive #8).
//   Relative strength vs the benchmark is computed and DISPLAYED but does not
//   enter the EMS formula (it is not part of the written formula — open
//   question sent back to the source).
// ─────────────────────────────────────────────────────────────────────────────

// Numbers from the directive itself — not tuned coefficients.
export const EMS_W_V = 0.45;
export const EMS_W_M = 0.45;
export const EMS_W_C = 0.10;
export const EMS_VOL_FLOOR = 1.1;        // V = max(0, VolRatio − 1.1)
export const EMS_DIST_MA_MAX = 0.15;     // C requires DistMA < 15%
export const EMS_HIGH_DIST_MIN = -0.05;  // C requires within 5% of the 52w high
export const EMS_MA200_BLOWOFF = 0.20;   // cycle phase: >20% above MA200 = blow-off
export const DALIO_BENCHMARK = '^GSPC';  // relative-strength context (display only)

export interface DalioInput {
  symbol: string;
  name: string;
  group: string;
  price: number | null;     // latest close
  ma200: number | null;
  high52w: number | null;
  rvol5: number | null;      // smoothed 5d/60d volume ratio (= VolRatio)
  rvol20: number | null;     // raw 20d/60d volume ratio (context only)
  r20: number | null;        // 20 trading-day return %
  r1m: number | null;        // unused by EMS — kept for input compatibility
  r3m: number | null;        // unused by EMS — kept for input compatibility
}

export type CyclePhase = 'bottoming' | 'recovering' | 'early trend' | 'stretched' | 'blow-off';

export interface EmsEval {
  symbol: string;
  name: string;
  group: string;
  hasVolume: boolean;        // false → V = 0, "momentum-only" sub-universe
  volRatio: number | null;   // smoothed VolRatio (rvol5)
  ret20: number | null;      // 20d return, %
  rs20: number | null;       // 20d return − benchmark (pp) — display only
  distMA: number | null;     // decimal, e.g. 0.12 = 12% above the 200d MA
  highDist: number | null;   // decimal ≤ 0, e.g. −0.03 = 3% below the 52w high
  V: number;                 // max(0, VolRatio − 1.1); 0 when volume missing
  M: number;                 // max(0, Ret20 decimal)
  C: 0 | 1 | null;           // null = MA200 / 52w high unavailable
  ems: number | null;        // wV·V + wM·M + wC·C (null when C unknown)
  ranked: boolean;           // passes the ranking rule (C = 1 and some signal)
  phase: CyclePhase | null;
  macroFlagged: boolean;     // ⭐ human macro pin (display only — not in the formula)
  reasons: string[];         // why the asset is not ranked
}

function cyclePhase(distMA: number | null, highDist: number | null): CyclePhase | null {
  if (distMA == null) return null;
  if (distMA > EMS_MA200_BLOWOFF) return 'blow-off';
  if (distMA >= EMS_DIST_MA_MAX) return 'stretched';
  if (distMA < 0) return 'bottoming';
  if (highDist != null && highDist > EMS_HIGH_DIST_MIN) return 'early trend';
  return 'recovering';
}

/**
 * Score and rank the whole universe with the EMS formula. Returns EVERY asset:
 * ranked ones first (desc EMS, tie-break VolRatio then Ret20), then the rest
 * (same ordering) so the UI can show why each one is out.
 */
export function rankEms(items: DalioInput[], macroFlagged: Set<string> = new Set()): EmsEval[] {
  const bench = items.find(i => i.symbol === DALIO_BENCHMARK);
  const benchR20 = bench?.r20 ?? null;

  const evals: EmsEval[] = items.map(it => {
    const hasVolume = it.rvol5 != null;
    const volRatio = it.rvol5;
    const reasons: string[] = [];

    const V = hasVolume ? Math.max(0, volRatio! - EMS_VOL_FLOOR) : 0;
    if (!hasVolume) reasons.push('no volume data → V = 0 (momentum-only)');

    const ret20dec = it.r20 != null ? it.r20 / 100 : null;
    const M = ret20dec != null && ret20dec > 0 ? ret20dec : 0;

    const distMA = it.price != null && it.ma200 != null && it.ma200 > 0
      ? it.price / it.ma200 - 1 : null;
    const highDist = it.price != null && it.high52w != null && it.high52w > 0
      ? it.price / it.high52w - 1 : null;

    const C: 0 | 1 | null = distMA == null || highDist == null
      ? null
      : distMA < EMS_DIST_MA_MAX && highDist > EMS_HIGH_DIST_MIN ? 1 : 0;

    const ems = C == null ? null : EMS_W_V * V + EMS_W_M * M + EMS_W_C * C;
    const phase = cyclePhase(distMA, highDist);

    // Ranking rule: drop C = 0; drop assets with no actual signal (V = M = 0).
    let ranked = C === 1;
    if (C == null) reasons.push('insufficient history for MA200 / 52w high');
    if (C === 0) {
      reasons.push(
        distMA != null && distMA >= EMS_DIST_MA_MAX
          ? `cycle gate: ${(distMA * 100).toFixed(0)}% above 200D MA (≥ 15%)`
          : `cycle gate: ${(Math.abs(highDist ?? 0) * 100).toFixed(1)}% below 52w high (> 5%)`,
      );
    }
    if (ranked && V === 0 && M === 0) {
      ranked = false;
      reasons.push('no signal: no volume surge and 20d return ≤ 0');
    }

    return {
      symbol: it.symbol, name: it.name, group: it.group,
      hasVolume, volRatio,
      ret20: it.r20,
      rs20: it.r20 != null && benchR20 != null ? it.r20 - benchR20 : null,
      distMA, highDist,
      V, M, C, ems, ranked, phase,
      macroFlagged: macroFlagged.has(it.symbol),
      reasons,
    };
  });

  // Sort: EMS desc → VolRatio desc → Ret20 desc (the written tie-break order).
  const order = (a: EmsEval, b: EmsEval) =>
    ((b.ems ?? -1) - (a.ems ?? -1)) ||
    ((b.volRatio ?? 0) - (a.volRatio ?? 0)) ||
    ((b.ret20 ?? -Infinity) - (a.ret20 ?? -Infinity));

  const rankedList = evals.filter(e => e.ranked).sort(order);
  const rest = evals.filter(e => !e.ranked).sort(order);
  return [...rankedList, ...rest];
}
