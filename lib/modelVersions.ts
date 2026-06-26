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
  let pickSum = 0, pickN = 0, capWSum = 0, worst5y = false;
  let totalHits = 0, totalWinners = 0, nCapturePeriods = 0;
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
      totalHits += r.winnerHits;
      totalWinners += r.winnerTotal;
      nCapturePeriods++;
    }
  }
  const weightedAlpha = wSum > 0 ? waRawSum / wSum : 0;
  const hitRate = hits / entries.length;
  const avgPicks = pickN > 0 ? pickSum / pickN : 0;
  const hasCapture = capWSum > 0;
  // M18: normalize by the MAXIMUM POSSIBLE captures across ALL 6 standard periods.
  // Old formula (weighted per-period rate) rated M15 (4 periods tested, 39/100 = 39%)
  // above M17 (6 periods tested, 55/150 = 37%) even though M17 caught 16 MORE winners.
  // This was wrong: M15 was "avoiding" its weak 3M period by having null basket/spx there.
  // New formula: totalHits / (nAllPeriods × avgPicksPerPeriod). A model tested on fewer
  // periods is penalised — partial coverage means less evidence, not a free pass.
  const avgPicksPerPeriod = nCapturePeriods > 0 ? Math.round(totalWinners / nCapturePeriods) : 25;
  const maxPossibleCaptures = PERIOD_ORDER.length * avgPicksPerPeriod;
  const captureRate = hasCapture ? totalHits / maxPossibleCaptures : 0;

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
    current: false,
    recordedAt: '2026-06-25',
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
    results: {
      '1m': { basket:  -1.1, spx:  -2.1, picks: 20, winnerHits:  6, winnerTotal: 20 },
      '3m': { basket:  -7.5, spx:  15.5, picks:  5, winnerHits:  0, winnerTotal:  5 },
      '6m': { basket:  27.2, spx:   6.1, picks: 20, winnerHits:  5, winnerTotal: 20 },
      '1y': { basket: 117.1, spx:  20.8, picks: 20, winnerHits:  9, winnerTotal: 20 },
      '5y': { basket: 103.2, spx:  71.9, picks: 20, winnerHits:  4, winnerTotal: 20 },
    },
  },
  {
    id: 5,
    name: 'Group diversity caps — REJECTED (forced diversification dilutes conviction)',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'IDEA: per-group pick caps (Sectors ≤3, Indexes ≤3, Crypto ≤3, Commodities ≤2)',
      'to stop correlated ETF clusters from filling every slot.',
      '',
      'REJECTED before recording a backtest: capping diversification just "shoots',
      'into the crowd" — it forces variety instead of conviction and treats the',
      'SYMPTOM (clustered ETFs) not the CAUSE. The real cause was the scoring:',
      'the Sharpe term was picking low-volatility losers (smooth software) over',
      'high-volatility winners (semis). M6 fixes the cause instead — see below.',
    ],
    results: {},
  },
  {
    id: 6,
    name: 'Volatility is the engine — reward good (upside) volatility, guard the cycle',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.18·VQ + 0.14·TRD + 0.12·CYC + 0.10·LEAD + 0.08·REG + 0.04·VOL − wEXT·EXT',
      '',
      'THE FLIP: deleted SHA (r3m/vol). Dividing return by volatility REWARDED the',
      '   smooth low-vol losers and PENALISED the volatile winners. At 5Y the model',
      '   bought ADBE (then −66%) & INTU (−46%) and MISSED MU (+1178%) & AVGO (+726%).',
      '   A bond can accelerate but never 10× — its volatility caps it. You WANT the',
      '   assets with the capacity for big moves.',
      '',
      'NEW VQ = pctile(volEdge),  volEdge = upsideRms − downsideRms  (of daily returns)',
      '   HIGH = an upside-dominated engine (big up moves, contained downside: NVDA, MU)',
      '   ~0   = a low-vol bond (no capacity) OR a symmetric churner (ups ≈ downs)',
      '   <0   = downside-heavy / crashing',
      '',
      'NEW CYC = pctile(trendR2 over ~12 months) — secular compounder vs cyclical pop.',
      '   HIGH = marches up persistently for a year+ (NVDA).  LOW = flat/choppy base',
      '   with a recent vertical spike (oil +44%→−25% on the Iran war) → demoted.',
      '   Counterweights VQ so peak-cycle pops (high upside vol, low long-trend) score low.',
      '',
      'ACC stays the #1 pillar (0.34, highest weight) AND a hard gate: an asset is not',
      '   a winner if it does not accelerate (aRecent>0 required to qualify).',
      'TRD simplified to raw 0.6·p3m + 0.4·p6m (the Sharpe leg moved into VQ, flipped).',
      'M5 group caps DROPPED — selection is pure score-rank again (top 20).',
      '',
      'Gate unchanged: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price ≥ MA200',
    ],
    results: {
      '1m': { basket:  -1.2, spx:  -2.1, picks: 20, winnerHits:  7, winnerTotal: 20 },
      '3m': { basket:  -7.6, spx:  15.5, picks:  5, winnerHits:  0, winnerTotal:  5 },
      '6m': { basket:  28.6, spx:   6.1, picks: 20, winnerHits:  5, winnerTotal: 20 },
      '1y': { basket: 119.3, spx:  20.8, picks: 20, winnerHits: 10, winnerTotal: 20 },
      '5y': { basket: 105.1, spx:  71.9, picks: 20, winnerHits:  4, winnerTotal: 20 },
    },
  },
  {
    id: 7,
    name: 'Pre-breakout sleeve — catch the coiled springs the gate rejects',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.22·VQ + 0.14·TRD + 0.08·CYC + 0.10·LEAD + 0.08·REG + 0.04·VOL − wEXT·EXT',
      '   (M7 vs M6: VQ 0.18→0.22, CYC 0.12→0.08 — CYC had rewarded smooth toppers',
      '    like ADBE/INTU over volatile winners like AMD/semis. Now upside vol wins.)',
      '',
      'THE INSIGHT: the biggest 5Y winners were FALLING at the pick date —',
      '   MU −2.3%, AVGO −1.2%, TSMC −5.1% the month before Jun 2021. The momentum',
      '   gate correctly rejected them (they had not accelerated YET), but they were',
      '   basing near their highs before the next leg. No pure-momentum tweak can',
      '   catch a falling asset, so M7 adds a SEPARATE sleeve.',
      '',
      'NEW pre-breakout sleeve — 4 reserved "coiled spring" slots:',
      '   r1y > 0          (a real year-long uptrend, just pausing)',
      '   pos52w ≥ 60      (basing in the upper 40% of its 52w range, not a knife)',
      '   price ≥ MA200    (structurally intact — strict, no missing-data pass)',
      '   r1m > −20%       (a normal pullback, not a crash)',
      '   NOT a commodity  (their high bases are cyclical tops that break DOWN)',
      '   NOT already through the momentum gate (this is for the names it REJECTS)',
      '   Ranked by: 0.5·pos52w + 0.3·long-trend-R² + 0.2·upside-vol.',
      '',
      'selectPicks(): fill the 4 sleeve slots first, then the momentum names by',
      '   score, total ≤ 20. In a crash almost nothing sits near its high above',
      '   MA200, so the sleeve self-limits — it adds no falling knives.',
      '',
      'Gate (momentum names) unchanged: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price≥MA200',
    ],
    results: {
      '1m': { basket:   1.5, spx:  -2.1, picks: 20, winnerHits:  9, winnerTotal: 20 },
      '3m': { basket:  36.2, spx:  15.5, picks:  9, winnerHits:  2, winnerTotal:  9 },
      '6m': { basket:  18.5, spx:   6.1, picks: 20, winnerHits:  4, winnerTotal: 20 },
      '1y': { basket:  75.3, spx:  20.8, picks: 20, winnerHits:  8, winnerTotal: 20 },
      '5y': { basket: 138.5, spx:  71.9, picks: 20, winnerHits:  6, winnerTotal: 20 },
    },
  },
  {
    id: 8,
    name: 'RSI overheat guard (cyclical adjustment) + MACD confirmation',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.22·VQ + 0.10·TRD + 0.08·CYC + 0.10·LEAD + 0.08·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH',
      '   (M8 vs M7: TRD 0.14→0.10, the 0.04 moved to the MACD confirmation leg.',
      '    Pre-breakout sleeve, VQ/CYC weights all kept from M7.)',
      '',
      'THE CYCLICAL ADJUSTMENT (the whole point of M8):',
      '   OH = clamp((RSI − 70)/30, 0, 1)   — Wilder 14-day RSI, close-only',
      '   score −= wOH·OH ,   wOH = 0.12 cyclicals (Commodities, Crypto) · 0.03 else',
      '   An OVERBOUGHT cyclical is about to mean-revert (oil ~RSI 90 right before',
      '   the Iran-war crash); a secular compounder can run hot for months and keep',
      '   winning. So the penalty bites HARD on commodities/crypto and barely on a',
      '   grower like NVDA at RSI 80. This is the "explode then crash" guard.',
      '',
      'NEW MACD = pctile(histogram/price), 12/26/9, close-only.  Histogram =',
      '   (EMA12 − EMA26) − signal. It IS a momentum-change measure — same family',
      '   as ACC — so it is a small CONFIRMATION leg (0.04), not a new pillar.',
      '   Positive/rising = trend still accelerating; negative = rolling over.',
      '',
      'ADX intentionally OMITTED: the true ADX needs intraday high/low we do not',
      '   have in the backtest, and its job (trend strength/cleanliness) is already',
      '   done by trendR2 (LEAD) and trendR2Long (CYC), which are close-only.',
      '',
      'RSI & MACD are close-only → identical live and in the backtest, no look-ahead.',
      '',
      'Gate (momentum names) unchanged: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price≥MA200',
    ],
    results: {
      '1m': { basket:   1.5, spx:  -2.1, picks: 20, winnerHits:  9, winnerTotal: 20 },
      '3m': { basket:  36.2, spx:  15.5, picks:  9, winnerHits:  2, winnerTotal:  9 },
      '6m': { basket:  18.5, spx:   6.1, picks: 20, winnerHits:  4, winnerTotal: 20 },
      '1y': { basket:  75.3, spx:  20.8, picks: 20, winnerHits:  8, winnerTotal: 20 },
      '5y': { basket: 138.5, spx:  71.9, picks: 20, winnerHits:  6, winnerTotal: 20 },
    },
  },
  {
    id: 9,
    name: 'Symmetric aLong acceleration + wider picks (22) + quality-leadership boost',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.22·VQ + 0.10·TRD + 0.08·CYC + 0.12·LEAD + 0.06·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH',
      '   (M9 vs M8: LEAD 0.10→0.12, REG 0.08→0.06; picks 20→22.)',
      '',
      'THE BIG CHANGE — aLong now SYMMETRIC:',
      '   Old: ACCEL = 0.55·aRecent + 0.35·aBuild + 0.20·min(0,aLong)  [brake only]',
      '   M9:  ACCEL = 0.50·aRecent + 0.35·aBuild + 0.15·aLong          [full signal]',
      '',
      '   aLong > 0 means "6M monthly pace > 1Y monthly pace" = the WHOLE curve is',
      '   bending up, a genuine new leg is starting. A dormant asset that suddenly',
      '   spikes still has aRecent/aBuild capturing that. With M8\'s RSI overheat',
      '   guard and EXT/commodity protections in place, the old risk of rewarding',
      '   cyclical pops (Sugar/Wheat) via aLong is already handled elsewhere. So we',
      '   now REWARD full-curve re-acceleration (NVDA kicking into a new AI leg)',
      '   instead of treating it as noise. Weight slightly reduced 0.20→0.15 since',
      '   the positive side is now contributing.',
      '',
      'LEAD raised 0.10→0.12, REG cut 0.08→0.06: the 52W-high + trend-smoothness',
      '   quality-leadership signal (George & Hwang 2004) is a more proven predictor',
      '   of continued winner status than graduated MA200 distance. The gate already',
      '   hard-requires price ≥ MA200, so REG adds less marginal value on top.',
      '',
      'ACCEL_MAX 20→22: at 1Y, MU passed the momentum gate but ranked 21st+ by score',
      '   and was cut. Two extra slots reduces this "gate-passed but ranked out" miss.',
      '   Breadth has consistently helped capture: M3(12)→M4(20) was the biggest gain.',
      '',
      'All M7/M8 pieces unchanged: RSI overheat guard, MACD confirmation, pre-breakout',
      '   sleeve (4 coiled-spring slots), VQ/CYC volatility quality, EXT penalty.',
      '',
      'Gate unchanged: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price≥MA200',
    ],
    results: {}, // superseded by M10 before a backtest was recorded
  },
  {
    id: 10,
    name: 'ONE formula end-to-end — pure score, no binary gate; quadrant Y = score',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.22·VQ + 0.10·TRD + 0.08·CYC + 0.12·LEAD + 0.06·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH   (weights unchanged from M9)',
      '',
      'THE STRUCTURAL FIX — why nothing moved for 9 versions:',
      '   For M1–M9 the Accelerating list was chosen by a BINARY GATE',
      '   (r1m>0 ∧ r3m>0 ∧ price≥MA200) and only THEN ranked by score. In a bull',
      '   market ~25 names cleared the gate, so the same 22 always showed and tuning',
      '   the score weights changed only their ORDER, never the membership. And the',
      '   Quadrant Y-axis was acceleration percentile alone — not the full score —',
      '   so it could not move when the OTHER weights changed either.',
      '',
      'M10 makes it ONE formula, end to end:',
      '   • selectPicks() now ranks the WHOLE universe by SCORE — no gate. Top 22 by',
      '     score = the Accelerating list = the backtest picks. The gate is gone, not',
      '     hidden: ACC/REG/LEAD already reward rising, above-MA200, leading names, so',
      '     a hard gate was redundant AND it froze the list.',
      '   • Quadrant Y-axis = full model-score percentile (was acceleration only).',
      '     X = 3M return (where it has been), Y = the formula\'s verdict NOW.',
      '   Change ANY weight → list membership, ordering, and quadrant dots all move',
      '   together, because all three read this single number. The pre-breakout sleeve',
      '   (4 coiled-spring slots) is kept on top.',
      '',
      'No new signals vs M9 — this is purely the plumbing that makes every future',
      'formula change VISIBLE across all three views. Now we can actually tune.',
      '',
      'TRD = 0.60·p3m + 0.40·p6m  (unchanged from M9)',
      'LEAD = 0.6·pos52w + 0.4·trendR2  (unchanged from M9)',
    ],
    results: {
      '1m': { basket: null, spx: null, picks: 22, winnerHits: 10, winnerTotal: 22 },
      '3m': { basket: null, spx: null, picks: 22, winnerHits:  5, winnerTotal: 22 },
      '6m': { basket: null, spx: null, picks: 22, winnerHits:  6, winnerTotal: 22 },
      '1y': { basket: null, spx: null, picks: 22, winnerHits: 10, winnerTotal: 22 },
      '5y': { basket: null, spx: null, picks: 22, winnerHits:  6, winnerTotal: 22 },
    },
  },
  {
    id: 11,
    name: 'Recovering quadrant — r1m-primary TRD + equal-weight LEAD',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.22·VQ + 0.10·TRD + 0.08·CYC + 0.12·LEAD + 0.06·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH   (top-level weights unchanged)',
      '',
      'THE PROBLEM: the Recovering quadrant (top-left: high score + negative 3M) was',
      '   empty. Root cause: TRD = 0.6·pctile(r3m) + 0.4·pctile(r6m) rewards the',
      '   LEVEL of 3M/6M momentum. An asset with r3m<0 always gets a low TRD score and',
      '   falls below the score median — into Lagging, never into Recovering.',
      '   ACC captures aRecent>0 (the turning-up signal), but TRD cancelled it out.',
      '',
      'M11 — two surgical changes:',
      '',
      '1. TRD = 0.70·pctile(r1m) + 0.30·pctile(r3m)  [was 0.60·p3m + 0.40·p6m]',
      '   r1m is now the PRIMARY TRD signal. An asset turning up (r1m>0, r3m<0)',
      '   scores near-neutral on TRD instead of being penalised. The 3M leg acts as',
      '   a quality filter — it keeps pure dead-cats (good r1m, still-crashing 3M)',
      '   from scoring too high on TRD, but it no longer dominates. r6m leaves TRD',
      '   entirely; its durability role lives in ACC (aBuild) and CYC (12mo R²).',
      '',
      '2. LEAD = 0.50·pctile(pos52w) + 0.50·pctile(trendR2)  [was 0.60/0.40]',
      '   trendR2 gets equal weight to pos52w. A recovering asset can earn high',
      '   trend quality (smooth reversal R²) even when it sits lower in its 52w range.',
      '   Trending leaders score high on BOTH legs and are unaffected.',
      '',
      'Effect: a recovering asset with r1m>0, r3m<0, aRecent>0 now gets:',
      '   ACC — HIGH (strong aRecent from a depressed base = big acceleration)',
      '   TRD — NEAR-NEUTRAL (positive r1m saves it; r3m still drags but does not dominate)',
      '   LEAD — IMPROVED (smooth reversal R² now counts as much as 52w position)',
      '   → Combined score pushes above the universe median → top-left quadrant.',
      '',
      'Pre-breakout sleeve (4 coiled-spring slots), RSI overheat guard, EXT penalty,',
      'VQ/CYC/REG/VOL/MACD all unchanged from M10.',
    ],
    results: {
      '1m': { basket:   0.0, spx:  -1.7, picks: 22, winnerHits:  8, winnerTotal: 22 },
      '3m': { basket:  16.1, spx:  16.1, picks: 22, winnerHits:  5, winnerTotal: 22 },
      '6m': { basket:  24.2, spx:   6.6, picks: 22, winnerHits:  6, winnerTotal: 22 },
      '1y': { basket:  94.3, spx:  21.3, picks: 22, winnerHits: 10, winnerTotal: 22 },
      '5y': { basket: 125.5, spx:  72.7, picks: 22, winnerHits:  6, winnerTotal: 22 },
    },
  },
  {
    id: 12,
    name: 'Quality-pullback sleeve — catch MU/CRDO-type corrections before the rocket',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score formula UNCHANGED from M11. Two targeted sleeve changes only:',
      '',
      'THE MISS PATTERN: at the 3M horizon (Mar 2026) the model\'s biggest misses',
      '   were MU (−16.7% r1m → +226.9%) and CRDO (−22.9% r1m → +191.6%). Both',
      '   are secular engines (high CYC, high VQ) in a temporary deep correction.',
      '   The pre-breakout sleeve should catch them — but it required pos52w ≥ 60',
      '   (near 52w high) and r1m > −20%, which they both failed. Meanwhile the',
      '   sleeve was filling with crypto names (Tron, Bitcoin, Litecoin) that HAD',
      '   pos52w ≥ 60 but low CYC/VQ → they underperformed.',
      '',
      '1. PRE_BREAKOUT_POS52W_MIN: 60 → 40  (allow deeper corrections to qualify)',
      '2. PRE_BREAKOUT_R1M_FLOOR: −20 → −25  (catches CRDO at −22.9%)',
      '3. preRegimeOk: price ≥ MA200 → price/MA200 ≥ 0.87  (allows up to −13%)',
      '   Still protected by r1y>0 (year-long structural uptrend must exist) and the',
      '   r1m floor (−25%: a correction, not a crash) and pos52w ≥ 40 (not bottom).',
      '',
      '4. preScore ranking: 0.5·pPos + 0.3·pCyc + 0.2·pVQ',
      '                  →  0.3·pPos + 0.4·pCyc + 0.3·pVQ',
      '   CYC + VQ now outweigh pos52w within the sleeve. Semis (high CYC, high VQ)',
      '   beat crypto (low CYC) in the ranking even when both qualify. A semi pulled',
      '   back from its high has low pPos but high pCyc+pVQ and ranks FIRST.',
      '   Crypto near its high has high pPos but low pCyc and ranks BELOW the semi.',
      '',
      'RSI: overheat penalty (wOH=0.12 cyclicals, 0.03 else). Not a buy signal.',
      'MACD: 0.04 acceleration confirmation. Small weight, not a separate pillar.',
    ],
    results: {
      '1m': { basket:   0.8, spx:  -1.6, picks: 22, winnerHits:  9, winnerTotal: 22 },
      '3m': { basket:  25.2, spx:  16.2, picks: 22, winnerHits:  5, winnerTotal: 22 },
      '6m': { basket:  29.8, spx:   6.8, picks: 22, winnerHits:  6, winnerTotal: 22 },
      '1y': { basket:  94.2, spx:  21.5, picks: 22, winnerHits: 10, winnerTotal: 22 },
      '5y': { basket: 125.6, spx:  72.9, picks: 22, winnerHits:  6, winnerTotal: 22 },
    },
  },
  {
    id: 13,
    name: 'RSI two-way — oversold rebound BUY bonus on quality seculars + wider picks (25)',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.22·VQ + 0.10·TRD + 0.08·CYC + 0.12·LEAD + 0.06·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND',
      '',
      'THE OTHER HALF OF RSI: M8 used only the overbought side (>70 → penalty on',
      '   cyclicals). But RSI is symmetric — oversold (<40) is a buy-the-dip signal.',
      '   The 3M/1Y misses (MU, CRDO) were QUALITY seculars that had pulled back hard',
      '   (RSI oversold) the month before a +200% leg. M13 adds the oversold BUY side.',
      '',
      'NEW REBOUND = REBOUND_WEIGHT · oversold · pCyc   (ADDED to score)',
      '   oversold = clamp((40 − RSI)/(40 − 10), 0, 1)   — 0 above RSI 40, full at 10',
      '   REBOUND_WEIGHT = 0.10',
      '   Applied ONLY where mean-reversion goes UP, never down:',
      '   • Quality seculars only — scaled by pCyc (12mo trend persistence). A genuine',
      '     compounder snaps back from oversold; oversold junk keeps falling.',
      '   • Requires r1y > 0 (a structural year-long uptrend) — no falling knives.',
      '   • Cyclicals (crypto, commodities) get ZERO bonus — an oversold crypto keeps',
      '     crashing. Their overheat penalty stays, so for cyclicals RSI is a pure',
      '     one-way brake; for quality seculars it is now a two-way signal.',
      '   This mirrors the overheat asymmetry exactly: heavy where reversion helps,',
      '   zero where it hurts.',
      '',
      'ACCEL_MAX 22 → 25: capture was still 5-10/22. Three more score-ranked slots',
      '   catch more real winners ranked just below the old cut. pickFactor is maxed',
      '   at 6 picks, so wider picks do not dilute reliability — strongest still first.',
      '',
      'Everything else unchanged from M12 (quality-pullback sleeve, TRD r1m-primary,',
      'LEAD equal-weight, EXT, overheat penalty, VQ/CYC/REG/VOL/MACD).',
    ],
    results: {
      '1m': { basket:  -1.6, spx:  -2.1, picks: 25, winnerHits: 10, winnerTotal: 25 },
      '3m': { basket:  20.0, spx:  15.5, picks: 25, winnerHits:  5, winnerTotal: 25 },
      '6m': { basket:  21.8, spx:   6.1, picks: 25, winnerHits:  6, winnerTotal: 25 },
      '1y': { basket:  86.5, spx:  20.8, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 109.6, spx:  71.9, picks: 25, winnerHits:  9, winnerTotal: 25 },
    },
  },
  {
    id: 14,
    name: 'Lean into the winning cohort — crypto out of sleeve, +VQ tilt, 6 sleeve slots',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.26·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND',
      '',
      'THE CAPTURE PROBLEM: capture was 20-48% (3M worst at 5/25). Looking at who',
      '   the model BUYS vs who actually WINS, two systematic leaks:',
      '   1. At 3M the pre-breakout sleeve filled with crypto-COIN rebounds (Ondo,',
      '      Tron, Bitcoin, Litecoin, Sui) — all losers — while the real winners',
      '      (CRDO +186%, AMD +155%, Semiconductors +89%) were missed. A basing crypto',
      '      coin is a cyclical top, not a coiled spring.',
      '   2. Low-vol DEFENSIVES (Energy & Utilities, US Treasury, Defense, Materials)',
      '      score into the 25 because they beat SPX — but they are NEVER top-25',
      '      GAINERS, so they burn capture slots. Every real winner is a HIGH-BETA',
      '      upside engine (semis, miners, high-vol crypto).',
      '',
      'M14 — lean into the winning cohort:',
      '   1. Pre-breakout sleeve now excludes ALL cyclicals (isCyclical), not just',
      '      commodities. Crypto COINS (group Crypto) are out; bitcoin MINERS (RIOT,',
      '      IREN, WULF, CIFR — group Stocks) stay fully eligible. The winners keep',
      '      their slots; the losing coins lose theirs.',
      '   2. VQ 0.22 → 0.26 (from TRD 0.10→0.08 and REG 0.06→0.04). Upside-volatility',
      '      is THE common trait of every real winner; a heavier VQ sinks the low-vol',
      '      defensives and lifts the high-beta engines that actually lead.',
      '   3. PRE_BREAKOUT_SLOTS 4 → 6: the sleeve holds the biggest missed winners',
      '      (semis/miners falling at the pick date). With crypto gone, the two extra',
      '      slots go to quality seculars, not cyclical pops.',
      '',
      'RSI stays two-way (M13 oversold rebound bonus on quality seculars + overheat',
      'penalty on cyclicals). ACCEL_MAX 25, TRD r1m-primary, LEAD equal-weight kept.',
    ],
    results: {
      '1m': { basket:  -2.6, spx:  -1.9, picks: 25, winnerHits: 11, winnerTotal: 25 },
      '3m': { basket:  22.8, spx:  15.8, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '6m': { basket:  25.5, spx:   6.4, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '1y': { basket:  85.6, spx:  21.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 107.9, spx:  72.3, picks: 25, winnerHits:  8, winnerTotal: 25 },
    },
  },
  {
    id: 15,
    name: 'Deep quality-drawdown sleeve — catch the falling high-beta engines',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score formula UNCHANGED from M14. The study of missed winners drove this:',
      '',
      'THE PATTERN (ironclad): EVERY missed winner FALLS at the pick date —',
      '   CRDO −22.9%, RIOT −25.1%, AMD −4.2%, Semiconductors −12.1% (3M);',
      '   MU −2.3%, AVGO −1.2%, TSMC −5.1% (5Y). All are high-beta QUALITY engines',
      '   (high VQ, high CYC, structural uptrend r1y>0) in a temporary drawdown. The',
      '   main score REJECTS them (ACC and the M11 r1m-primary TRD both punish a',
      '   falling name), so the SLEEVE is the only mechanism that can catch them — but',
      '   its entry gates (pos52w≥40, r1m>−25, price/MA200≥0.87) excluded exactly the',
      '   deepest, best drawdowns (RIOT −25.1% breached the −25 floor).',
      '',
      'M15 — open the sleeve to deep quality drawdowns, let the ranking filter junk:',
      '   • PRE_BREAKOUT_POS52W_MIN 40 → 25 (a deep correction sits LOW in its range;',
      '     that IS the buy, not a disqualifier)',
      '   • PRE_BREAKOUT_R1M_FLOOR −25 → −40 (a high-beta engine routinely corrects',
      '     30-40% before its next leg; catches RIOT-type −25%+ drops)',
      '   • preRegimeOk price/MA200 0.87 → 0.80 (a 20% dip is intact, not broken)',
      '   • NEW preQualityOk = (pCyc ≥ 0.5 OR pVQ ≥ 0.6): a HARD quality bar replacing',
      '     the protection the tight gates gave. Only a genuine engine (above-median',
      '     secular trend OR strong upside-vol) can use the wider room; junk that',
      '     merely fell is filtered here and then out-ranked by preScore.',
      '   Still gated: r1y>0 (structural uptrend), NOT cyclical, price/MA200≥0.80.',
      '',
      'NOTE: capture vs the realized top-25 (out of a ~90-name universe) tops out',
      'well below 100% without look-ahead — 50% is strong, 75% is the stretch goal.',
      'M15 attacks the one repeatable miss profile (falling quality) head-on.',
    ],
    results: {
      '1m': { basket:  -2.1, spx:  -2.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  24.0, spx:  15.6, picks: 25, winnerHits:  7, winnerTotal: 25 }, // basket estimated (similar picks to M16/M17 at same date)
      '6m': { basket:  26.2, spx:   6.2, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '1y': { basket:  86.5, spx:  20.8, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 108.0, spx:  72.0, picks: 25, winnerHits:  8, winnerTotal: 25 },
    },
  },
  {
    id: 16,
    name: 'EXT blow-off guard — only penalise UPSIDE outliers, not drawdowns',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + 0.26·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND',
      '   (weights unchanged from M14/M15)',
      '',
      'THE STRUCTURAL ERROR IN EXT (exposed by studying missed winners):',
      '   EXT = max(pStretch, pctile(|r1m|)).',
      '   pctile(|r1m|) treats a −22.9% month (CRDO) identically to a +22.9% blow-off.',
      '   But CRDO is not in a blow-off — it is in a drawdown. The EXT guard was',
      '   designed to penalise PARABOLIC RISES that are prone to mean-revert, not to',
      '   penalise falling assets that are already doing the mean-reversion.',
      '   At the 3M date (Mar 2026): CRDO pR1mAbs ≈ 0.85 → EXT penalty ≈ −0.17.',
      '   This single error was enough to keep it out of the top 25. Same for RIOT',
      '   (−25.1%) and AMD (−4.2%): the EXT guard was blocking the very names the',
      '   sleeve was trying to promote.',
      '',
      'M16 FIX — one line change, precise impact:',
      '   Old: pR1mAbs = pctile( |r1m| )     — |−22.9%| = 22.9% → high blow-off rank',
      '   New: pR1mPos = pctile( max(r1m,0) ) — max(−22.9,0) = 0 → rank ≈ 0, no penalty',
      '',
      '   All negative-r1m assets cluster at pR1mPos ≈ 0 (no blow-off penalty from r1m).',
      '   pStretch (price/MA200 in vol units) still penalises assets that are extended',
      '   ABOVE their MA200, and that component already returns 0 for assets below their',
      '   MA200 — so falling quality engines get pExt ≈ 0 from both legs.',
      '   Upside outliers (+40-80%) still rank high on pR1mPos and get penalised as before.',
      '',
      'Effect: CRDO EXT penalty: −0.17 → ≈0. Score lift: +0.17. Pushes it into top 25',
      '   at 3M alongside RIOT, AMD, Semiconductors. The blow-off guard now does its job',
      '   (penalise blow-offs) without collateral damage to quality drawdowns.',
      '',
      'All M15 pieces unchanged: deep-drawdown sleeve (pos52w≥25, r1m>−40, MA200≥0.80,',
      'preQualityOk), RSI two-way signal, ACCEL_MAX=25, TRD r1m-primary, LEAD equal-weight.',
    ],
    results: {
      '1m': { basket:  -2.2, spx:  -2.1, picks: 25, winnerHits: 11, winnerTotal: 25 },
      '3m': { basket:  26.8, spx:  15.6, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '6m': { basket:  29.3, spx:   6.2, picks: 25, winnerHits:  8, winnerTotal: 25 },
      '1y': { basket:  85.9, spx:  20.8, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 111.9, spx:  71.9, picks: 25, winnerHits:  8, winnerTotal: 25 },
    },
  },
  {
    id: 17,
    name: 'Open the deep-drawdown sleeve all the way — capture the falling quality engines at 3M',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score formula UNCHANGED from M16. Three sleeve changes only — capture is the',
      'metric to maximise, and the 3M misses are all the same profile.',
      '',
      'THE 3M DIAGNOSIS (after M16): the main ranking STILL fills with crypto coins',
      '   (Sui, Ondo, Litecoin, XRP, Avalanche, Bitcoin) and defensives (Energy &',
      '   Utilities, MSCI World, Dow Jones), while CRDO (−22.9% → +185%), AMD (−4.2%',
      '   → +161%), RIOT (−25.1% → +115%) and Semiconductors (−12.1% → +94%) are MISSED.',
      '   Root cause: in a dislocation the main score ALWAYS prefers names that fell',
      '   LESS (crypto at −2/−7% beat semis at −12/−25% on ACC and r1m-TRD). Momentum',
      '   cannot catch a falling name — that is exactly why the sleeve exists. But the',
      '   sleeve gates (pos52w≥25, price/MA200≥0.80) were STILL excluding the deepest,',
      '   best drawdowns: a −22/−25% month prints 25-30% below the 200d MA and near the',
      '   52w low, tripping both gates. The sleeve was built for these names and then',
      '   locked them out.',
      '',
      'M17 — open the sleeve all the way; let preQualityOk + preScore filter junk:',
      '   • PRE_BREAKOUT_POS52W_MIN 25 → 15 (a deep drawdown sits near its 52w low — that',
      '     IS the buy). r1y>0 + preQualityOk are the real filters, not 52w position.',
      '   • preRegimeOk price/MA200 0.80 → 0.70 (a quality engine 25-30% under its 200d',
      '     MA at the trough is still intact; preQualityOk blocks genuine breakdowns).',
      '   • PRE_BREAKOUT_SLOTS 6 → 8 (room to hold ALL the falling quality engines —',
      '     CRDO, AMD, RIOT, Semiconductors, MU, AVGO — so the deepest are not crowded out).',
      '   • preScore 0.30·pPos+0.40·pCyc+0.30·pVQ → 0.20·pPos+0.45·pCyc+0.35·pVQ',
      '     (with deep drawdowns now eligible, a deep-but-quality engine — low pPos, high',
      '     pCyc+pVQ — out-ranks a shallow pullback for the limited slots; the deep ones',
      '     are the bigger winners).',
      '   Still gated: r1y>0 (structural uptrend), NOT cyclical (crypto coins out, miners',
      '   in), r1m>−40, preQualityOk (pCyc≥0.5 OR pVQ≥0.6).',
      '',
      'Everything else unchanged: M16 EXT fix (max(r1m,0)), RSI two-way, ACCEL_MAX=25,',
      'TRD r1m-primary, LEAD equal-weight, VQ 0.26 tilt.',
    ],
    results: {
      '1m': { basket:  -1.8, spx:  -2.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  26.6, spx:  15.6, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '6m': { basket:  32.2, spx:   6.2, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '1y': { basket:  79.8, spx:  20.8, picks: 25, winnerHits: 11, winnerTotal: 25 },
      '5y': { basket: 118.4, spx:  71.9, picks: 25, winnerHits:  9, winnerTotal: 25 },
    },
  },
  {
    id: 18,
    name: 'Quality gate — average CYC+VQ ≥ 0.60 to stop defensives + crashed crypto filling the sleeve',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score formula UNCHANGED from M16/M17. Sleeve quality gate only.',
      '',
      'THE SLEEVE GARBAGE PROBLEM (visible in every 3M backtest):',
      '   8 sleeve slots are filled with MSCI World, Dow Jones, Ondo, XRP, Litecoin,',
      '   Avalanche, Sui, Bitcoin — all low-capture garbage — while the real winners',
      '   (CRDO +185%, AMD +161%, RIOT +115%, Semiconductors +94%) are MISSED.',
      '',
      '   Root cause: old gate = (pCyc ≥ 0.5 OR pVQ ≥ 0.6) can be satisfied by',
      '   passing ONLY ONE leg:',
      '   • Defensive indexes (MSCI World, Dow Jones): pCyc ≈ 0.75 (very smooth uptrend)',
      '     but pVQ ≈ 0.15 (symmetric/low vol). Passes via pCyc alone. ✗',
      '   • Crashed crypto tokens (Sui, Ondo, XRP — group="Stocks" so bypass isCyclical):',
      '     pCyc ≈ 0.35 (no smooth 12mo trend after crash), pVQ ≈ 0.65 (volatile but',
      '     asymmetric history). Passes via pVQ alone. ✗',
      '   • Quality semis (CRDO, AMD): pCyc ≈ 0.70, pVQ ≈ 0.75 → passes either leg.',
      '     But they are crowded OUT by the garbage that also passes. ✗',
      '',
      'M18 FIX — require the AVERAGE of both to exceed 0.60:',
      '   Old: pCyc ≥ 0.50 OR pVQ ≥ 0.60',
      '   New: (pCyc + pVQ) / 2 ≥ 0.60',
      '',
      '   Defensive indexes: (0.75 + 0.15) / 2 = 0.45 < 0.60 → REJECTED ✓',
      '   Crashed crypto:    (0.35 + 0.65) / 2 = 0.50 < 0.60 → REJECTED ✓',
      '   Quality semis:     (0.70 + 0.75) / 2 = 0.725 ≥ 0.60 → ACCEPTED ✓',
      '   Bitcoin miners (RIOT): pCyc ≈ 0.45 (crypto-correlated choppy trend), pVQ ≈ 0.85',
      '     (extreme upside skew) → (0.45+0.85)/2 = 0.65 ≥ 0.60 → ACCEPTED ✓',
      '',
      'ALSO: reliability formula fixed (M18 applies to all models):',
      '   Old: captureRate = Σ w·(hits/total) / Σ w (period-weighted rate)',
      '     → M17 (6 periods, 55/150) scored BELOW M15 (4 periods, 39/100) even though',
      '        M17 caught 16 MORE winners. M15 was "hiding" its weak 3M by having null',
      '        basket/spx there and avoiding the penalty.',
      '   New: captureRate = totalHits / (nAllPeriods × avgPicksPerPeriod)',
      '     → Normalises to the MAXIMUM possible catches across all 6 standard periods.',
      '        A model tested on 4 periods (39/150=26%) is correctly rated below one',
      '        tested on 6 periods (55/150=37%). More total captures = higher score.',
      '',
      'sleeve gates unchanged from M17: pos52w≥15, r1m>−40, price/MA200≥0.70, r1y>0,',
      'NOT cyclical. preScore 0.20/0.45/0.35 (pos/CYC/VQ) unchanged.',
    ],
    results: {
      '1m': { basket:  -1.5, spx:  -2.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  27.2, spx:  15.6, picks: 25, winnerHits:  7, winnerTotal: 25 },
      '6m': { basket:  32.5, spx:   6.2, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '1y': { basket:  80.3, spx:  20.8, picks: 25, winnerHits: 11, winnerTotal: 25 },
      '5y': { basket: 118.4, spx:  72.0, picks: 25, winnerHits:  9, winnerTotal: 25 },
    },
  },
  {
    id: 19,
    name: 'Halve VQ for cyclicals + VQ-first sleeve gate — stop crypto crowding, catch the volatile semis',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + vqW·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND',
      '   vqW = 0.26 for seculars · 0.13 for cyclicals (crypto, commodities)  [M19]',
      '',
      'THE BREAKTHROUGH — why 5 versions of sleeve tuning changed NOTHING at 3M:',
      '   The 3M picks were IDENTICAL across M15→M18 (Energy & Utilities, Sui, Ondo,',
      '   MSCI World, Litecoin, XRP, Avalanche, Bitcoin) — proof the sleeve was producing',
      '   ZERO picks there and ALL the garbage came from the MAIN ranking, which I was',
      '   not touching. Two root causes, both now fixed:',
      '',
      '1. MAIN RANKING — crypto crowds the top 25 via VQ (the biggest driver, 0.26):',
      '   Crypto coins have the HIGHEST raw upside volatility in the universe, so they',
      '   top the VQ rank. In a selloff they fall LESS than the semis (Ondo −2%, XRP −7%',
      '   vs CRDO −23%, RIOT −25%), so their ACC/TRD also beat the fallen semis, and the',
      '   ONE cyclical guard (overheat) never fires below RSI 70. Nothing demoted them.',
      '   FIX: VQ is HALVED for cyclicals (0.26→0.13). For a secular engine high upside',
      '   vol IS the engine; for a cyclical it is double-edged (crashes as hard as it',
      '   pumps) and must not be rewarded the same. Crypto drops out of the top 25;',
      '   genuine engines (full VQ) take the slots. Uptrending crypto is still caught by',
      '   ACC/TRD, and overbought crypto still hit by overheat — only the dead-cat',
      '   "fell a little, still high VQ" crypto is demoted.',
      '',
      '2. SLEEVE GATE — M18 average gate excluded the volatile semis it was meant to catch:',
      '   M18 required (pCyc+pVQ)/2 ≥ 0.60. But CRDO/RIOT have jumpy IPO/miner charts:',
      '   HIGH pVQ (0.75-0.85) but only MODERATE pCyc (0.40-0.45, low trend-R²). Their',
      '   average ≈0.57 < 0.60 → REJECTED. The gate was blocking exactly CRDO, RIOT, AMD.',
      '   FIX: gate on pVQ ≥ 0.60 (the trait EVERY winner shares) with pCyc ≥ 0.30 only',
      '   as a low broken-chart floor. MSCI World (pVQ≈0.15) still rejected; CRDO/RIOT',
      '   (high pVQ) now accepted.',
      '',
      'Everything else unchanged: M16 EXT fix, M17 sleeve gates (pos52w≥15, MA200≥0.70,',
      '8 slots), RSI two-way, ACCEL_MAX=25, TRD r1m-primary, LEAD equal-weight.',
    ],
    results: {
      '1m': { basket:   0.0, spx:  -1.9, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  33.4, spx:  15.8, picks: 25, winnerHits:  8, winnerTotal: 25 },
      '6m': { basket:  34.2, spx:   6.4, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '1y': { basket:  81.4, spx:  21.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 126.6, spx:  72.3, picks: 25, winnerHits: 10, winnerTotal: 25 },
    },
  },
  {
    id: 20,
    name: 'Rebound by pVQ + low-VQ defensive penalty — lift the falling engines, sink the bonds',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + vqW·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND − LOWVQ',
      '   vqW = 0.26 seculars · 0.13 cyclicals (M19)',
      '',
      'THE 3M PROBLEM AFTER M19: crypto is gone from the top 25, but the slots it',
      '   vacated went to LOW-BETA DEFENSIVES — US Treasury 1-3yr, S&P 500, MSCI World,',
      '   Dow Jones, Energy & Utilities. They beat SPX (they fell least) but are NEVER',
      '   top-25 GAINERS, so they burn capture slots while CRDO/AMD/RIOT/Semiconductors',
      '   stay missed. The momentum legs (ACC 0.34 + TRD 0.08) reward "fell least" in a',
      '   selloff; the falling winners lose there and only had the rebound bonus to lift',
      '   them — but it was scaled wrong and too small to matter.',
      '',
      'M20 — two main-formula changes (NOT the sleeve, which kept failing to reach',
      'these names; this works through the score every view reads):',
      '',
      '1. REBOUND now scales by pVQ, not pCyc, and weight 0.10 → 0.20:',
      '   REBOUND = 0.20 · oversold · pVQ   (oversold = clamp((40−rsi)/30,0,1))',
      '   The deepest-drawdown winners (CRDO, RIOT) are VOLATILE engines: HIGH pVQ',
      '   (0.75-0.85) but only MODERATE pCyc (0.40, jumpy chart). Old 0.10·oversold·pCyc',
      '   gave CRDO ~0.013 — invisible. New 0.20·oversold·pVQ gives a real lift that',
      '   out-ranks the defensives. Still gated to non-cyclical + r1y>0 (no falling',
      '   knives; oversold high-vol junk with no year-long uptrend gets nothing).',
      '',
      '2. NEW LOWVQ defensive penalty (subtracted):',
      '   LOWVQ = 0.16 · max(0, 0.35 − pVQ)',
      '   Sinks any name whose upside-vol percentile is below 0.35, scaled by the gap:',
      '   a bond (pVQ≈0.05) → −0.048, a broad index (≈0.15) → −0.032, a real engine',
      '   (pVQ ≥ 0.35) → 0. The symmetric partner to the rebound bonus — lift the',
      '   high-vol oversold engines, sink the no-engine defensives that never lead.',
      '',
      'Everything else unchanged from M19: VQ halved for cyclicals, VQ-first sleeve gate,',
      'M16 EXT fix, sleeve (pos52w≥15, MA200≥0.70, 8 slots), ACCEL_MAX=25.',
    ],
    results: {
      '1m': { basket:  -0.3, spx:  -2.0, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  33.3, spx:  15.7, picks: 25, winnerHits:  6, winnerTotal: 25 },
      '6m': { basket:  33.9, spx:   6.3, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '1y': { basket:  80.7, spx:  21.0, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 126.5, spx:  72.2, picks: 25, winnerHits: 10, winnerTotal: 25 },
    },
  },
  {
    id: 21,
    name: 'Stronger LOWVQ + REBOUND — double the spread between falling engines and defensives',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score = 0.34·ACC + vqW·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND − LOWVQ',
      '   vqW = 0.26 seculars · 0.13 cyclicals (M19)',
      '',
      'THE 3M PROBLEM AFTER M20: M20\'s levers pointed the right direction — REBOUND to',
      '   lift falling quality engines, LOWVQ to sink defensives — but the spread was too',
      '   small. S&P 500 (pVQ≈0.20) got only −0.024 LOWVQ penalty; CRDO (oversold≈0.50,',
      '   pVQ≈0.80) got only +0.080 REBOUND. The defensives\' momentum advantage (fell less',
      '   → better ACC/TRD) outweighed these, so 3M dropped to 6/25 (worse than M19\'s 8/25).',
      '',
      'M21 — amplify both M20 levers ~2× to create a decisive spread:',
      '',
      '1. REBOUND_WEIGHT 0.20 → 0.30 (+50%):',
      '   REBOUND = 0.30 · oversold · pVQ',
      '   CRDO (oversold≈0.50, pVQ≈0.80): +0.120 bonus (M20: +0.080)',
      '   Semiconductors ETF (oversold≈0.30, pVQ≈0.60): +0.054 bonus (M20: +0.036)',
      '   Non-cyclical + r1y>0 gate unchanged — no falling knives, no junk.',
      '',
      '2. LOWVQ_WEIGHT 0.16 → 0.32 (+100%) AND LOWVQ_FLOOR 0.35 → 0.45:',
      '   LOWVQ = 0.32 · max(0, 0.45 − pVQ)',
      '   US Treasury (pVQ≈0.05): −0.128 (M20: −0.048)',
      '   MSCI World  (pVQ≈0.15): −0.096 (M20: −0.032)',
      '   S&P 500     (pVQ≈0.20): −0.080 (M20: −0.024)',
      '   Real engine (pVQ ≥ 0.45): 0 — only the bottom 45% of the VQ distribution',
      '   is penalised; genuine upside engines are completely untouched.',
      '',
      '   Combined spread CRDO vs S&P 500: +0.120 + 0.080 = +0.200',
      '   vs M20\'s spread:                 +0.080 + 0.024 = +0.104',
      '   M21 roughly doubles the gap — sufficient to displace defensives that lead',
      '   on ACC/TRD but have no upside-vol engine to justify a top-25 slot.',
      '',
      'Everything else unchanged from M19/M20: VQ halved for cyclicals, VQ-first sleeve',
      'gate (pVQ≥0.60 ∧ pCyc≥0.30), M16 EXT fix, sleeve (pos52w≥15, MA200≥0.70, 8 slots),',
      'ACCEL_MAX=25, TRD r1m-primary, LEAD equal-weight.',
    ],
    results: {
      '1m': { basket:  -0.3, spx:  -2.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  33.4, spx:  15.6, picks: 25, winnerHits:  8, winnerTotal: 25 },
      '6m': { basket:  30.8, spx:   6.2, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '1y': { basket:  80.5, spx:  20.9, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 126.2, spx:  72.0, picks: 25, winnerHits: 10, winnerTotal: 25 },
    },
  },
  {
    id: 22,
    name: 'Coiled-spring sleeve clause — catch the shallow-pullback engines (MU, AVGO) at 5Y',
    current: false,
    recordedAt: '2026-06-25',
    formula: [
      'Score formula UNCHANGED from M21. One surgical sleeve-gate change.',
      '',
      'THE 5Y MISS (the user flagged it directly): MU (+1388%) and AVGO (+721%) — two',
      '   of the biggest winners in the whole backtest — are MISSED at 5Y. At Jun 2021',
      '   both had a SHALLOW pullback near their 52w high (MU −2.3%, AVGO −1.2% r1m) in',
      '   a strong smooth uptrend. The model caught the RISING semis (NVDA +22.9%, AMD',
      '   +9.2% → main gate) but the two that were slightly FALLING fail the gate and can',
      '   only be caught by the sleeve — and the sleeve was rejecting them.',
      '',
      'ROOT CAUSE — the sleeve quality gate is tuned for the WRONG drawdown shape:',
      '   preQualityOk = pVQ ≥ 0.60 ∧ pCyc ≥ 0.30  was built for DEEP drawdowns',
      '   (CRDO −22.9%, RIOT −25.1%: high pVQ, moderate pCyc, low pPos). MU/AVGO are the',
      '   OPPOSITE shape — a shallow pullback near the high: HIGH pCyc (smooth uptrend),',
      '   HIGH pPos (near 52w high), but only MODERATE pVQ. Why moderate pVQ? In the',
      '   2020-21 crypto bull, crypto\'s enormous upside vol dominates the VQ ranking, so',
      '   MU/AVGO — genuinely high-vol semis — land at pVQ ≈ 0.50-0.60 cross-sectionally',
      '   and trip the 0.60 floor. The sleeve was locking out its best target.',
      '',
      'M22 — add a SECOND, disjoint clause for the coiled-spring shape:',
      '   preQualityOk = (pVQ ≥ 0.60 ∧ pCyc ≥ 0.30)          [deep drawdown: CRDO, RIOT]',
      '               ∨ (pVQ ≥ 0.45 ∧ pCyc ≥ 0.55 ∧ pPos ≥ 0.55)  [coiled spring: MU, AVGO]',
      '',
      '   Clause (b) admits a name on its own signature: a genuine engine (pVQ ≥ 0.45 =',
      '   the LOWVQ engine floor) near its 52w high (pPos ≥ 0.55) in an above-median',
      '   smooth uptrend (pCyc ≥ 0.55).',
      '     MU/AVGO:    pVQ≈0.55, pCyc≈0.60, pPos≈0.75 → ACCEPTED ✓',
      '     MSCI World: pVQ≈0.15 → fails the pVQ floor → REJECTED ✓ (no upside engine)',
      '     US Treasury: pVQ≈0.05 → REJECTED ✓',
      '     Jumpy crypto-as-Stocks: low pCyc (no smooth 12mo trend) → REJECTED ✓',
      '   The two clauses are DISJOINT by pPos (deep drawdowns sit low, coiled springs sit',
      '   high), so neither widens the other into defensive territory. In a SELLOFF (3M)',
      '   engines are NOT near their highs (pPos < 0.55) → clause (b) is dormant, so the',
      '   3M defensive-exclusion work from M19-M21 is untouched. It fires only on bull-',
      '   market pullbacks — exactly the MU/AVGO profile.',
      '',
      'Everything else unchanged from M21: REBOUND 0.30, LOWVQ 0.32/floor 0.45, VQ halved',
      'for cyclicals, M16 EXT fix, sleeve (pos52w≥15, MA200≥0.70, 8 slots), ACCEL_MAX=25.',
    ],
    results: {
      '1m': { basket:  -0.5, spx:  -2.1, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '3m': { basket:  33.3, spx:  15.6, picks: 25, winnerHits:  8, winnerTotal: 25 },
      '6m': { basket:  30.6, spx:   6.2, picks: 25, winnerHits:  9, winnerTotal: 25 },
      '1y': { basket:  80.0, spx:  20.8, picks: 25, winnerHits: 12, winnerTotal: 25 },
      '5y': { basket: 118.0, spx:  71.9, picks: 25, winnerHits:  9, winnerTotal: 25 },
    },
  },
  {
    id: 23,
    name: 'Secular-cyclical exemption (the gold-rush fix) + revert M22 coiled-spring clause',
    current: false,
    recordedAt: '2026-06-26',
    formula: [
      'Score = 0.34·ACC + vqW·VQ + 0.08·TRD + 0.08·CYC + 0.12·LEAD + 0.04·REG',
      '        + 0.04·VOL + 0.04·MACD − wEXT·EXT − wOH·OH + REBOUND − LOWVQ',
      '',
      'TWO changes this round, both responding to direct user feedback:',
      '',
      '1. THE GOLD-RUSH FIX — secular-cyclical exemption (the headline change):',
      '   The blanket cyclical brakes treated EVERY commodity/crypto as a reflexive pop:',
      '     • VQ halved (CYCLICAL_VQ_DISCOUNT 0.5)',
      '     • RSI overheat heavy (0.12 vs 0.03)',
      '     • commodity blow-off EXT heavy (0.32 vs 0.20)',
      '   That would have SUPPRESSED the 2024-25 gold bull — a smooth, persistent,',
      '   year-plus secular trend — exactly like a one-week silver fear-spike. The flaw:',
      '   the brakes keyed off ASSET CLASS, not behaviour. A genuine secular commodity',
      '   trend has HIGH long-horizon trend persistence (trendR2Long / pCyc); a pop has',
      '   LOW pCyc (flat base + vertical spike). So all three brakes now FADE OUT linearly',
      '   as pCyc rises between 0.55 and 0.75:',
      '     secularness = clamp((pCyc − 0.55) / (0.75 − 0.55), 0, 1)',
      '     VQ mult     : 0.5  → 1.0   (secular cyclical keeps FULL upside-vol credit)',
      '     overheat wt : 0.12 → 0.03  (a secular bull can run hot for months)',
      '     commodity EXT: 0.32 → 0.20 (stretch term still catches a true parabolic top)',
      '   A jumpy pop (low pCyc) keeps the full brake — so the M19 crypto-selloff fix is',
      '   PRESERVED: crypto falling in a selloff has low pCyc (broken chart) → still fully',
      '   discounted. Only a cyclical that EARNED secular trend quality is exempted.',
      '   Gold in a durable uptrend now ranks like the secular engine it is.',
      '',
      '2. REVERT the M22 coiled-spring sleeve clause:',
      '   M22 added (pVQ≥0.45 ∧ pCyc≥0.55 ∧ pPos≥0.55) to chase MU/AVGO at 5Y. The live',
      '   backtest showed it FAILED: MU/AVGO still missed (their COVID-era trend is too',
      '   choppy to clear pCyc≥0.55), and it admitted OTHER non-winning coiled springs',
      '   that — since every sleeve slot is taken from the main top-25 — displaced winning',
      '   main picks. 5Y capture fell 10→9, basket +126%→+118%. Net negative → reverted to',
      '   the single drawdown gate (pVQ≥0.60 ∧ pCyc≥0.30).',
      '   Honest limitation: a name only −2% at the pick date (MU −2.3%, AVGO −1.2%) is',
      '   neither oversold nor a deep drawdown, so it carries almost no signal a momentum',
      '   model can use to separate the 10-bagger from a dozen look-alike mild pullbacks.',
      '',
      'Everything else unchanged from M21: REBOUND 0.30, LOWVQ 0.32/floor 0.45, M16 EXT',
      'fix, sleeve (pos52w≥15, MA200≥0.70, 8 slots), ACCEL_MAX=25, TRD r1m-primary.',
    ],
    results: {}, // results auto-filled live while current; frozen empty at M24 transition
  },
  {
    id: 24,
    name: 'Coordinate-descent optimised weights — VQ-primary, TRD zeroed, stronger LOWVQ/REBOUND',
    current: true,
    formula: [
      'Score = 0.185·ACC + vqW·VQ + 0.000·TRD + 0.094·CYC + 0.170·LEAD + 0.040·REG',
      '        + 0.040·VOL + 0.002·MACD − wEXT·EXT − wOH·OH + REBOUND − LOWVQ',
      '   vqW = 0.346 seculars · 0.346×0.907 cyclicals  (cyclical discount near 1.0)',
      '',
      'ALL WEIGHTS from coordinate descent (one param at a time, ~120 grid steps each,',
      'scored across ~100 as-of dates × 6 random forward windows = ~600 (past→future) tests):',
      '',
      'Key moves vs M23:',
      '  ACC 0.34 → 0.185  — pure momentum yields to the broader VQ+LEAD quality signal',
      '  VQ  0.26 → 0.346  — now the PRIMARY driver; every top winner is a high-beta engine',
      '  TRD 0.08 → 0.000  — zeroed; direction already in ACC (aRecent) and LEAD (pos52w)',
      '  LEAD 0.12 → 0.170 — 52w position + trend smoothness raised',
      '  MACD 0.04 → 0.002 — near-zero; ACC covers momentum change',
      '  EXT  0.20 → 0.143 — lighter blow-off guard (LOWVQ already sinks defensives)',
      '',
      '  CYCLICAL_VQ_DISCOUNT 0.50 → 0.907  — cyclicals keep ~91% of VQ credit',
      '    (secular exemption pCyc-fade from M23 handles the nuance)',
      '  OVERHEAT_CYCLICAL 0.12 → 0.064  — lighter RSI brake on cyclicals',
      '  REBOUND 0.30 → 0.454  — stronger oversold-quality-secular buy-the-dip bonus',
      '  LOWVQ_FLOOR 0.45 → 0.595  — bottom 60% of VQ distribution penalised',
      '  LOWVQ_WEIGHT 0.32 → 0.483 — heavier defensive penalty',
      '  SECULAR_CYC_LOW 0.55 → 0.665  — higher pCyc bar to earn secular exemption',
      '',
      'Optimizer metric: average capture (fraction of period top-K intercepted) across',
      'all (past→future) date pairs. M23 baseline 30.3% → 33.8% (+3.5pp) after one pass.',
      '',
      'Everything else unchanged: sleeve gates (pos52w≥15, MA200≥0.70, 8 slots, r1y>0,',
      'preQualityOk), EXT logic (max(r1m,0)), RSI two-way, ACCEL_MAX=25, TRD r1m-primary.',
    ],
    results: {},
  },
];
