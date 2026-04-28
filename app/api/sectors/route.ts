import { NextResponse } from 'next/server';
import { SECTORS } from '@/lib/config';
import { fetchYahooQuotes } from '@/lib/yahoo';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 60_000;

function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}
function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

export async function GET() {
  const cached = getCached('sectors');
  if (cached) return NextResponse.json(cached);

  try {
    const symbols = SECTORS.map(s => s.symbol);
    const quotes = await fetchYahooQuotes(symbols);

    // Merge quote response with sector metadata
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

    // Default sort: best daily change first
    const sorted = [...data]
      .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
      .map((s, i) => ({ ...s, rank: i + 1 }));

    setCached('sectors', sorted);
    return NextResponse.json(sorted);
  } catch (err) {
    console.error('sectors error', err);
    return NextResponse.json({ error: 'Failed to fetch sectors' }, { status: 500 });
  }
}
