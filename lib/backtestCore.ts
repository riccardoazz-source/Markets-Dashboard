// ── Backtest core — the shared, no-look-ahead input builder ──────────────────
// Both the live backtest route AND the offline parameter sweep build their as-of
// inputs HERE, so "what the model saw at a past date" is computed by ONE code path.
// Scoring is already shared via scoreRotation()/selectPicks(); this shares the data
// prep (returns, MA200, 52w position, realized vol, RSI, MACD) so the sweep tunes the
// exact same pipeline the live tool runs.
import { subDays } from 'date-fns';
import {
  ModelInput, realizedMonthlyVol, upsideVolEdge, trendQualityR2, rsiWilder, macdHistogram,
} from './rotationModel';
import { computeWeeklyADX } from './adx';
import { dalioVolumeRatios, rangeExpansion } from './dalioModel';

// Yahoo daily bars include volume when the ticker reports it — carried through so
// the Dalio EMS volume ratios (M31) are computable at any as-of date.
export type Hist = { date: string; close: number; high?: number; low?: number; volume?: number }[];
export interface BtMeta { symbol: string; name: string; group: string }
export type BtInput = ModelInput & { name: string; group: string };

export function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

// Last close at or before a date string (history is ascending by date).
export function priceAsOf(history: Hist, dateStr: string): number | null {
  let px: number | null = null;
  for (const pt of history) {
    if (pt.date <= dateStr) px = pt.close;
    else break;
  }
  return px;
}

export function retBetween(history: Hist, startStr: string, endStr: string): number | null {
  const a = priceAsOf(history, startStr);
  const b = priceAsOf(history, endStr);
  if (a == null || b == null || a === 0) return null;
  return (b / a - 1) * 100;
}

// 200-day MA from closes up to the as-of date (no look-ahead).
export function ma200AtDate(history: Hist, dateStr: string): number | null {
  const closes = history.filter(p => p.date <= dateStr).map(p => p.close);
  if (closes.length < 200) return null;
  return closes.slice(-200).reduce((s, c) => s + c, 0) / 200;
}

// 52-week range position as of a past date (trailing 365 calendar days, no look-ahead).
export function pos52wAtDate(history: Hist, dateStr: string): number | null {
  const d = new Date(dateStr); d.setDate(d.getDate() - 365);
  const cutoff = d.toISOString().slice(0, 10);
  const window = history.filter(p => p.date >= cutoff && p.date <= dateStr);
  if (window.length < 2) return null;
  let hi = -Infinity, lo = Infinity;
  for (const p of window) { if (p.close > hi) hi = p.close; if (p.close < lo) lo = p.close; }
  const cur = priceAsOf(history, dateStr);
  if (cur == null || hi <= lo) return null;
  return Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
}

// 52-week HIGH as of a past date (trailing 365 calendar days) — the Dalio C gate's
// HighDist input (M31). Same window as pos52wAtDate, raw high instead of position.
export function high52wAtDate(history: Hist, dateStr: string): number | null {
  const d = new Date(dateStr); d.setDate(d.getDate() - 365);
  const cutoff = d.toISOString().slice(0, 10);
  let hi = -Infinity, n = 0;
  for (const p of history) {
    if (p.date >= cutoff && p.date <= dateStr) { n++; if (p.close > hi) hi = p.close; }
  }
  return n >= 2 ? hi : null;
}

// 20 TRADING-day return (bar-count, not calendar) from closes up to the as-of date.
export function r20AtDate(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const cur = closes[closes.length - 1];
  const past = closes[closes.length - 21];
  return past > 0 ? (cur / past - 1) * 100 : null;
}

// Build the model inputs for every asset AS OF a past date — identical math to the
// live backtest route. No forward data is read, so it is a faithful reproduction.
export function buildInputsAsOf(universe: BtMeta[], histMap: Map<string, Hist>, asOfDate: Date): BtInput[] {
  const asOf = fmt(asOfDate);
  const d1m = fmt(subDays(asOfDate, 30));
  const d3m = fmt(subDays(asOfDate, 90));
  const d6m = fmt(subDays(asOfDate, 180));
  const d1y = fmt(subDays(asOfDate, 365));

  return universe.map(m => {
    const h = histMap.get(m.symbol) ?? [];
    const upToAsOf = h.filter(p => p.date <= asOf);           // daily OHLC, no look-ahead
    const closesAsOf = upToAsOf.map(p => p.close);
    const adxState = computeWeeklyADX(upToAsOf);              // weekly ADX as of this date (M26)
    return {
      symbol: m.symbol, name: m.name, group: m.group,
      r1m: retBetween(h, d1m, asOf),
      r3m: retBetween(h, d3m, asOf),
      r6m: retBetween(h, d6m, asOf),
      r1y: retBetween(h, d1y, asOf),
      price: priceAsOf(h, asOf),
      ma200: ma200AtDate(h, asOf),
      vol: realizedMonthlyVol(closesAsOf),
      volEdge: upsideVolEdge(closesAsOf),
      pos52w: pos52wAtDate(h, asOf),
      trendR2: trendQualityR2(closesAsOf),
      trendR2Long: trendQualityR2(closesAsOf, 252),
      rsi: rsiWilder(closesAsOf),
      macdHist: macdHistogram(closesAsOf),
      sma200w: null,
      volRatio: null,
      // M31 Dalio EMS inputs — same as-of window, no look-ahead.
      rvol5: dalioVolumeRatios(upToAsOf.map(p => p.volume)).rvol5,
      high52w: high52wAtDate(h, asOf),
      r20: r20AtDate(upToAsOf.map(p => p.close)),
      rangeExp: rangeExpansion(closesAsOf),
      adx: adxState?.adx ?? null,
      adxSlope: adxState?.adxSlope ?? null,
      plusDI: adxState?.plusDI ?? null,
      minusDI: adxState?.minusDI ?? null,
    };
  });
}
