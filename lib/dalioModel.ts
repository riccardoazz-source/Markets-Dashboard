// ─────────────────────────────────────────────────────────────────────────────
// DALIO EARLY-MOMENTUM MODEL
//
// A transparent, coefficient-free rotation model implemented EXACTLY per the
// written directives (volume-vs-baseline early momentum). No scores, no tuned
// weights — only hard gates, a guardrail, and a plain ordering rule:
//
//   1. Baseline ADV  = 60-day average daily volume.
//   2. Short window  = 5-day ADV / baseline, smoothed with a 5-day SMA of the
//      daily ratio. Medium window = 20-day ADV / baseline, raw.
//   3. VOLUME GATE   : short ≥ 1.2 AND medium ≥ 1.1  ("both-above" rule).
//   4. MOMENTUM GATE : 20 trading-day return > 0 (primary). Optional STRICT
//      mode additionally requires 1-month AND 3-month returns > 0.
//   5. STRENGTH GATE : asset 20d return − benchmark 20d return > 0 (hybrid:
//      benchmark-relative filter first, cross-sectional ranking after).
//   6. GUARDRAIL     : exclude late-cycle blow-offs — price > 20% above the
//      200-day MA, or within 5% of the 52-week high while volume is spiking.
//      15–20% above the MA is flagged "stretched" (borderline) but kept.
//   7. ORDERING      : hard gates → volume ratio (desc) → 20d momentum (desc)
//      → relative-strength percentile (desc). Assets without reliable volume
//      skip the volume gate and carry a neutral ratio of 1.0 so they are
//      ranked but never outrank a genuine volume surge.
//   8. MACRO OVERLAY : pinned assets (the ⭐ in the table = the human macro
//      flag) get a small boost (+0.1 on the ordering ratio), per "let a human
//      flag assets that align with a strong macro driver… a small boost in
//      the final order".
//
// Deliberately NOT implemented yet (per directive #8): seasonality — start
// with the flat 60-day baseline, layer a seasonal factor later only if it
// proves out. The "gap widening faster than its historical rate" red flag
// needs a distance-history series and is left for a later iteration.
// ─────────────────────────────────────────────────────────────────────────────

// Thresholds — these are the numbers from the directives themselves, not tuned
// coefficients. Change them only if the source guidance changes.
export const DALIO_RVOL_SHORT_MIN = 1.2;   // 5d ratio ≥ 1.2  (20% above baseline)
export const DALIO_RVOL_MED_MIN = 1.1;     // 20d ratio ≥ 1.1 (default balanced rule)
export const DALIO_RVOL_MED_LOOSE = 1.0;   // "aggressive" variant: medium > 1.0
export const DALIO_GUARD_MA200_MAX = 20;   // exclude when > 20% above the 200d MA
export const DALIO_GUARD_MA200_WARN = 15;  // 15–20% = "stretched" warning zone
export const DALIO_GUARD_52W_PCT = 5;      // exclude when within 5% of the 52w high
export const DALIO_MACRO_BOOST = 0.1;      // small ordering boost for macro-flagged (pinned) assets
export const DALIO_BENCHMARK = '^GSPC';    // broad index for the relative-strength gate

export interface DalioInput {
  symbol: string;
  name: string;
  group: string;
  price: number | null;     // latest close
  ma200: number | null;
  high52w: number | null;
  rvol5: number | null;      // smoothed 5d/60d volume ratio
  rvol20: number | null;     // raw 20d/60d volume ratio
  r20: number | null;        // 20 trading-day return %
  r1m: number | null;
  r3m: number | null;
}

export interface DalioEval {
  symbol: string;
  name: string;
  group: string;
  hasVolume: boolean;
  rvol5: number | null;
  rvol20: number | null;
  r20: number | null;
  rs20: number | null;          // r20 − benchmark r20 (percentage points)
  rsPctile: number | null;      // cross-sectional percentile of rs20 (0–1)
  dist200: number | null;       // % above/below the 200d MA
  nearHighPct: number | null;   // % below the 52w high (0 = at the high)
  gates: {
    volume: boolean | null;     // null = no reliable volume → gate skipped
    momentum: boolean;
    strength: boolean | null;   // null = benchmark unavailable → gate skipped
  };
  qualified: boolean;           // all applicable gates pass AND not excluded
  excluded: boolean;            // guardrail exclusion
  stretched: boolean;           // 15–20% above MA200 (borderline warning)
  macroBoost: boolean;          // pinned = human macro flag
  reasons: string[];            // human-readable failed gates / exclusion causes
  sortKey: number;              // primary ordering value (rvol + macro boost)
}

export interface DalioOptions {
  /** STRICT momentum: additionally require 1M and 3M returns > 0. */
  strict?: boolean;
  /** Looser medium-window rule: rvol20 > 1.0 instead of ≥ 1.1. */
  aggressive?: boolean;
  /** Symbols the human has macro-flagged (the table pins). */
  macroFlagged?: Set<string>;
}

/**
 * Evaluate and rank the whole universe per the Dalio early-momentum workflow.
 * Returns EVERY asset (qualifiers first, in rank order; then non-qualifiers,
 * same ordering rule) so the UI can show why each one passed or failed.
 */
export function rankDalio(items: DalioInput[], opts: DalioOptions = {}): DalioEval[] {
  const { strict = false, aggressive = false, macroFlagged = new Set<string>() } = opts;
  const medMin = aggressive ? DALIO_RVOL_MED_LOOSE : DALIO_RVOL_MED_MIN;

  // Benchmark 20d return for the relative-strength gate.
  const bench = items.find(i => i.symbol === DALIO_BENCHMARK);
  const benchR20 = bench?.r20 ?? null;

  // Cross-sectional RS percentile (secondary tie-break) over assets with rs20.
  const rsValues = items
    .map(i => (i.r20 != null && benchR20 != null ? i.r20 - benchR20 : null))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const pctileOf = (v: number): number => {
    if (rsValues.length < 2) return 0.5;
    let lo = 0;
    while (lo < rsValues.length && rsValues[lo] <= v) lo++;
    return lo / rsValues.length;
  };

  const evals: DalioEval[] = items.map(it => {
    const hasVolume = it.rvol5 != null && it.rvol20 != null;
    const reasons: string[] = [];

    // ── Gates ──
    const volumeGate: boolean | null = hasVolume
      ? (it.rvol5! >= DALIO_RVOL_SHORT_MIN && (aggressive ? it.rvol20! > medMin : it.rvol20! >= medMin))
      : null; // no reliable volume → gate skipped, neutral ratio used for ordering
    if (volumeGate === false) reasons.push(`volume ${it.rvol5!.toFixed(2)}×/${it.rvol20!.toFixed(2)}× below ${DALIO_RVOL_SHORT_MIN}/${medMin}`);

    let momentumGate = it.r20 != null && it.r20 > 0;
    if (strict && momentumGate) {
      momentumGate = (it.r1m ?? -1) > 0 && (it.r3m ?? -1) > 0;
      if (!momentumGate) reasons.push('strict: 1M/3M not both positive');
    } else if (!momentumGate) {
      reasons.push(it.r20 == null ? 'no 20d return' : `20d return ${it.r20.toFixed(1)}% ≤ 0`);
    }

    const rs20 = it.r20 != null && benchR20 != null ? it.r20 - benchR20 : null;
    const strengthGate: boolean | null =
      it.symbol === DALIO_BENCHMARK ? false : rs20 != null ? rs20 > 0 : null;
    if (strengthGate === false && it.symbol !== DALIO_BENCHMARK) reasons.push(`RS ${rs20!.toFixed(1)}pp vs ${DALIO_BENCHMARK} ≤ 0`);
    if (it.symbol === DALIO_BENCHMARK) reasons.push('benchmark itself');

    // ── Guardrail (late-cycle blow-off) ──
    const dist200 = it.price != null && it.ma200 != null && it.ma200 > 0
      ? (it.price / it.ma200 - 1) * 100 : null;
    const nearHighPct = it.price != null && it.high52w != null && it.high52w > 0
      ? (1 - it.price / it.high52w) * 100 : null;
    // The guardrail only bites "when volume is spiking" — i.e. it disqualifies
    // would-be qualifiers; it is reported for everyone for transparency.
    const volumeSpiking = volumeGate === true;
    let excluded = false;
    if (volumeSpiking && dist200 != null && dist200 > DALIO_GUARD_MA200_MAX) {
      excluded = true;
      reasons.push(`guardrail: ${dist200.toFixed(0)}% above 200d MA (> ${DALIO_GUARD_MA200_MAX}%)`);
    }
    if (volumeSpiking && nearHighPct != null && nearHighPct < DALIO_GUARD_52W_PCT) {
      excluded = true;
      reasons.push(`guardrail: within ${nearHighPct.toFixed(1)}% of 52w high on a volume spike`);
    }
    const stretched = dist200 != null && dist200 > DALIO_GUARD_MA200_WARN && dist200 <= DALIO_GUARD_MA200_MAX;

    const gatesPass = (volumeGate ?? true) && momentumGate && (strengthGate ?? true);
    const qualified = gatesPass && !excluded;

    const macroBoost = macroFlagged.has(it.symbol);
    // Ordering: volume ratio (neutral 1.0 without volume) + small macro boost.
    const sortKey = (hasVolume ? it.rvol5! : 1.0) + (macroBoost ? DALIO_MACRO_BOOST : 0);

    return {
      symbol: it.symbol, name: it.name, group: it.group,
      hasVolume,
      rvol5: it.rvol5, rvol20: it.rvol20, r20: it.r20,
      rs20, rsPctile: rs20 != null ? pctileOf(rs20) : null,
      dist200, nearHighPct,
      gates: { volume: volumeGate, momentum: momentumGate, strength: strengthGate },
      qualified, excluded, stretched, macroBoost, reasons, sortKey,
    };
  });

  // Ordering rule: hard gates first, then volume ratio, then 20d momentum,
  // then RS percentile (secondary tie-break).
  const order = (a: DalioEval, b: DalioEval) =>
    (b.sortKey - a.sortKey) ||
    ((b.r20 ?? -Infinity) - (a.r20 ?? -Infinity)) ||
    ((b.rsPctile ?? 0) - (a.rsPctile ?? 0));

  const qualifiers = evals.filter(e => e.qualified).sort(order);
  const rest = evals.filter(e => !e.qualified).sort(order);
  return [...qualifiers, ...rest];
}
