import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Holding {
  symbol: string;
  name: string;
  weight: number | null;       // 0..1 fraction of ETF
  sector: string | null;
  industry: string | null;
  price: number | null;
  changePercent: number | null;
  trailingPE: number | null;
  marketCap: number | null;
}

interface CacheEntry { data: Holding[]; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH = 30 * 60_000;    // ETF composition rarely changes intraday
const STALE = 24 * 60 * 60_000;

const UA = 'Mozilla/5.0 (compatible; MarketsDashboard/1.0)';

async function fetchJson<T = unknown>(url: string, timeoutMs = 8_000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Yahoo's topHoldings module returns up to 10 holdings with weight + name.
// Symbol is NOT in topHoldings — it's only in the parent `holdings` array
// when present, or we resolve via the symbol field within each row.
async function fetchTopHoldings(etf: string): Promise<{ symbol: string; name: string; weight: number | null }[]> {
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(etf)}` +
    `?modules=topHoldings`;
  const json = await fetchJson<{
    quoteSummary?: {
      result?: Array<{
        topHoldings?: {
          holdings?: Array<{
            symbol?: string;
            holdingName?: string;
            holdingPercent?: { raw?: number } | number;
          }>;
        };
      }>;
    };
  }>(url);
  const holdings = json?.quoteSummary?.result?.[0]?.topHoldings?.holdings ?? [];
  return holdings
    .filter(h => h?.symbol)
    .map(h => {
      const w = h.holdingPercent;
      const weight = typeof w === 'number' ? w : (w?.raw ?? null);
      return {
        symbol: (h.symbol as string).toUpperCase(),
        name: h.holdingName ?? (h.symbol as string),
        weight,
      };
    });
}

// Batch quote (v7 no-auth) — gives us price, trailingPE, sector via assetProfile? No,
// v7 doesn't include sector/industry. We pull industry per symbol in parallel below.
async function fetchBatchQuotes(symbols: string[]): Promise<Map<string, {
  price: number | null;
  changePercent: number | null;
  trailingPE: number | null;
  marketCap: number | null;
}>> {
  if (!symbols.length) return new Map();
  const url =
    `https://query2.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(','))}&formatted=false&lang=en-US&region=US`;
  const json = await fetchJson<{ quoteResponse?: { result?: Record<string, unknown>[] } }>(url);
  const items = json?.quoteResponse?.result ?? [];
  const map = new Map<string, {
    price: number | null;
    changePercent: number | null;
    trailingPE: number | null;
    marketCap: number | null;
  }>();
  for (const it of items) {
    const sym = (it.symbol as string)?.toUpperCase();
    if (!sym) continue;
    const price = Number(it.regularMarketPrice);
    const pct = Number(it.regularMarketChangePercent);
    map.set(sym, {
      price: isFinite(price) && price > 0 ? price : null,
      changePercent: isFinite(pct) ? pct : null,
      trailingPE: it.trailingPE != null && isFinite(Number(it.trailingPE)) ? Number(it.trailingPE) : null,
      marketCap: it.marketCap != null && isFinite(Number(it.marketCap)) ? Number(it.marketCap) : null,
    });
  }
  return map;
}

// Per-symbol industry/sector via assetProfile — used to layer the value chain.
// Called once per holding, in parallel, cached by symbol within process lifetime.
const industryCache = new Map<string, { sector: string | null; industry: string | null; ts: number }>();
const INDUSTRY_TTL = 7 * 24 * 60 * 60_000;

async function fetchIndustry(symbol: string): Promise<{ sector: string | null; industry: string | null }> {
  const cached = industryCache.get(symbol);
  if (cached && Date.now() - cached.ts < INDUSTRY_TTL) {
    return { sector: cached.sector, industry: cached.industry };
  }
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=assetProfile`;
  const json = await fetchJson<{
    quoteSummary?: { result?: Array<{ assetProfile?: { sector?: string; industry?: string } }> };
  }>(url);
  const p = json?.quoteSummary?.result?.[0]?.assetProfile;
  const out = { sector: p?.sector ?? null, industry: p?.industry ?? null };
  industryCache.set(symbol, { ...out, ts: Date.now() });
  return out;
}

export async function GET(req: NextRequest) {
  const etf = req.nextUrl.searchParams.get('etf')?.toUpperCase().trim();
  if (!etf) return NextResponse.json({ error: 'etf required' }, { status: 400 });

  const entry = cache.get(etf);
  if (entry && Date.now() - entry.ts < FRESH) return NextResponse.json(entry.data);

  const top = await fetchTopHoldings(etf);
  if (!top.length) {
    if (entry && Date.now() - entry.ts < STALE) return NextResponse.json(entry.data);
    return NextResponse.json([]);
  }

  const symbols = top.map(t => t.symbol);
  const [quotes, industries] = await Promise.all([
    fetchBatchQuotes(symbols),
    Promise.all(symbols.map(s => fetchIndustry(s))),
  ]);

  const result: Holding[] = top.map((t, i) => {
    const q = quotes.get(t.symbol);
    const ind = industries[i];
    return {
      symbol: t.symbol,
      name: t.name,
      weight: t.weight,
      sector: ind?.sector ?? null,
      industry: ind?.industry ?? null,
      price: q?.price ?? null,
      changePercent: q?.changePercent ?? null,
      trailingPE: q?.trailingPE ?? null,
      marketCap: q?.marketCap ?? null,
    };
  });

  cache.set(etf, { data: result, ts: Date.now() });
  return NextResponse.json(result);
}
