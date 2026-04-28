import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(req: NextRequest) {
  const symbols =
    req.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? [];
  if (!symbols.length) {
    return NextResponse.json({ error: 'No symbols' }, { status: 400 });
  }

  const key = [...symbols].sort().join(',');
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  try {
    // ONE call returns all symbols — same pattern as CoinGecko /markets
    const quotes = await fetchYahooQuotes(symbols);
    setCached(key, quotes);
    return NextResponse.json(quotes);
  } catch (err) {
    console.error('quotes error', err);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}
