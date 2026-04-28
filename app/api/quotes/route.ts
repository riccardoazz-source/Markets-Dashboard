import { NextRequest, NextResponse } from 'next/server';
import { fetchTDQuotes } from '@/lib/twelvedata';

interface CacheEntry { data: unknown[]; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH = 60_000;
const STALE = 30 * 60_000;

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? [];
  if (!symbols.length) return NextResponse.json({ error: 'No symbols' }, { status: 400 });

  const key = [...symbols].sort().join(',');
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < FRESH) return NextResponse.json(entry.data);

  try {
    const quotes = await fetchTDQuotes(symbols);
    if (quotes.length > 0) {
      cache.set(key, { data: quotes, ts: Date.now() });
      return NextResponse.json(quotes);
    }
    if (entry && Date.now() - entry.ts < STALE) return NextResponse.json(entry.data);
    return NextResponse.json([]);
  } catch (err) {
    console.error('quotes error', err);
    if (entry && Date.now() - entry.ts < STALE) return NextResponse.json(entry.data);
    return NextResponse.json([], { status: 200 });
  }
}
