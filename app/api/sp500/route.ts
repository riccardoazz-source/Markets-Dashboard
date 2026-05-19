import { NextResponse } from 'next/server';
import { fetchSp500, Sp500Constituent } from '@/lib/sp500';

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
const FRESH = 5 * 60_000;     // PE doesn't change minute-to-minute
const STALE = 60 * 60_000;

const UA = 'Mozilla/5.0 (compatible; MarketsDashboard/1.0)';

interface QuoteSnapshot {
  price: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  changePercent: number | null;
}

// Yahoo v7 quote returns trailingPE / forwardPE / marketCap in a single batch.
// query2 + no auth works without crumb; daily % may be wrong (uses corrupt
// previousClose) but PE / marketCap are accurate, which is all we need here.
async function fetchYahooBatchPE(symbols: string[]): Promise<Map<string, QuoteSnapshot>> {
  const url =
    `https://query2.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(','))}&formatted=false&lang=en-US&region=US`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return new Map();
    const json = await res.json() as { quoteResponse?: { result?: Record<string, unknown>[] } };
    const items = json?.quoteResponse?.result ?? [];
    const map = new Map<string, QuoteSnapshot>();
    for (const it of items) {
      const sym = (it.symbol as string)?.toUpperCase();
      if (!sym) continue;
      const price = Number(it.regularMarketPrice);
      const pct = Number(it.regularMarketChangePercent);
      map.set(sym, {
        price: isFinite(price) && price > 0 ? price : null,
        trailingPE: it.trailingPE != null && isFinite(Number(it.trailingPE)) ? Number(it.trailingPE) : null,
        forwardPE: it.forwardPE != null && isFinite(Number(it.forwardPE)) ? Number(it.forwardPE) : null,
        marketCap: it.marketCap != null && isFinite(Number(it.marketCap)) ? Number(it.marketCap) : null,
        changePercent: isFinite(pct) ? pct : null,
      });
    }
    return map;
  } catch {
    return new Map();
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < FRESH) {
    return NextResponse.json(cache.data);
  }

  const constituents = await fetchSp500();
  if (!constituents.length) {
    if (cache && Date.now() - cache.ts < STALE) return NextResponse.json(cache.data);
    return NextResponse.json([], { status: 200 });
  }

  // Batch in chunks of 100 (Yahoo's practical URL-length limit) — parallel.
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < constituents.length; i += CHUNK) {
    chunks.push(constituents.slice(i, i + CHUNK).map(c => c.symbol));
  }
  const maps = await Promise.all(chunks.map(fetchYahooBatchPE));
  const merged = new Map<string, QuoteSnapshot>();
  for (const m of maps) for (const [k, v] of m) merged.set(k, v);

  const enriched: Sp500Quote[] = constituents.map(c => {
    const q = merged.get(c.symbol.toUpperCase());
    return {
      ...c,
      price: q?.price ?? null,
      trailingPE: q?.trailingPE ?? null,
      forwardPE: q?.forwardPE ?? null,
      marketCap: q?.marketCap ?? null,
      changePercent: q?.changePercent ?? null,
    };
  });

  const filled = enriched.filter(e => e.trailingPE != null).length;
  console.log(`[sp500] ${enriched.length} constituents, ${filled} with PE`);

  if (filled < 50 && cache && Date.now() - cache.ts < STALE) {
    return NextResponse.json(cache.data);
  }
  cache = { data: enriched, ts: Date.now() };
  return NextResponse.json(enriched);
}
