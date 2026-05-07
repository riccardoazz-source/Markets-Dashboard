import { Timeframe, HistoricalPoint, CAGRData } from './types';
import { format, subWeeks, subMonths, subYears, startOfYear } from 'date-fns';

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
    case '1W': date = subWeeks(now, 1); break;
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
    case '1W':
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
  // Use the first positive finite value as the base to avoid Infinity/NaN
  // when the opening price is 0 or invalid (e.g. CoinGecko placeholder rows).
  const basePoint = data.find(d => d.close > 0 && isFinite(d.close));
  if (!basePoint) return data.slice();
  const base = basePoint.close;
  return data.map(d => ({ ...d, close: (d.close / base) * 100 }));
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
 * Correlation matrix across multiple price series.
 *
 * mode='returns': Pearson on log-returns — period-to-period return co-movement.
 *   Statistically rigorous but a single extreme outlier (e.g. COVID crash)
 *   can dominate.
 *
 * mode='levels': Pearson on normalized levels (base 100 at common start) —
 *   the visual up/down relationship the eye sees. Intuitive but technically
 *   a spurious-regression risk for non-stationary series.
 *
 * mode='spearman' (default): Spearman rank correlation on levels — robust
 *   to outliers, captures monotone relationships. Closest to "does asset A
 *   tend to be high when asset B is low?" without being skewed by extremes.
 *
 * Alignment for all modes:
 * - Detect coarsest cadence across all series (daily / weekly / monthly).
 * - Convert every date to a canonical bucket key.
 * - Intersect bucket keys present in ALL series.
 */
export function correlationMatrix(
  series: { symbol: string; data: HistoricalPoint[] }[],
  mode: 'returns' | 'levels' | 'spearman' = 'spearman',
): { labels: string[]; matrix: (number | null)[][]; sampleCount: number } {
  const labels = series.map(s => s.symbol);
  if (series.length === 0) return { labels, matrix: [], sampleCount: 0 };

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
  // Use the COARSEST cadence across all series. If one series has monthly
  // bars (e.g. AGNC at MAX timeframe) and another has daily bars (DFF),
  // using daily cadence gives near-zero exact-date intersection; monthly
  // bucketing collapses both to YYYY-MM and gives ~200 common points.
  function toCadence(med: number): 'D' | 'W' | 'M' {
    return med <= 3 ? 'D' : med <= 10 ? 'W' : 'M';
  }
  const cadenceOrder = { D: 0, W: 1, M: 2 };
  const cadence: 'D' | 'W' | 'M' = series
    .map(s => toCadence(medianSpacingDays(s.data)))
    .reduce((coarsest, c) => cadenceOrder[c] > cadenceOrder[coarsest] ? c : coarsest, 'D' as 'D' | 'W' | 'M');

  // ── Bucket key ────────────────────────────────────────────────────────────
  function bucketKey(date: string): string {
    if (cadence === 'M') return date.slice(0, 7); // "YYYY-MM"
    if (cadence === 'W') {
      const d = new Date(date + 'T12:00:00Z');
      const day = d.getUTCDay(); // 0=Sun … 6=Sat
      const offset = day === 0 ? 6 : day - 1; // days back to Monday
      const mon = new Date(d.getTime() - offset * 86_400_000);
      return mon.toISOString().slice(0, 10);
    }
    return date;
  }

  // ── Per-series bucket maps (last close wins within a bucket) ──────────────
  const bucketMaps: Map<string, number>[] = series.map(s => {
    const m = new Map<string, number>();
    for (const p of s.data) m.set(bucketKey(p.date), p.close); // sorted → last wins
    return m;
  });

  // ── Intersect bucket keys present in ALL series ───────────────────────────
  const allKeys = Array.from(bucketMaps[0].keys());
  const commonKeys = allKeys
    .filter(k => bucketMaps.every(m => m.has(k)))
    .sort();

  if (commonKeys.length < 3) {
    return { labels, matrix: labels.map(() => labels.map(() => null)), sampleCount: 0 };
  }

  // ── Aligned price arrays ───────────────────────────────────────────────────
  const aligned: number[][] = bucketMaps.map(m => commonKeys.map(k => m.get(k)!));

  let cleaned: number[][];
  let sampleCount: number;

  if (mode === 'returns') {
    // Log-returns: drop first point, compute differences
    const returns: number[][] = aligned.map(arr => {
      const r: number[] = [];
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i];
        r.push(a > 0 && b > 0 ? Math.log(b / a) : NaN);
      }
      return r;
    });
    const validIdx: number[] = [];
    for (let i = 0; i < (returns[0]?.length ?? 0); i++) {
      if (returns.every(r => isFinite(r[i]))) validIdx.push(i);
    }
    cleaned = returns.map(r => validIdx.map(i => r[i]));
    sampleCount = validIdx.length;
  } else {
    // 'levels' and 'spearman' both use levels (normalized for display, but
    // Pearson is scale-invariant so result is identical to raw levels).
    const validIdx: number[] = [];
    for (let i = 0; i < aligned[0].length; i++) {
      if (aligned.every(r => isFinite(r[i]) && r[i] > 0)) validIdx.push(i);
    }
    cleaned = aligned.map(r => validIdx.map(i => r[i]));
    sampleCount = validIdx.length;
  }

  const corrFn = mode === 'spearman' ? spearman : pearson;
  const matrix: (number | null)[][] = labels.map(() => labels.map(() => null));
  for (let i = 0; i < labels.length; i++) {
    for (let j = i; j < labels.length; j++) {
      const c = i === j ? 1 : corrFn(cleaned[i], cleaned[j]);
      matrix[i][j] = c;
      matrix[j][i] = c;
    }
  }
  return { labels, matrix, sampleCount };
}

export function timeframeLabel(tf: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    '1W': '1 Week', '1M': '1 Month', '3M': '3 Months',
    '6M': '6 Months', 'YTD': 'Year to Date', '1Y': '1 Year',
    '3Y': '3 Years', '5Y': '5 Years', '10Y': '10 Years', 'MAX': 'Max',
  };
  return labels[tf] ?? tf;
}
