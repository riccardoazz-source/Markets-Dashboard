import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooQuotes } from '@/lib/yahoo';

interface CacheEntry { data: unknown[]; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH_TTL = 60_000;        // 1 min — fully fresh
const STALE_TTL = 30 * 60_000;   // 30 min — serve stale if fetch fails

export async function GET(req: NextRequest) {
  const symbols =
    req.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? [];
  if (!symbols.length) {
    return NextResponse.json({ error: 'No symbols' }, { status: 400 });
  }

  const key = [...symbols].sort().join(',');
  const entry = cache.get(key);

  // Fully fresh — serve cached
  if (entry && Date.now() - entry.ts < FRESH_TTL) {
    return NextResponse.json(entry.data);
  }

  try {
    const quotes = await fetchYahooQuotes(symbols);
    if (quotes.length > 0) {
      cache.set(key, { data: quotes, ts: Date.now() });
      return NextResponse.json(quotes);
    }
    // Yahoo returned empty — serve stale if we have any
    if (entry && Date.now() - entry.ts < STALE_TTL) {
      return NextResponse.json(entry.data);
    }
    return NextResponse.json([]);
  } catch (err) {
    console.error('quotes error', err);
    if (entry && Date.now() - entry.ts < STALE_TTL) {
      return NextResponse.json(entry.data);
    }
    return NextResponse.json([], { status: 200 });
  }
}
