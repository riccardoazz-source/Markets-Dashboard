import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { startOfYear, subMonths, subYears, subWeeks } from 'date-fns';

const yahooFinance = new YahooFinance();

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

async function getReturn(symbol: string, period1: Date): Promise<number | null> {
  try {
    const p1 = Math.floor(period1.getTime() / 1000);
    const p2 = Math.floor(Date.now() / 1000);
    const data = await fetchYahooChart(symbol, p1, p2, '1d');
    if (data.length < 2) return null;
    const start = data[0].close;
    const end = data[data.length - 1].close;
    return ((end - start) / start) * 100;
  } catch {
    return null;
  }
}

async function getCAGR(symbol: string, years: number): Promise<number | null> {
  try {
    const period1 = Math.floor(subYears(new Date(), years).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const data = await fetchYahooChart(symbol, period1, period2, '1mo');
    if (data.length < 2) return null;
    const start = data[0].close;
    const end = data[data.length - 1].close;
    const actualYears = data.length / 12;
    return (Math.pow(end / start, 1 / actualYears) - 1) * 100;
  } catch {
    return null;
  }
}

export async function GET() {
  const cached = getCached('sectors');
  if (cached) return NextResponse.json(cached);

  const now = new Date();
  const ytdStart = startOfYear(now);
  const oneMonthStart = subMonths(now, 1);
  const threeMonthStart = subMonths(now, 3);
  const oneWeekStart = subWeeks(now, 1);

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
