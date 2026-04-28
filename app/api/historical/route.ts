import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { subWeeks, subMonths, subYears, startOfYear } from 'date-fns';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 5 * 60_000;

function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}
function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

function getStartDate(timeframe: string): Date {
  const now = new Date();
  switch (timeframe) {
    case '1W':  return subWeeks(now, 1);
    case '1M':  return subMonths(now, 1);
    case '3M':  return subMonths(now, 3);
    case '6M':  return subMonths(now, 6);
    case 'YTD': return startOfYear(now);
    case '1Y':  return subYears(now, 1);
    case '3Y':  return subYears(now, 3);
    case '5Y':  return subYears(now, 5);
    case '10Y': return subYears(now, 10);
    default:    return subYears(now, 1);
  }
}

function getInterval(timeframe: string): '1d' | '1wk' | '1mo' {
  if (['1W', '1M', '3M', '6M', 'YTD', '1Y'].includes(timeframe)) return '1d';
  if (['3Y', '5Y'].includes(timeframe)) return '1wk';
  return '1mo';
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  const timeframe = req.nextUrl.searchParams.get('timeframe') ?? '1Y';

  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  const key = `${symbol}:${timeframe}`;
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  try {
    const data = await fetchYahooChart(
      symbol,
      getStartDate(timeframe),
      new Date(),
      getInterval(timeframe),
    );
    setCached(key, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('historical error', symbol, err);
    return NextResponse.json([], { status: 200 });
  }
}
