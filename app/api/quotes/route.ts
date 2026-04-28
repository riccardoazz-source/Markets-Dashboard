import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooData } from '@/lib/yahoo';
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

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function quoteFor(symbol: string) {
  const { meta, points } = await fetchYahooData(
    symbol,
    subYears(new Date(), 1),
    new Date(),
    '1d',
  );

  if (!meta && points.length < 2) return null;

  const price = meta?.price ?? points[points.length - 1]?.close ?? 0;
  const previousClose = meta?.previousClose ?? points[points.length - 2]?.close ?? 0;

  if (price <= 0) return null;

  const closes = points.map(p => p.close);
  return {
    symbol,
    name: symbol,
    price,
    previousClose,
    change: price - previousClose,
    changePercent: previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
    currency: meta?.currency ?? 'USD',
    high52w: meta?.high52w ?? (closes.length ? Math.max(...closes) : null),
    low52w: meta?.low52w ?? (closes.length ? Math.min(...closes) : null),
    volume: null,
    trailingPE: null,
    forwardPE: null,
    marketCap: null,
  };
}

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? [];
  if (!symbols.length) return NextResponse.json({ error: 'No symbols' }, { status: 400 });

  const key = [...symbols].sort().join(',');
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  try {
    // Batch in groups of 4 with 300ms delay to avoid Yahoo rate limits
    const quotes: unknown[] = [];
    const BATCH = 4;
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(s => quoteFor(s)));
      quotes.push(...results.filter(q => q !== null));
      if (i + BATCH < symbols.length) await delay(300);
    }
    setCached(key, quotes);
    return NextResponse.json(quotes);
  } catch (err) {
    console.error('quotes error', err);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}
