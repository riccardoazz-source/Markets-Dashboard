import { NextResponse } from 'next/server';
import { fetchSp500, Sp500Constituent } from '@/lib/sp500';
import { fetchYahooQuotesPE } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET() {
  if (cache && Date.now() - cache.ts < FRESH) {
    return NextResponse.json(cache.data);
  }

  const constituents = await fetchSp500();
  if (!constituents.length) {
    if (cache && Date.now() - cache.ts < STALE) return NextResponse.json(cache.data);
    return NextResponse.json([], { status: 200 });
  }

  const quotes = await fetchYahooQuotesPE(constituents.map(c => c.symbol));
  const map = new Map(quotes.map(q => [q.symbol.toUpperCase(), q]));

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

  const filled = enriched.filter(e => e.trailingPE != null && e.trailingPE > 0).length;
  console.log(`[sp500] ${enriched.length} constituents, ${filled} with trailing P/E`);

  // If Yahoo gave us almost nothing, keep the stale cache rather than showing
  // an all-gray heatmap.
  if (filled < 50 && cache && Date.now() - cache.ts < STALE) {
    return NextResponse.json(cache.data);
  }
  cache = { data: enriched, ts: Date.now() };
  return NextResponse.json(enriched);
}
