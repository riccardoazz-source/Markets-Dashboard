import { Timeframe, HistoricalPoint, CAGRData } from './types';
import { format, subDays, subWeeks, subMonths, subYears, startOfYear, startOfMonth } from 'date-fns';

export function formatPrice(price: number, currency = 'USD', compact = false): string {
  if (compact && price >= 1_000_000_000) {
    return `$${(price / 1_000_000_000).toFixed(2)}B`;
  }
  if (compact && price >= 1_000_000) {
    return `$${(price / 1_000_000).toFixed(2)}M`;
  }
  const decimals = price < 1 ? 6 : price < 10 ? 4 : price < 1000 ? 2 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
}

export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

export function getTimeframeStart(timeframe: Timeframe): string {
  const now = new Date();
  let date: Date;
  switch (timeframe) {
    // No intraday data source — 1D shows the last few daily points,
    // a 4-day window so weekends still leave at least one trading day.
    case '1D': date = subDays(now, 4); break;
    case '1W': date = subWeeks(now, 1); break;
    case 'MTD': date = startOfMonth(now); break;
    case '1M': date = subMonths(now, 1); break;
    case '3M': date = subMonths(now, 3); break;
    case '6M': date = subMonths(now, 6); break;
    case 'YTD': date = startOfYear(now); break;
    case '1Y': date = subYears(now, 1); break;
    case '3Y': date = subYears(now, 3); break;
    case '5Y': date = subYears(now, 5); break;
    case '10Y': date = subYears(now, 10); break;
    case 'MAX': return '1900-01-01';
    default: date = subYears(now, 1);
  }
  return format(date, 'yyyy-MM-dd');
}

export function getIntervalForTimeframe(timeframe: Timeframe): string {
  switch (timeframe) {
    case '1D':
    case '1W':
    case 'MTD':
    case '1M': return '1d';
    case '3M':
    case '6M':
    case 'YTD':
    case '1Y': return '1d';
    case '3Y':
    case '5Y': return '1wk';
    case '10Y':
    case 'MAX': return '1mo';
    default: return '1d';
  }
}

export function calculateCAGR(
  data: HistoricalPoint[],
  timeframe: Timeframe
): CAGRData | null {
  if (!data || data.length < 2) return null;
  const startDate = getTimeframeStart(timeframe);
  const filtered = data.filter(d => d.date >= startDate);
  if (filtered.length < 2) return null;

  const start = filtered[0];
  const end = filtered[filtered.length - 1];
  const startPrice = start.close;
  const endPrice = end.close;

  if (!startPrice || !endPrice) return null;

  const totalReturn = (endPrice - startPrice) / startPrice;
  const startMs = new Date(start.date).getTime();
  const endMs = new Date(end.date).getTime();
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000);
  const cagr = years >= 1 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;

  return {
    timeframe,
    return: totalReturn * 100,
    cagr: cagr * 100,
    startDate: start.date,
    endDate: end.date,
    startPrice,
    endPrice,
  };
}

export function normalizeData(data: HistoricalPoint[]): HistoricalPoint[] {
  if (!data || data.length === 0) return [];
  const basePoint = data.find(d => d.close > 0 && isFinite(d.close));
  if (!basePoint) return data.slice();
  const base = basePoint.close;
  return data.map(d => ({ ...d, close: (d.close / base) * 100 }));
}

// Google Finance-style: every series starts at exactly 0%,
// values represent % change from the first data point.
export function pctChangeFromStart(data: HistoricalPoint[]): HistoricalPoint[] {
  if (!data || data.length === 0) return [];
  const basePoint = data.find(d => d.close > 0 && isFinite(d.close));
  if (!basePoint) return data.slice();
  const base = basePoint.close;
  return data.map(d => ({ ...d, close: (d.close / base - 1) * 100 }));
}

/**
 * Benchmark overlay line: where the asset would sit if it had tracked SPY
 * exactly from the period start. spyLine[i] = asset[0].close × (spy@dateᵢ /
 * spy@date₀). SPY values are matched to each asset date via an at-or-before
 * lookup so series on different trading calendars (crypto 7d/wk vs equities)
 * still align. Returns one value per asset point (null where SPY is missing).
 */
export function spyBenchmarkSeries(
  data: HistoricalPoint[],
  spy: HistoricalPoint[],
): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length === 0 || spy.length === 0) return result;
  const assetBase = data[0]?.close;
  if (!assetBase || assetBase <= 0) return result;

  const spySorted = spy
    .filter(p => p.close != null && p.close > 0 && isFinite(p.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (spySorted.length === 0) return result;

  const valAtOrBefore = (date: string): number => {
    let lo = 0, hi = spySorted.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spySorted[mid].date <= date) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return spySorted[ans >= 0 ? ans : 0].close;
  };

  const spyBase = valAtOrBefore(data[0].date);
  if (!spyBase || spyBase <= 0) return result;

  for (let i = 0; i < data.length; i++) {
    const sv = valAtOrBefore(data[i].date);
    result[i] = assetBase * (sv / spyBase);
  }
  return result;
}

export function averageRate(data: { date: string; rate: number }[]): number {
  if (!data.length) return 0;
  return data.reduce((sum, d) => sum + d.rate, 0) / data.length;
}

/**
 * Remove consecutive data points with the same value, keeping only the first
 * occurrence of each distinct value. Used for step-function series (interest
 * rates, central bank rates) so the chart shows when the value actually changed
 * rather than plotting a daily "no change" point for every business day.
 * Always keeps the first and last points.
 */
export function dedupStepSeries(data: HistoricalPoint[]): HistoricalPoint[] {
  if (data.length <= 1) return data;
  const out: HistoricalPoint[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    if (data[i].close !== out[out.length - 1].close) {
      out.push(data[i]);
    }
  }
  // Always include the last point (most recent "current" value)
  if (out[out.length - 1] !== data[data.length - 1]) {
    out.push(data[data.length - 1]);
  }
  return out;
}

/**
 * Append a synthetic data point at today's date with the last known value, IF
 * the last observation is older than today. Used so the chart line extends all
 * the way to "now" — visually communicating "this value is still current as of
 * today" rather than letting the line end abruptly at the last update date
 * (which a viewer might misread as a sudden drop or "data collapsing").
 *
 * Example: Fed Funds Rate last changed 2025-12-18 at 4.25%. Without this, the
 * chart line ends at 2025-12-18; with it, the line extends horizontally to
 * today at 4.25%, clearly showing "still 4.25% as of today".
 */
export function extendToToday(data: HistoricalPoint[]): HistoricalPoint[] {
  if (!data.length) return data;
  const today = new Date().toISOString().slice(0, 10);
  const last = data[data.length - 1];
  if (last.date >= today) return data;
  return [...data, { date: today, close: last.close }];
}

export function colorForPercent(value: number): string {
  return value >= 0 ? 'text-up-text' : 'text-down-text';
}

export function bgColorForPercent(value: number): string {
  return value >= 0 ? 'bg-up-dim' : 'bg-down-dim';
}

export const CHART_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
  '#14b8a6', '#84cc16',
];

// ---------- Dividend & total-return helpers ----------
export interface DividendEvent { date: string; amount: number }

/**
 * Build a "total return" price series by reinvesting dividends. The result is
 * priced in the same units as the underlying close, and the first point keeps
 * its original close. Each dividend on ex-date D is mapped to the last price
 * bar whose date is <= D (handles monthly bars where the ex-date falls between
 * bars). The factor is applied after that bar so the next bar reflects
 * reinvestment without a same-day jump.
 */
export function buildTotalReturnSeries(
  prices: HistoricalPoint[],
  dividends: DividendEvent[],
): HistoricalPoint[] {
  if (!prices.length) return [];
  if (!dividends.length) return prices.slice();

  // Map each dividend to the index of the last price bar on or before its date.
  // This works for both daily and monthly price series.
  const divAtIndex = new Map<number, number>();
  for (const d of [...dividends].sort((a, b) => a.date.localeCompare(b.date))) {
    let idx = -1;
    for (let i = prices.length - 1; i >= 0; i--) {
      if (prices[i].date <= d.date) { idx = i; break; }
    }
    if (idx === -1) continue;
    divAtIndex.set(idx, (divAtIndex.get(idx) ?? 0) + d.amount);
  }

  let factor = 1;
  const out: HistoricalPoint[] = [];
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    out.push({ date: p.date, close: p.close * factor });
    const div = divAtIndex.get(i);
    if (div && p.close > 0) {
      factor *= 1 + div / p.close;
    }
  }
  return out;
}

/**
 * Internal Rate of Return given dated cashflows. Cashflows are signed: an
 * initial investment is negative, dividends and a terminal sale are positive.
 * Returns the annualized rate (decimal, e.g. 0.085 = 8.5%) or null if no root
 * is found within plausible bounds.
 */
export function computeIRR(
  cashflows: { date: string; amount: number }[],
  guess = 0.08,
): number | null {
  if (cashflows.length < 2) return null;
  const t0 = new Date(cashflows[0].date).getTime();
  const years = cashflows.map(cf => (new Date(cf.date).getTime() - t0) / (365.25 * 86400 * 1000));

  const npv = (rate: number) => {
    let s = 0;
    for (let i = 0; i < cashflows.length; i++) {
      s += cashflows[i].amount / Math.pow(1 + rate, years[i]);
    }
    return s;
  };
  const dnpv = (rate: number) => {
    let s = 0;
    for (let i = 0; i < cashflows.length; i++) {
      s -= years[i] * cashflows[i].amount / Math.pow(1 + rate, years[i] + 1);
    }
    return s;
  };

  // Newton-Raphson with bounded fallback
  let rate = guess;
  for (let i = 0; i < 60; i++) {
    const f = npv(rate);
    const fp = dnpv(rate);
    if (!isFinite(f) || !isFinite(fp) || Math.abs(fp) < 1e-12) break;
    const next = rate - f / fp;
    if (!isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
    if (rate < -0.999) rate = -0.999;
    if (rate > 100) rate = 100;
  }

  // Bisection fallback over [-0.99, 10]
  let lo = -0.99, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (Math.abs(fmid) < 1e-7 || (hi - lo) < 1e-7) return mid;
    if (flo * fmid < 0) { hi = mid; fhi = fmid; }
    else { lo = mid; flo = fmid; }
  }
  return (lo + hi) / 2;
}

/**
 * IRR for a buy-and-hold investment in a single asset, accounting for
 * dividends as cash received (not reinvested).
 *   t0:  -close[0]
 *   ti:   +dividend_i (any dividend with date > t0 and <= tN)
 *   tN:   +close[N-1]
 */
export function computeAssetIRR(
  prices: HistoricalPoint[],
  dividends: DividendEvent[],
): number | null {
  if (!prices || prices.length < 2) return null;
  const start = prices[0];
  const end = prices[prices.length - 1];
  if (!start.close || !end.close) return null;
  const flows: { date: string; amount: number }[] = [{ date: start.date, amount: -start.close }];
  for (const d of dividends) {
    if (d.date > start.date && d.date <= end.date && d.amount > 0) {
      flows.push({ date: d.date, amount: d.amount });
    }
  }
  flows.push({ date: end.date, amount: end.close });
  return computeIRR(flows);
}

/**
 * Pearson correlation of two aligned arrays of numbers.
 */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/**
 * Convert values to ranks (1..n), with average ranks for ties. Used by Spearman.
 */
function ranks(values: number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const r = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based, average over tie group
    for (let k = i; k <= j; k++) r[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return r;
}

/**
 * Spearman rank correlation: Pearson on ranks. Robust to outliers because a
 * single extreme value (e.g. COVID rate crash) only contributes its rank,
 * not its squared deviation. Good for monotone but non-linear relationships.
 */
export function spearman(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  return pearson(ranks(a.slice(0, n)), ranks(b.slice(0, n)));
}

/**
 * Correlation matrix across multiple price series using Spearman rank
 * correlation on the actual values (levels).
 *
 * Alignment: detect the coarsest cadence across all series (daily/weekly/monthly),
 * bucket every date to that cadence, then build the union of all periods and
 * carry the last known value forward (LOCF) for series that did not update in
 * a given period (e.g. a central bank rate that stays unchanged for months).
 * Only periods after the first observation of EVERY series are included.
 */
export interface CorrAlignedRow { period: string; values: number[] }

export function correlationMatrix(
  series: { symbol: string; data: HistoricalPoint[] }[],
): { labels: string[]; matrix: (number | null)[][]; sampleCount: number; alignedData: CorrAlignedRow[] } {
  const labels = series.map(s => s.symbol);
  const empty = { labels, matrix: [] as (number | null)[][], sampleCount: 0, alignedData: [] as CorrAlignedRow[] };
  if (series.length === 0) return empty;

  // ── Cadence detection ─────────────────────────────────────────────────────
  function medianSpacingDays(data: HistoricalPoint[]): number {
    if (data.length < 3) return 1;
    const diffs: number[] = [];
    for (let i = 1; i < Math.min(data.length, 40); i++) {
      const ms = new Date(data[i].date).getTime() - new Date(data[i - 1].date).getTime();
      diffs.push(ms / 86_400_000);
    }
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)];
  }
  function toCadence(med: number): 'D' | 'W' | 'M' {
    return med <= 3 ? 'D' : med <= 10 ? 'W' : 'M';
  }
  const cadenceOrder = { D: 0, W: 1, M: 2 };
  const cadence: 'D' | 'W' | 'M' = series
    .map(s => toCadence(medianSpacingDays(s.data)))
    .reduce((coarsest, c) => cadenceOrder[c] > cadenceOrder[coarsest] ? c : coarsest, 'D' as 'D' | 'W' | 'M');

  // ── Bucket key ────────────────────────────────────────────────────────────
  function bucketKey(date: string): string {
    if (cadence === 'M') return date.slice(0, 7);
    if (cadence === 'W') {
      const d = new Date(date + 'T12:00:00Z');
      const day = d.getUTCDay();
      const offset = day === 0 ? 6 : day - 1;
      const mon = new Date(d.getTime() - offset * 86_400_000);
      return mon.toISOString().slice(0, 10);
    }
    return date;
  }

  // ── Per-series bucket maps (last close wins within a bucket) ──────────────
  const bucketMaps: Map<string, number>[] = series.map(s => {
    const m = new Map<string, number>();
    for (const p of s.data) m.set(bucketKey(p.date), p.close);
    return m;
  });

  // ── Union of all bucket keys, sorted ascending ────────────────────────────
  const allKeys = Array.from(
    new Set(bucketMaps.flatMap(m => Array.from(m.keys())))
  ).sort();

  // ── LOCF-fill each series across the full union ───────────────────────────
  // For series like the Fed Funds Rate that only has data on meeting dates,
  // every subsequent period carries the last known rate until the next change.
  const filled: Map<string, number>[] = bucketMaps.map(m => {
    const out = new Map<string, number>();
    let last: number | undefined;
    for (const k of allKeys) {
      if (m.has(k)) last = m.get(k)!;
      if (last !== undefined) out.set(k, last);
    }
    return out;
  });

  // ── Keep only periods where ALL series have reached their first observation ─
  const validKeys = allKeys.filter(k => filled.every(m => m.has(k)));

  if (validKeys.length < 3) {
    return { labels, matrix: labels.map(() => labels.map(() => null)), sampleCount: 0, alignedData: [] };
  }

  // ── Aligned value arrays, then drop any row with invalid/non-positive value ─
  const aligned: number[][] = filled.map(m => validKeys.map(k => m.get(k)!));
  const validIdx: number[] = [];
  for (let i = 0; i < aligned[0].length; i++) {
    if (aligned.every(r => isFinite(r[i]) && r[i] > 0)) validIdx.push(i);
  }
  const cleaned: number[][] = aligned.map(r => validIdx.map(i => r[i]));
  const sampleCount = validIdx.length;

  // ── Aligned data rows for user inspection ─────────────────────────────────
  const alignedData: CorrAlignedRow[] = validIdx.map((ki, i) => ({
    period: validKeys[ki],
    values: cleaned.map(c => c[i]),
  }));

  // ── Spearman rank correlation on values ───────────────────────────────────
  const matrix: (number | null)[][] = labels.map(() => labels.map(() => null));
  for (let i = 0; i < labels.length; i++) {
    for (let j = i; j < labels.length; j++) {
      const c = i === j ? 1 : spearman(cleaned[i], cleaned[j]);
      matrix[i][j] = c;
      matrix[j][i] = c;
    }
  }
  return { labels, matrix, sampleCount, alignedData };
}

export function timeframeLabel(tf: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    '1D': '1 Day', '1W': '1 Week', 'MTD': 'Month to Date', '1M': '1 Month', '3M': '3 Months',
    '6M': '6 Months', 'YTD': 'Year to Date', '1Y': '1 Year',
    '3Y': '3 Years', '5Y': '5 Years', '10Y': '10 Years', 'MAX': 'Max',
  };
  return labels[tf] ?? tf;
}

/**
 * Returns a short notice when the data returned for a timeframe starts
 * significantly later than requested. Returns null for MAX or when the gap
 * is ≤30 days (weekends/holidays/data warmup are normal).
 */
export function dataAvailabilityMessage(
  data: HistoricalPoint[],
  timeframe: Timeframe,
): string | null {
  if (timeframe === 'MAX' || data.length < 2) return null;
  const expectedStart = getTimeframeStart(timeframe);
  const actualStart = data[0].date;
  const gapDays = (new Date(actualStart).getTime() - new Date(expectedStart).getTime()) / 86_400_000;
  if (gapDays <= 30) return null;
  const d = new Date(actualStart + 'T12:00:00Z');
  const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `Data available from ${label}`;
}
