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
 * Pearson correlation matrix of log-returns across multiple price series.
 *
 * Alignment: we intersect the actual trading dates of all series (no
 * forward-fill). Forward-filling missing dates injects spurious zero-return
 * bars (e.g. equities on weekends while crypto trades), which biases the
 * correlation toward zero. By taking only dates where every series has a
 * real observation, every return reflects a real price move on both sides.
 */
export function correlationMatrix(
  series: { symbol: string; data: HistoricalPoint[] }[],
): { labels: string[]; matrix: (number | null)[][] } {
  const labels = series.map(s => s.symbol);
  if (series.length === 0) return { labels, matrix: [] };

  // Intersect dates: keep only dates present in every series.
  const dateSets = series.map(s => new Set(s.data.map(d => d.date)));
  const baseDates = series[0].data.map(d => d.date);
  const commonDates = baseDates
    .filter(d => dateSets.every(set => set.has(d)))
    .sort();

  // Sample each series at the intersected dates.
  const aligned: number[][] = series.map(s => {
    const map = new Map(s.data.map(d => [d.date, d.close] as const));
    return commonDates.map(d => map.get(d) ?? NaN);
  });

  // Log returns between consecutive intersected observations.
  const returns: number[][] = aligned.map(arr => {
    const r: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i];
      r.push(a > 0 && b > 0 && isFinite(a) && isFinite(b) ? Math.log(b / a) : NaN);
    }
    return r;
  });

  // Drop any index where any series produced a non-finite return.
  const len = returns[0]?.length ?? 0;
  const validIdx: number[] = [];
  for (let i = 0; i < len; i++) {
    if (returns.every(r => isFinite(r[i]))) validIdx.push(i);
  }
  const cleaned = returns.map(r => validIdx.map(i => r[i]));

  const matrix: (number | null)[][] = labels.map(() => labels.map(() => null));
  for (let i = 0; i < labels.length; i++) {
    for (let j = i; j < labels.length; j++) {
      const c = i === j ? 1 : pearson(cleaned[i], cleaned[j]);
      matrix[i][j] = c;
      matrix[j][i] = c;
    }
  }
  return { labels, matrix };
}

export function timeframeLabel(tf: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    '1W': '1 Week', '1M': '1 Month', '3M': '3 Months',
    '6M': '6 Months', 'YTD': 'Year to Date', '1Y': '1 Year',
    '3Y': '3 Years', '5Y': '5 Years', '10Y': '10 Years', 'MAX': 'Max',
  };
  return labels[tf] ?? tf;
}
