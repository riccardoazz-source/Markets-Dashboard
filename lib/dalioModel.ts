// ─────────────────────────────────────────────────────────────────────────────
// DALIO EMS v3 — the consolidated formula (Ray's final, untruncated block)
//
// Shared Dalio math, consumed by BOTH the live rotation model
// (MODEL_MODE = 'dalio' in lib/rotationModel.ts) and the panel (DalioPanel.tsx).
//
//   FinalScore = C · (0.45·V + 0.45·M + 0.10·Persistence) · (1 − 0.5·Overheat) · ExitFactor
//
//   Cycle gate (tightened — the v2 gate let late-cycle pops through):
//     C = 1 if DistMA ≤ 0.15 AND Ret60 > 0 AND R2_12m > 0.5, else 0
//       DistMA  = Price/MA200 − 1     → hard 15% distance cap (no blow-offs)
//       Ret60   ≈ 3-month return > 0  → medium-term up
//       R2_12m  = R² of the 12-month price trend > 0.5 → CLEAN trend, not a spike
//
//   Flow:  volume assets → V = max(0, VolRatio − 1.1)   VolRatio = 5d ADV ÷ 60d ADV
//          volume-blind  → V = 0.20 · RangeExpansion    (proxy so the flow thesis lives on)
//
//   Momentum blend (long-horizon-weighted — was short-heavy in v2):
//          M = 0.4·pctile(Ret20) + 0.3·pctile(Ret60) + 0.3·pctile(Ret12m)   (20d / 3M / 12M)
//
//   Persistence = pctile( Ret20 / Ret60 ) for Ret60 > 0 — ACCELERATION (recent pace ≥ older
//          pace = early-cycle mover). v2 used the inverse (rewarded deceleration); Ray flipped it.
//
//   Overheat (commodity late-cycle brake): for commodities only, when the price is far above
//          its own 12-month median AND volume is surging:
//          Overheat = clamp( min(1,(Price/Median12m − 1.5)/0.5) · (VolRatio − 1.3), 0, 1 )
//          Score ×= (1 − 0.5·Overheat).
//
//   ExitFactor (exhaustion brake): 1 if Ret20 ≥ Ret60 else 0.7; ×0.8 more if R2_12m < 0.5.
//
//   Rank: FinalScore desc, tie-break VolRatio desc, then RelStr (Ret20 − ^GSPC) desc.
//         (RelStr is now a TIE-BREAK only — Ray's final formula dropped the hard >0 pre-filter.)
//
//   Ret60 ≈ 3-month return, Ret12m ≈ 1-year return, R2_12m = trailing ~12-month trend R².
//   Missing MA200 / R² (thin history) are NOT read as failing the gate. SeasonFactor deferred.
// ─────────────────────────────────────────────────────────────────────────────

export const DALIO_W_V = 0.45;
export const DALIO_W_M = 0.45;
export const DALIO_W_P = 0.10;
export const DALIO_VOL_FLOOR = 1.1;         // V = max(0, VolRatio − 1.1)
export const DALIO_DISTMA_MAX = 0.15;       // C: ≤ 15% above the 200D MA (hard cap)
export const DALIO_R2_MIN = 0.5;            // C + exit: clean 12-month trend threshold
export const DALIO_MBLEND_W = [0.4, 0.3, 0.3] as const; // Ret20 / Ret60 / Ret12m
export const DALIO_RANGE_BOOST = 0.20;      // volume-blind V = 0.20 · RangeExpansion
export const DALIO_OVERHEAT_PRICE = 1.5;    // commodity overheat: Price/Median12m threshold
export const DALIO_OVERHEAT_VOL = 1.3;      // commodity overheat: VolRatio threshold
export const DALIO_EXIT_DECEL = 0.7;        // ExitFactor when Ret20 < Ret60
export const DALIO_EXIT_R2 = 0.8;           // extra ExitFactor when R2_12m < 0.5
export const DALIO_MA200_BLOWOFF = 0.20;    // cycle phase label: > 20% above MA200
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

// ── Cycle gate C ─────────────────────────────────────────────────────────────
export interface DalioCParts {
  C: 0 | 1;
  distMA: number | null;
  ret60: number | null;
  r2_12m: number | null;
}

// Missing MA200 / R² (thin history) are treated as passing that leg (not read as
// "bad"), matching the rest of the codebase. Ret60 must be present and positive.
export function dalioCGate(
  price: number | null | undefined,
  ma200: number | null | undefined,
  ret60Pct: number | null | undefined,
  r2_12m: number | null | undefined,
): DalioCParts | null {
  if (price == null || price <= 0) return null;
  const distMA = ma200 != null && ma200 > 0 ? price / ma200 - 1 : null;
  const okDist = distMA == null || distMA <= DALIO_DISTMA_MAX;
  const okRet60 = ret60Pct != null && ret60Pct > 0;
  const okR2 = r2_12m == null || r2_12m > DALIO_R2_MIN;
  return { C: okDist && okRet60 && okR2 ? 1 : 0, distMA, ret60: ret60Pct ?? null, r2_12m: r2_12m ?? null };
}

export type CyclePhase = 'bottoming' | 'recovering' | 'early trend' | 'stretched' | 'blow-off';

export function dalioPhase(distMA: number | null, r2_12m: number | null): CyclePhase | null {
  if (distMA == null) return null;
  if (distMA > DALIO_MA200_BLOWOFF) return 'blow-off';
  if (distMA > DALIO_DISTMA_MAX) return 'stretched';
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
  median12m: number | null;  // 12-month median close (commodity overheat)
  rvol5: number | null;      // VolRatio (null → volume-blind)
  rvol20: number | null;     // context only
  rangeExp: number | null;   // range-expansion proxy (volume-blind flow)
  r20: number | null;        // Ret20 (20 trading-day return %)
  r1m: number | null;        // fallback for r20
  r3m: number | null;        // Ret60 (≈3-month)
  r1y: number | null;        // Ret12m (≈1-year)
  trendR2Long: number | null;// R2_12m (12-month trend R²)
}

export interface EmsEval {
  symbol: string;
  name: string;
  group: string;
  hasVolume: boolean;
  volRatio: number | null;
  ret20: number | null;
  rs20: number | null;       // Ret20 − benchmark (pp) — tie-break
  distMA: number | null;
  r2_12m: number | null;
  V: number;
  M: number;                 // 0.4·p20 + 0.3·p60 + 0.3·p12
  persistPct: number;        // pctile(Ret20/Ret60) — acceleration
  overheat: number;          // commodity overheat 0–1
  exitFactor: number;        // exhaustion brake 0.56–1
  C: 0 | 1 | null;
  ems: number | null;        // FinalScore
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
 * Score and rank the whole universe with EMS v3. Ranked assets first (desc
 * FinalScore, tie-break VolRatio then RelStr), then the rest.
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
    const parts = dalioCGate(it.price, it.ma200, it.r3m, it.trendR2Long);
    const C = parts?.C ?? null;
    const overheat = dalioOverheat(isCommodityGroup(it.group), it.price, it.median12m, it.rvol5);
    const exitFactor = dalioExitFactor(ret, it.r3m, it.trendR2Long);
    const rs20 = ret != null && benchRet != null ? ret - benchRet : null;
    const base = DALIO_W_V * V + DALIO_W_M * M + DALIO_W_P * persistPct;
    const ems = C == null ? null : C * base * (1 - 0.5 * overheat) * exitFactor;

    let ranked = C === 1 && it.symbol !== DALIO_BENCHMARK;
    if (C == null) reasons.push('no price data');
    if (C === 0 && parts) {
      if (parts.distMA != null && parts.distMA > DALIO_DISTMA_MAX) reasons.push(`${(parts.distMA * 100).toFixed(0)}% above 200D MA (> 15% cap)`);
      else if (!(it.r3m != null && it.r3m > 0)) reasons.push('3-month return ≤ 0');
      else if (it.trendR2Long != null && it.trendR2Long <= DALIO_R2_MIN) reasons.push(`12-month trend R² ${it.trendR2Long.toFixed(2)} ≤ 0.5 (not a clean trend)`);
      else reasons.push('cycle gate C = 0');
    }
    if (it.symbol === DALIO_BENCHMARK) reasons.push('benchmark itself');
    if (ranked && (ems == null || ems <= 0)) { ranked = false; reasons.push('FinalScore = 0'); }

    return {
      symbol: it.symbol, name: it.name, group: it.group,
      hasVolume, volRatio: it.rvol5, ret20: ret, rs20,
      distMA: parts?.distMA ?? null, r2_12m: it.trendR2Long,
      V, M, persistPct, overheat, exitFactor, C, ems, ranked,
      phase: dalioPhase(parts?.distMA ?? null, it.trendR2Long),
      macroFlagged: macroFlagged.has(it.symbol),
      reasons,
    };
  });

  // Rank: FinalScore desc → VolRatio desc → RelStr desc (Ray's tie-break order).
  const order = (a: EmsEval, b: EmsEval) =>
    ((b.ems ?? -1) - (a.ems ?? -1)) ||
    ((b.volRatio ?? 1.0) - (a.volRatio ?? 1.0)) ||
    ((b.rs20 ?? -Infinity) - (a.rs20 ?? -Infinity));

  const rankedList = evals.filter(e => e.ranked).sort(order);
  const rest = evals.filter(e => !e.ranked).sort(order);
  return [...rankedList, ...rest];
}
