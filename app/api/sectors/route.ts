import { NextResponse } from 'next/server';
import { SECTORS } from '@/lib/config';
import { fetchYahooQuotes } from '@/lib/yahoo';

export const runtime = 'edge';

interface CacheEntry { data: unknown[]; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH = 60_000;
const STALE = 30 * 60_000;

export async function GET() {
  const entry = cache.get('sectors');
  if (entry && Date.now() - entry.ts < FRESH) return NextResponse.json(entry.data);

  try {
    const symbols = SECTORS.map(s => s.symbol);
    const quotes = await fetchYahooQuotes(symbols);

    if (quotes.length === 0) {
      if (entry && Date.now() - entry.ts < STALE) return NextResponse.json(entry.data);
      // Return skeleton list so the UI always renders every sector
      return NextResponse.json(
        SECTORS.map((s, i) => ({
          symbol: s.symbol, name: s.name, category: s.category,
          price: null, changePercent: null, oneYearReturn: null, ytdReturn: null, mtdReturn: null, fiveYearReturn: null,
          high52w: null, low52w: null, dividendYield: null, rank: i + 1,
        }))
      );
    }

    const data = SECTORS.map(s => {
      const q = quotes.find(qq => qq.symbol === s.symbol);
      return {
        symbol: s.symbol,
        name: s.name,
        category: s.category,
        price: q?.price ?? null,
        changePercent: q?.changePercent ?? null,
        oneYearReturn: q?.fiftyTwoWeekChangePercent ?? null,
        ytdReturn: q?.ytdChangePercent ?? null,
        mtdReturn: q?.mtdChangePercent ?? null,
        fiveYearReturn: q?.fiveYearChangePercent ?? null,
        high52w: q?.high52w ?? null,
        low52w: q?.low52w ?? null,
        dividendYield: q?.dividendYield ?? null,
        currency: q?.currency ?? 'USD',
      };
    });

    const sorted = [...data]
      .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
      .map((s, i) => ({ ...s, rank: i + 1 }));

    cache.set('sectors', { data: sorted, ts: Date.now() });
    return NextResponse.json(sorted);
  } catch (err) {
    console.error('sectors error', err);
    if (entry && Date.now() - entry.ts < STALE) return NextResponse.json(entry.data);
    return NextResponse.json(
      SECTORS.map((s, i) => ({
        symbol: s.symbol, name: s.name, category: s.category,
        price: null, changePercent: null, oneYearReturn: null, ytdReturn: null, mtdReturn: null, fiveYearReturn: null,
        high52w: null, low52w: null, rank: i + 1,
      }))
    );
  }
}
