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
    case '10Y': return '1mo';
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
  const base = data[0].close;
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

export function timeframeLabel(tf: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    '1W': '1 Week', '1M': '1 Month', '3M': '3 Months',
    '6M': '6 Months', 'YTD': 'Year to Date', '1Y': '1 Year',
    '3Y': '3 Years', '5Y': '5 Years', '10Y': '10 Years',
  };
  return labels[tf] ?? tf;
}
