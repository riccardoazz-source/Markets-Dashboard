import { NextResponse } from 'next/server';
import { SECTORS } from '@/lib/config';
import { fetchYahooQuotes } from '@/lib/yahoo';

interface CacheEntry { data: unknown[]; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH_TTL = 60_000;
const STALE_TTL = 30 * 60_000;

export async function GET() {
  const entry = cache.get('sectors');
  if (entry && Date.now() - entry.ts < FRESH_TTL) {
    return NextResponse.json(entry.data);
  }

  try {
    const symbols = SECTORS.map(s => s.symbol);
    const quotes = await fetchYahooQuotes(symbols);

    if (quotes.length === 0) {
      // Serve stale if Yahoo blocked/empty
      if (entry && Date.now() - entry.ts < STALE_TTL) {
        return NextResponse.json(entry.data);
      }
      return NextResponse.json([]);
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
        high52w: q?.high52w ?? null,
        low52w: q?.low52w ?? null,
      };
    });

    const sorted = [...data]
      .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
      .map((s, i) => ({ ...s, rank: i + 1 }));

    cache.set('sectors', { data: sorted, ts: Date.now() });
    return NextResponse.json(sorted);
  } catch (err) {
    console.error('sectors error', err);
    if (entry && Date.now() - entry.ts < STALE_TTL) {
      return NextResponse.json(entry.data);
    }
    return NextResponse.json([], { status: 200 });
  }
}
