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
 * Reliability ratio — how much we trust a version:
 *   WeightedAlpha = Σ weight_p · (basket_p − spx_p) / Σ weight_p   (periods with data)
 *   Reliability   = WeightedAlpha · min(1, AvgPicks / 6)
 * The picks factor penalises versions that beat the market on only 1–2 names:
 * a basket of 10 that beats SPX is more trustworthy than a basket of 2.
 */

export type PeriodKey = '1d' | '1m' | '3m' | '6m' | '1y' | '5y';

export interface PeriodResult {
  basket: number | null; // basket forward return % from as-of date to today
  spx: number | null;    // S&P 500 forward return % over the same window
  picks: number | null;  // how many names the model selected
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

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  '1d': '1D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', '5y': '5Y',
};

export const PERIOD_ORDER: PeriodKey[] = ['1d', '1m', '3m', '6m', '1y', '5y'];

export interface Reliability {
  weightedAlpha: number; // weighted avg of (basket − spx)
  hitRate: number;       // fraction of periods where basket beat spx
  avgPicks: number;      // mean pick count across periods with data
  reliability: number;   // weightedAlpha × min(1, avgPicks/6)
  nPeriods: number;      // how many periods had usable data
}

export function computeReliability(results: Partial<Record<PeriodKey, PeriodResult>>): Reliability | null {
  const entries = PERIOD_ORDER
    .map(k => ({ k, r: results[k] }))
    .filter((e): e is { k: PeriodKey; r: PeriodResult } =>
      e.r != null && e.r.basket != null && e.r.spx != null);
  if (entries.length === 0) return null;

  let wSum = 0, waSum = 0, hits = 0, pickSum = 0, pickN = 0;
  for (const { k, r } of entries) {
    const w = PERIOD_WEIGHTS[k];
    const alpha = (r.basket as number) - (r.spx as number);
    waSum += w * alpha;
    wSum += w;
    if (alpha > 0) hits++;
    if (r.picks != null) { pickSum += r.picks; pickN++; }
  }
  const weightedAlpha = wSum > 0 ? waSum / wSum : 0;
  const hitRate = hits / entries.length;
  const avgPicks = pickN > 0 ? pickSum / pickN : 0;
  const reliability = weightedAlpha * Math.min(1, avgPicks / 6);
  return { weightedAlpha, hitRate, avgPicks, reliability, nPeriods: entries.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTRY. Restart from Model 1 = the current live formula.
// As we iterate, freeze each model's results here and add the next one.
// ─────────────────────────────────────────────────────────────────────────────
export const MODEL_VERSIONS: ModelVersion[] = [
  {
    id: 1,
    name: 'Base — 3-horizon ACC · SHA-trend · regime gate',
    current: true,
    formula: [
      'Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL − wEXT·EXT',
      '',
      'ACC = pctile( 0.55·aRecent + 0.35·aBuild + 0.20·min(0,aLong) )',
      '   aRecent = p1 − p3   aBuild = p3 − p6   aLong = p6 − p1y',
      '   pX = pace mensile geometrica del ritorno a X mesi',
      'TRD = 0.50·p3m + 0.20·p6m + 0.30·SHA',
      '   SHA = pctile(r3m / volatilità mensile)   (null → 0.5)',
      'REG = 1.0 se price ≥ MA200 · 0.2 se sotto · 0.5 se MA assente',
      'VOL = pctile(volume ultimo / media 20g)   (null → 0.5)',
      'EXT = max( STRETCH_pctile , |r1m|_pctile )',
      '   wEXT = 0.20   ·   commodities 0.32',
      '',
      'Gate: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ price ≥ MA200',
      '   cap = 50%   ·   commodities 25%',
    ],
    results: {}, // auto-filled from the live backtest run
  },
];
