import { NextRequest, NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';
import { format, subWeeks, subMonths, subYears, startOfYear } from 'date-fns';

yahooFinance.setGlobalConfig({ validation: { logErrors: false } });

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

function getStartDate(timeframe: string): string {
  const now = new Date();
  switch (timeframe) {
    case '1W':  return format(subWeeks(now, 1), 'yyyy-MM-dd');
    case '1M':  return format(subMonths(now, 1), 'yyyy-MM-dd');
    case '3M':  return format(subMonths(now, 3), 'yyyy-MM-dd');
    case '6M':  return format(subMonths(now, 6), 'yyyy-MM-dd');
    case 'YTD': return format(startOfYear(now), 'yyyy-MM-dd');
    case '1Y':  return format(subYears(now, 1), 'yyyy-MM-dd');
    case '3Y':  return format(subYears(now, 3), 'yyyy-MM-dd');
    case '5Y':  return format(subYears(now, 5), 'yyyy-MM-dd');
    case '10Y': return format(subYears(now, 10), 'yyyy-MM-dd');
    default:    return format(subYears(now, 1), 'yyyy-MM-dd');
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

  const period1 = getStartDate(timeframe);
  const period2 = format(new Date(), 'yyyy-MM-dd');
  const interval = getInterval(timeframe);

  try {
    const rows = await yahooFinance.historical(
      symbol,
      { period1, period2, interval },
      { validateResult: false }
    );

    const data = rows
      .filter(r => r.close != null)
      .map(r => ({
        date: format(new Date(r.date), 'yyyy-MM-dd'),
        close: r.close,
      }));

    setCached(key, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('historical error', symbol, err);
    return NextResponse.json({ error: 'Failed to fetch historical data' }, { status: 500 });
  }
}
