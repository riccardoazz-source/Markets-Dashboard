import { NextRequest, NextResponse } from 'next/server';
import { fetchSp500, Sp500Constituent } from '@/lib/sp500';
import { fetchYahooQuotesPE, fetchYahooPricesWide, yahooSessionOk } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Up to 60s on Vercel Hobby — Yahoo PE batch with quoteSummary backfill for
// missing PE can take 15-25s on cold starts.
export const maxDuration = 60;

interface Sp500Quote extends Sp500Constituent {
  price: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  changePercent: number | null;
}

interface CacheEntry { data: Sp500Quote[]; ts: number }
let cache: CacheEntry | null = null;
const FRESH = 5 * 60_000;
const STALE = 60 * 60_000;

const share = (rows: Sp500Quote[], k: keyof Sp500Quote) =>
  rows.filter(r => r[k] != null && (r[k] as number) > 0).length;

export async function GET(req: NextRequest) {
  const diag = req.nextUrl.searchParams.get('mode') === 'diag';
  if (!diag && cache && Date.now() - cache.ts < FRESH) {
    return NextResponse.json(cache.data);
  }

  const constituents = await fetchSp500();
  if (!constituents.length) {
    if (cache && Date.now() - cache.ts < STALE) return NextResponse.json(cache.data);
    return NextResponse.json([], { status: 200 });
  }
  const symbols = constituents.map(c => c.symbol);

  // 1. The v7 path: the only one that carries P/E and market cap.
  const quotes = await fetchYahooQuotesPE(symbols);
  const map = new Map(quotes.filter(q => q.price > 0).map(q => [q.symbol.toUpperCase(), q]));
  const fromV7 = map.size;

  // 2. Anything still without a price is filled from v8, which keeps working when v7
  // does not. This was missing: when v7 failed the route returned 503 names with every
  // number null and the panel showed a list of dashes, zero up and zero down.
  const missing = symbols.filter(s => !map.has(s.toUpperCase()));
  let fromV8 = 0;
  if (missing.length > symbols.length * 0.1) {
    for (const q of await fetchYahooPricesWide(missing)) {
      if (q.price > 0 && !map.has(q.symbol.toUpperCase())) { map.set(q.symbol.toUpperCase(), q); fromV8++; }
    }
  }

  const enriched: Sp500Quote[] = constituents.map(c => {
    const q = map.get(c.symbol.toUpperCase());
    return {
      ...c,
      price: q?.price ?? null,
      trailingPE: q?.trailingPE ?? null,
      forwardPE: q?.forwardPE ?? null,
      marketCap: q?.marketCap ?? null,
      changePercent: q?.changePercent ?? null,
    };
  });

  const stats = {
    constituents: enriched.length, fromV7, fromV8,
    withPrice: share(enriched, 'price'), withMarketCap: share(enriched, 'marketCap'),
    withPE: share(enriched, 'trailingPE'),
  };
  console.log('[sp500]', JSON.stringify(stats));

  if (diag) {
    return NextResponse.json({ ...stats, crumbSession: await yahooSessionOk(),
      sample: enriched.slice(0, 3) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Never cache a result with no prices in it as if it were one — keep serving the last
  // good one, and if there is none, send this one uncached so the next request retries.
  if (stats.withPrice < 50) {
    if (cache && Date.now() - cache.ts < STALE) return NextResponse.json(cache.data);
    return NextResponse.json(enriched);
  }
  cache = { data: enriched, ts: Date.now() };
  return NextResponse.json(enriched);
}
