import { NextRequest, NextResponse } from 'next/server';
import { fetchSp500, Sp500Constituent } from '@/lib/sp500';
import { fetchYahooQuotesGentle, yahooSessionOk } from '@/lib/yahoo';

// EDGE, like every other route in this app that talks to Yahoo — and for that reason.
// This was the one Yahoo route on the nodejs runtime (with /api/holdings), and those two
// were the only ones failing: Yahoo answered 429 to every request from the nodejs egress
// a full day after the request volume had been cut to a dozen, while the edge routes
// (/api/quotes, /api/historical, /api/stock…) kept getting prices. The block is on the
// datacenter IPs the nodejs functions leave from, not on what this route asks for.
export const runtime = 'edge';
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

// unstable_cache is not available on the edge runtime, so a module-level cache per
// isolate for six hours. With the request volume now a dozen calls per fill, a cold
// isolate refilling is cheap; a fill with fewer than 50 prices throws and is not kept.
let quoteCache: { r: Awaited<ReturnType<typeof fetchYahooQuotesGentle>>; ts: number } | null = null;
async function loadQuotes(joined: string) {
  if (quoteCache && Date.now() - quoteCache.ts < 21_600_000) return quoteCache.r;
  const r = await fetchYahooQuotesGentle(joined.split(','));
  if (r.quotes.length < 50) throw new Error('too few quotes: ' + r.trace.join(' | '));
  quoteCache = { r, ts: Date.now() };
  return r;
}

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

  // ONE fill per six hours for the whole deployment, not one per serverless instance
  // every five minutes. The per-instance cache is what turned a heavy request into a
  // flood: every cold instance repeated it. A fill with almost no prices throws, so a
  // throttled answer is never cached as if it were good.
  let fill: { quotes: Awaited<ReturnType<typeof fetchYahooQuotesGentle>>['quotes']; trace: string[] };
  try {
    fill = diag ? await fetchYahooQuotesGentle(symbols) : await loadQuotes(symbols.join(','));
  } catch {
    fill = { quotes: [], trace: ['fill failed or throttled — not cached'] };
  }
  const map = new Map(fill.quotes.map(q => [q.symbol.toUpperCase(), q]));

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
    constituents: enriched.length, trace: fill.trace,
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
