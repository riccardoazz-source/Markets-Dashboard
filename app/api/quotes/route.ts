import { NextRequest, NextResponse } from 'next/server';
import { fetchStooqQuote, fetchStooqHistorical, compute52w } from '@/lib/stooq';
import { subYears } from 'date-fns';

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

async function quoteWithRange(symbol: string) {
  const [quote, hist] = await Promise.all([
    fetchStooqQuote(symbol),
    fetchStooqHistorical(symbol, subYears(new Date(), 1), new Date(), 'd').catch(() => []),
  ]);
  if (!quote) return null;
  const range = compute52w(hist);
  return { ...quote, high52w: range.high, low52w: range.low };
}

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') ?? [];
  if (!symbols.length) return NextResponse.json({ error: 'No symbols' }, { status: 400 });

  const key = symbols.sort().join(',');
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  try {
    const results = await Promise.all(symbols.map(s => quoteWithRange(s)));
    const quotes = results.filter(q => q !== null);
    setCached(key, quotes);
    return NextResponse.json(quotes);
  } catch (err) {
    console.error('quotes error', err);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}
