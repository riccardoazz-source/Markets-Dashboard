import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooQuote, fetchYahooPE } from '@/lib/yahoo';

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
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') ?? [];
  const includePE = req.nextUrl.searchParams.get('pe') !== 'false';
  if (!symbols.length) return NextResponse.json({ error: 'No symbols' }, { status: 400 });

  const key = symbols.sort().join(',') + (includePE ? ':pe' : '');
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  try {
    const quotes = await Promise.all(symbols.map(s => fetchYahooQuote(s)));

    let withPE = quotes;
    if (includePE) {
      const peResults = await Promise.all(
        symbols.map(s => fetchYahooPE(s).catch(() => ({ trailingPE: null, forwardPE: null, marketCap: null })))
      );
      withPE = quotes.map((q, i) => q && { ...q, ...peResults[i] });
    }

    const result = withPE.filter(q => q !== null);
    setCached(key, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('quotes error', err);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}
