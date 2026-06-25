/**
 * Model version registry + reliability scoring.
 *
 * Workflow:
 *  - The CURRENT model (current: true) has its results auto-filled from the live
 *    backtest run, so its row is always up to date with whatever the formula does
 *    right now. No manual transcription.
 *  - When we change the formula, we "freeze" the current model's last recorded
 *    results into `results` here, set current:false, and add the new version with
 *    current:true. That gives a permanent, comparable history.
 *
 * Reliability ratio — how much we trust a version. Two principles:
 *  1. PRIORITY to capturing the REAL winners (how many of the period's actual top
 *     performers the model caught), not just "did it beat SPX".
 *  2. ASYMMETRIC, horizon-scaled penalty for underperforming SPX:
 *       1D below SPX → nobody dies (severity 0.2)
 *       1M below SPX → acceptable   (severity 0.6)
 *       5Y below SPX → garbage      (severity 5.0 — it craters the score)
 *
 *   For each period with data:
 *     alpha_p   = basket_p − spx_p
 *     effAlpha_p = alpha_p ≥ 0 ? alpha_p : alpha_p × lossSeverity_p   (losses amplified)
 *   WeightedAlphaEff = Σ w_p · effAlpha_p / Σ w_p          (drives the score)
 *   WeightedAlphaRaw = Σ w_p · alpha_p   / Σ w_p           (shown for reading)
 *   CaptureRate      = Σ w_p · (winnerHits_p/winnerTotal_p) / Σ w_p   (0..1)
 *   PickFactor       = min(1, avgPicks / 6)
 *   qualityMult      = (0.35 + 0.65·CaptureRate) · PickFactor         (0..1]
 *   Reliability = WeightedAlphaEff ≥ 0
 *                 ? WeightedAlphaEff · qualityMult        (good model: capture+picks modulate up)
 *                 : WeightedAlphaEff · (2 − qualityMult)  (bad model: weak capture/picks make it WORSE)
 */

export type PeriodKey = '1d' | '1m' | '3m' | '6m' | '1y' | '5y';

export interface PeriodResult {
  basket: number | null;        // basket forward return % from as-of date to today
  spx: number | null;           // S&P 500 forward return % over the same window
  picks: number | null;         // how many names the model selected
  winnerHits?: number | null;   // how many of the real top performers the model caught
  winnerTotal?: number | null;  // size of the "who actually won" leaderboard
}

export interface ModelVersion {
  id: number;
  name: string;
  current?: boolean;
  recordedAt?: string;          // YYYY-MM-DD the frozen results were captured
  formula: string[];            // rendered as a monospace block
  results: Partial<Record<PeriodKey, PeriodResult>>;
}

// Weights reflect how much each horizon should count toward trust. The long
// horizons (1Y, 5Y) dominate because they span full cycles; 1D is almost noise.
export const PERIOD_WEIGHTS: Record<PeriodKey, number> = {
  '1d': 0.05, '1m': 0.10, '3m': 0.20, '6m': 0.20, '1y': 0.25, '5y': 0.20,
};

// How hard an UNDERPERFORMANCE vs SPX hurts, scaled by horizon. A 1-day loss is
// noise (nobody dies); a 5-year loss to the index means the model is garbage and
// must crater the reliability score. Only applied when alpha_p < 0.
export const PERIOD_LOSS_SEVERITY: Record<PeriodKey, number> = {
  '1d': 0.2, '1m': 0.6, '3m': 1.0, '6m': 1.5, '1y': 2.5, '5y': 5.0,
};

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  '1d': '1D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', '5y': '5Y',
};

export const PERIOD_ORDER: PeriodKey[] = ['1d', '1m', '3m', '6m', '1y', '5y'];

export interface Reliability {
  weightedAlpha: number;    // weighted avg of raw (basket − spx) — for reading only
  hitRate: number;          // fraction of periods where basket beat spx
  avgPicks: number;         // mean pick count across periods with data
  captureRate: number;      // weighted avg of winnerHits/winnerTotal (0..1) — THE driver
  hasCapture: boolean;      // whether any period had winner-capture data
  totalHits: number;        // total real winners caught across all periods
  totalWinners: number;     // total real winners available across all periods
  beatFactor: number;       // 0..1 — did it beat SPX broadly (horizon-asymmetric loss penalty)
  worst5y: boolean;         // 5Y present AND below SPX → flagged as garbage
  reliability: number;      // 0..100 — capture-primary trust score (see below)
  nPeriods: number;         // how many periods had usable data
}

/**
 * Reliability (v3) — capture-PRIMARY. A model that nails one monster winner but
 * misses the rest is LUCKY, not reliable; reliability must reward catching MANY
 * of the real winners, not the size of the basket return (which one pick inflates).
 *
 *   CaptureRate = Σ w·(winnerHits/winnerTotal) / Σ w        ← THE driver (0..1)
 *   beatScore_p = alpha_p ≥ 0 ? +1 : −lossSeverity_p        ← WIN credit is flat
 *                 (upside magnitude IGNORED → no monster-pick inflation;
 *                  downside scaled by horizon: a 5Y miss craters it)
 *   beatFactor  = clamp( (Σ w·beatScore_p / Σ w + 1) / 2 , 0, 1 )   (0..1)
 *   pickFactor  = min(1, avgPicks / 6)
 *
 *   Reliability = 100 · CaptureRate · beatFactor · pickFactor
 *
 * So doubling the return of a single pick does NOTHING; catching one more real
 * winner raises it proportionally. Going below SPX (especially at 5Y) pushes
 * beatFactor down hard. No capture data → neutral 0.5 so manual rows aren't zeroed.
 */
export function computeReliability(results: Partial<Record<PeriodKey, PeriodResult>>): Reliability | null {
  const entries = PERIOD_ORDER
    .map(k => ({ k, r: results[k] }))
    .filter((e): e is { k: PeriodKey; r: PeriodResult } =>
      e.r != null && e.r.basket != null && e.r.spx != null);
  if (entries.length === 0) return null;

  let wSum = 0, waRawSum = 0, beatSum = 0, hits = 0;
  let pickSum = 0, pickN = 0, capWSum = 0, capSum = 0, worst5y = false;
  let totalHits = 0, totalWinners = 0;
  for (const { k, r } of entries) {
    const w = PERIOD_WEIGHTS[k];
    const alpha = (r.basket as number) - (r.spx as number);
    // WIN = flat +1 (magnitude ignored, so one huge pick can't inflate trust);
    // LOSS = −severity (horizon-scaled: 5Y miss is catastrophic, 1D is noise).
    const beatScore = alpha >= 0 ? 1 : -PERIOD_LOSS_SEVERITY[k];
    waRawSum += w * alpha;
    beatSum += w * beatScore;
    wSum += w;
    if (alpha > 0) hits++;
    if (k === '5y' && alpha < 0) worst5y = true;
    if (r.picks != null) { pickSum += r.picks; pickN++; }
    if (r.winnerHits != null && r.winnerTotal != null && r.winnerTotal > 0) {
      capWSum += w;
      capSum += w * (r.winnerHits / r.winnerTotal);
      totalHits += r.winnerHits;
      totalWinners += r.winnerTotal;
    }
  }
  const weightedAlpha = wSum > 0 ? waRawSum / wSum : 0;
  const hitRate = hits / entries.length;
  const avgPicks = pickN > 0 ? pickSum / pickN : 0;
  const hasCapture = capWSum > 0;
  const captureRate = hasCapture ? capSum / capWSum : 0;

  const pickFactor = Math.min(1, avgPicks / 6);
  const beatFactor = Math.max(0, Math.min(1, (beatSum / wSum + 1) / 2));
  // Capture is the PRIMARY lever. No capture data → neutral 0.5 so manually-entered
  // rows (no winner leaderboard) aren't zeroed out.
  const effCapture = hasCapture ? captureRate : 0.5;
  const reliability = 100 * effCapture * beatFactor * pickFactor;

  return {
    weightedAlpha, hitRate, avgPicks, captureRate, hasCapture,
    totalHits, totalWinners, beatFactor, worst5y,
    reliability, nPeriods: entries.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTRY. Restart from Model 1 = the current live formula.
// As we iterate, freeze each model's results here and add the next one.
// ─────────────────────────────────────────────────────────────────────────────
export const MODEL_VERSIONS: ModelVersion[] = [
  {
    id: 1,
    name: 'Base — 3-horizon ACC · SHA-trend · regime gate',
    current: false,
    recordedAt: '2026-06-24',
    formula: [
      'Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL − wEXT·EXT',
      '',
      'ACC = pctile( 0.55·aRecent + 0.35·aBuild + 0.20·min(0,aLong) )',
      '   aRecent = p1 − p3   aBuild = p3 − p6   aLong = p6 − p1y',
      '   pX = monthly geometric pace of return over X months',
      'TRD = 0.50·p3m + 0.20·p6m + 0.30·SHA',
      '   SHA = pctile(r3m / monthly vol)   (null → 0.5)',
      'REG = 1.0 if price ≥ MA200 · 0.2 if below · 0.5 if MA absent  [BINARY]',
      'VOL = pctile(latest vol / 20d avg)   (null → 0.5)',
      'EXT = max( STRETCH_pctile , |r1m|_pctile )',
      '   wEXT = 0.20   ·   commodities 0.32',
      '',
      'Gate: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price ≥ MA200',
      '   cap = 50%   ·   commodities 25%',
    ],
    results: {
      '1m': { basket: -1.4, spx: -1.5, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '3m': { basket: -6.5, spx: 13.6, picks:  5, winnerHits:  0, winnerTotal:  5 },
      '6m': { basket: 19.7, spx:  6.5, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '1y': { basket: 101.5, spx: 20.8, picks: 25, winnerHits: 11, winnerTotal: 25 },
      '5y': { basket: 112.1, spx: 71.9, picks: 25, winnerHits:  9, winnerTotal: 25 },
    },
  },
  {
    id: 2,
    name: 'Graduated REG — pctile(price/MA200−1) replaces binary',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL − wEXT·EXT',
      '',
      'ACC, TRD, VOL, EXT unchanged from M1',
      '',
      'REG = pctile( price/MA200 − 1 ) across universe  [GRADUATED]',
      '   Far above MA200 → high rank   Just above → mid   Below → low rank',
      '   null MA200 → 0.5 neutral (no data = not penalised)',
      '   Gate still hard-requires price ≥ MA200 (below = excluded from shortlist)',
      '',
      'TRD = 0.50·p3m + 0.20·p6m + 0.30·SHA  (unchanged)',
      'Picks: top 25 (unchanged)',
      '',
      'Gate: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price ≥ MA200',
      '   cap = 50%   ·   commodities 25%',
    ],
    results: {
      '3m': { basket: -7.3,  spx: 15.5, picks:  5, winnerHits:  0, winnerTotal:  5 },
      '6m': { basket: 17.0,  spx:  6.1, picks: 25, winnerHits:  4, winnerTotal: 25 },
      '1y': { basket: 99.3,  spx: 20.8, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 109.7, spx: 71.9, picks: 25, winnerHits:  7, winnerTotal: 25 },
    },
  },
  {
    id: 3,
    name: 'SHA priority + concentrated 12 picks',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL − wEXT·EXT',
      '',
      'ACC, REG, VOL, EXT unchanged from M2',
      '',
      'TRD = 0.45·p3m + 0.15·p6m + 0.40·SHA  [SHA weight raised: 30%→40%]',
      '   SHA = pctile(r3m / monthly vol) — rewards smooth durable trends',
      '   over spiky same-magnitude returns (commodity events, meme pumps).',
      '   null vol → 0.5 neutral',
      '',
      'Picks: top 12  [reduced from 25 — concentrate in highest-conviction names]',
      '   1Y backtest showed top-10 picks ≈ 9 winners; 25 dilutes alpha.',
      '',
      'Gate: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price ≥ MA200',
      '   cap = 50%   ·   commodities 25%',
    ],
    results: {
      '1m': { basket:   0.7, spx: -2.1, picks: 12, winnerHits: 3, winnerTotal: 12 },
      '3m': { basket:  -7.3, spx: 15.5, picks:  5, winnerHits: 0, winnerTotal:  5 },
      '6m': { basket:  28.1, spx:  6.1, picks: 12, winnerHits: 2, winnerTotal: 12 },
      '1y': { basket: 166.9, spx: 20.8, picks: 12, winnerHits: 6, winnerTotal: 12 },
      '5y': { basket: 135.1, spx: 71.9, picks: 12, winnerHits: 2, winnerTotal: 12 },
    },
  },
  {
    id: 4,
    name: 'Quality leadership — 52w-high position + trend smoothness',
    current: true,
    formula: [
      'Score = 0.38·ACC + 0.22·TRD + 0.12·LEAD + 0.10·REG + 0.04·VOL − wEXT·EXT',
      '',
      'NEW: LEAD = 0.6·pos52w + 0.4·trendR2   (cross-sectional percentiles)',
      '   pos52w  = position of price in its 52-week range (0=low, 100=high)',
      '             → 52-week-high momentum persists (George & Hwang 2004)',
      '   trendR2 = R² of log-price trend over trailing ~6mo (0=jumpy, 1=smooth)',
      '             → smooth trends continue, jumpy ones reverse ("frog in the pan")',
      '   Both target durable winner CAPTURE: steady 52w-high leaders (semis, NVDA)',
      '   over spiky software that spikes then rolls over. null → 0.5 neutral.',
      '',
      'ACC weight 0.45→0.38 (it over-rewarded short blow-off spikes)',
      'TRD weight 0.25→0.22  ·  rest unchanged from M3',
      '',
      'Picks: top 12 → 20. Capture-first reliability showed M3 (12 picks) caught',
      '   the FEWEST winners (13/53). More breadth catches more winners; LEAD',
      '   lifts precision so the extra picks are still quality.',
      '',
      'Gate: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price ≥ MA200',
      '   cap = 50%   ·   commodities 25%   ·   picks: top 20',
    ],
    results: {}, // auto-filled from the live backtest run
  },
];
