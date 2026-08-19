import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { fetchStooqDaily } from '@/lib/stooq';
import { subDays, subWeeks, subMonths, subYears, startOfYear, startOfMonth } from 'date-fns';
import { LEAD_IN_DAYS, calendarBoundary, anchorSeries } from '@/lib/windows';

export const runtime = 'edge';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 5 * 60_000;

function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}

function getStartDate(timeframe: string): Date {
  const now = new Date();
  switch (timeframe) {
    case '1D':  return subDays(now, 4);
    case '1W':  return subWeeks(now, 1);
    case 'MTD': return startOfMonth(now);
    case '1M':  return subMonths(now, 1);
    case '3M':  return subMonths(now, 3);
    case '6M':  return subMonths(now, 6);
    case 'YTD': return startOfYear(now);
    case '1Y':  return subYears(now, 1);
    case '3Y':  return subYears(now, 3);
    case '5Y':  return subYears(now, 5);
    case '10Y': return subYears(now, 10);
    case 'MAX': return new Date('1900-01-01');
    default:    return subYears(now, 1);
  }
}

function getInterval(_timeframe: string): '1d' | '1wk' | '1mo' {
  // Always daily — never reduce or thin data regardless of timeframe.
  return '1d';
}

function toStooqInterval(interval: '1d' | '1wk' | '1mo'): 'd' | 'w' | 'm' {
  if (interval === '1wk') return 'w';
  if (interval === '1mo') return 'm';
  return 'd';
}

export async function GET(req: NextRequest) {
  const symbol    = req.nextUrl.searchParams.get('symbol');
  const timeframe = req.nextUrl.searchParams.get('timeframe') ?? '1Y';
  const fromParam = req.nextUrl.searchParams.get('from');
  const toParam   = req.nextUrl.searchParams.get('to');
  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  const isCustom = !!(fromParam && toParam);
  const key = isCustom ? `${symbol}:${fromParam}:${toParam}` : `${symbol}:${timeframe}`;
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  // YTD and MTD are measured from the last close BEFORE the period began, so a lead-in is
  // fetched and the series trimmed back to that close (see lib/windows.ts). A custom range
  // is left alone: the user named its start, and quietly reaching behind it would return a
  // different range from the one they asked for.
  const boundary = isCustom ? null : calendarBoundary(timeframe, new Date());
  const from = isCustom ? new Date(fromParam!)
    : boundary ? subDays(getStartDate(timeframe), LEAD_IN_DAYS)
    : getStartDate(timeframe);
  const to   = isCustom ? new Date(toParam!) : new Date();
  // Always daily — never reduce or thin data for any timeframe or custom range.
  const interval: '1d' | '1wk' | '1mo' = '1d';

  // "1D" is fetched a few days wide so a line can always be drawn (weekends), but
  // it should SHOW only the most recent day (previous close → latest). Keep the
  // last 2 daily bars for 1D so the chart doesn't span several days.
  const trim1D = (d: { date: string; close: number }[]) =>
    timeframe === '1D' && !isCustom && d.length > 2 ? d.slice(-2) : d;
  const clipWindow = (d: { date: string; close: number }[]) =>
    trim1D(boundary ? anchorSeries(d, boundary) : d);

  try {
    let data = await fetchYahooChart(symbol, from, to, interval);

    // Stooq fallback if Yahoo returns nothing
    if (data.length === 0) {
      data = await fetchStooqDaily(symbol, from, to, toStooqInterval(interval));
    }

    data = clipWindow(data);
    cache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    console.error('historical error', symbol, err);
    // Last-resort Stooq attempt even on exception
    try {
      const data = clipWindow(await fetchStooqDaily(symbol, from, to, toStooqInterval(interval)));
      cache.set(key, { data, ts: Date.now() });
      return NextResponse.json(data);
    } catch {
      return NextResponse.json([], { status: 200 });
    }
  }
}
