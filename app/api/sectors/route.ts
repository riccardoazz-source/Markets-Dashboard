import { NextResponse } from 'next/server';
import { SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { returnSince, cagrFromPoints } from '@/lib/stooq';
import { format, startOfYear, subMonths, subWeeks, subYears } from 'date-fns';

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

async function fetchSector(symbol: string, name: string, category: string) {
  const empty = {
    symbol, name, category,
    price: null, changePercent: null,
    ytdReturn: null, oneMonthReturn: null, threeMonthReturn: null,
    oneWeekReturn: null, cagr3y: null, cagr5y: null,
  };

  const now = new Date();
  const points = await fetchYahooChart(symbol, subYears(now, 5), now, '1d');
  if (points.length < 2) return empty;

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const price = last.close;
  const changePercent = prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  const ytdReturn = returnSince(points, format(startOfYear(now), 'yyyy-MM-dd'));
  const oneMonthReturn = returnSince(points, format(subMonths(now, 1), 'yyyy-MM-dd'));
  const threeMonthReturn = returnSince(points, format(subMonths(now, 3), 'yyyy-MM-dd'));
  const oneWeekReturn = returnSince(points, format(subWeeks(now, 1), 'yyyy-MM-dd'));

  const threeYearPoints = points.filter(p => p.date >= format(subYears(now, 3), 'yyyy-MM-dd'));
  const cagr3y = cagrFromPoints(threeYearPoints, 3);

  const fiveYearSpan =
    (new Date(last.date).getTime() - new Date(points[0].date).getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);
  const cagr5y = cagrFromPoints(points, fiveYearSpan);

  return {
    symbol, name, category,
    price, changePercent,
    ytdReturn, oneMonthReturn, threeMonthReturn, oneWeekReturn,
    cagr3y, cagr5y,
  };
}

export async function GET() {
  const cached = getCached('sectors');
  if (cached) return NextResponse.json(cached);

  try {
    const data = await Promise.all(
      SECTORS.map(s => fetchSector(s.symbol, s.name, s.category))
    );

    const sorted = [...data]
      .sort((a, b) => (b.ytdReturn ?? -Infinity) - (a.ytdReturn ?? -Infinity))
      .map((s, i) => ({ ...s, rank: i + 1 }));

    setCached('sectors', sorted);
    return NextResponse.json(sorted);
  } catch (err) {
    console.error('sectors error', err);
    return NextResponse.json({ error: 'Failed to fetch sectors' }, { status: 500 });
  }
}
