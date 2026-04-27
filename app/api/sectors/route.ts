import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';
import { SECTORS } from '@/lib/config';
import { format, startOfYear, subMonths, subYears, subWeeks } from 'date-fns';

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

async function getReturn(symbol: string, period1: string): Promise<number | null> {
  try {
    const rows = await yahooFinance.historical(
      symbol,
      { period1, period2: format(new Date(), 'yyyy-MM-dd'), interval: '1d' },
      { validateResult: false }
    );
    if (!rows || rows.length < 2) return null;
    const start = rows[0].close;
    const end = rows[rows.length - 1].close;
    return ((end - start) / start) * 100;
  } catch {
    return null;
  }
}

async function getCAGR(symbol: string, years: number): Promise<number | null> {
  try {
    const period1 = format(subYears(new Date(), years), 'yyyy-MM-dd');
    const rows = await yahooFinance.historical(
      symbol,
      { period1, period2: format(new Date(), 'yyyy-MM-dd'), interval: '1mo' },
      { validateResult: false }
    );
    if (!rows || rows.length < 2) return null;
    const start = rows[0].close;
    const end = rows[rows.length - 1].close;
    const actualYears = rows.length / 12;
    return (Math.pow(end / start, 1 / actualYears) - 1) * 100;
  } catch {
    return null;
  }
}

export async function GET() {
  const cached = getCached('sectors');
  if (cached) return NextResponse.json(cached);

  const now = new Date();
  const ytdStart = format(startOfYear(now), 'yyyy-MM-dd');
  const oneMonthStart = format(subMonths(now, 1), 'yyyy-MM-dd');
  const threeMonthStart = format(subMonths(now, 3), 'yyyy-MM-dd');
  const oneWeekStart = format(subWeeks(now, 1), 'yyyy-MM-dd');

  try {
    const symbols = SECTORS.map(s => s.symbol);

    const quotes = await Promise.allSettled(
      symbols.map(s =>
        yahooFinance.quote(s, {}, { validateResult: false }).catch(() => null)
      )
    );

    const returns = await Promise.allSettled(
      symbols.flatMap(s => [
        getReturn(s, ytdStart),
        getReturn(s, oneMonthStart),
        getReturn(s, threeMonthStart),
        getReturn(s, oneWeekStart),
        getCAGR(s, 3),
        getCAGR(s, 5),
      ])
    );

    const data = SECTORS.map((sector, i) => {
      const q = quotes[i].status === 'fulfilled' ? quotes[i].value : null;
      const qi = i * 6;
      const ytdReturn = returns[qi]?.status === 'fulfilled' ? (returns[qi] as PromiseFulfilledResult<number|null>).value : null;
      const oneMonthReturn = returns[qi + 1]?.status === 'fulfilled' ? (returns[qi + 1] as PromiseFulfilledResult<number|null>).value : null;
      const threeMonthReturn = returns[qi + 2]?.status === 'fulfilled' ? (returns[qi + 2] as PromiseFulfilledResult<number|null>).value : null;
      const oneWeekReturn = returns[qi + 3]?.status === 'fulfilled' ? (returns[qi + 3] as PromiseFulfilledResult<number|null>).value : null;
      const cagr3y = returns[qi + 4]?.status === 'fulfilled' ? (returns[qi + 4] as PromiseFulfilledResult<number|null>).value : null;
      const cagr5y = returns[qi + 5]?.status === 'fulfilled' ? (returns[qi + 5] as PromiseFulfilledResult<number|null>).value : null;

      const qv = q as Record<string, unknown> | null;
      return {
        symbol: sector.symbol,
        name: sector.name,
        category: sector.category,
        price: qv?.regularMarketPrice ?? null,
        changePercent: qv?.regularMarketChangePercent ?? null,
        ytdReturn,
        oneMonthReturn,
        threeMonthReturn,
        oneWeekReturn,
        cagr3y,
        cagr5y,
      };
    });

    const sorted = [...data].sort((a, b) => (b.ytdReturn ?? -Infinity) - (a.ytdReturn ?? -Infinity))
      .map((s, i) => ({ ...s, rank: i + 1 }));

    setCached('sectors', sorted);
    return NextResponse.json(sorted);
  } catch (err) {
    console.error('sectors error', err);
    return NextResponse.json({ error: 'Failed to fetch sectors' }, { status: 500 });
  }
}
