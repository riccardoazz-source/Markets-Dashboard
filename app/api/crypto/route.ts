import { NextRequest, NextResponse } from 'next/server';
import { CRYPTO_IDS } from '@/lib/config';
import { fetchYahooQuotes } from '@/lib/yahoo';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const MARKETS_TTL = 60_000;          // 1 min for live prices
const HIST_TTL    = 30 * 60_000;     // 30 min for historical (rarely changes)

function getCached(key: string, ttl: number) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < ttl) return e.data;
  return null;
}
function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

const UA = 'Mozilla/5.0 (compatible; MarketsDashboard/1.0)';

async function fetchCG(url: string, timeoutMs = 12_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': UA },
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(t);
  }
}

// CoinGecko free tier rate-limits at 30/min — retry with backoff on 429/5xx
async function fetchCGWithRetry(url: string): Promise<Response> {
  let res = await fetchCG(url);
  if (res.ok) return res;
  if (res.status !== 429 && res.status < 500) return res;
  await new Promise(r => setTimeout(r, 1500));
  res = await fetchCG(url);
  if (res.ok) return res;
  await new Promise(r => setTimeout(r, 3000));
  return fetchCG(url);
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'markets';

  if (mode === 'markets') {
    const cached = getCached('markets', MARKETS_TTL);
    if (cached) return NextResponse.json(cached);

    const ids = CRYPTO_IDS.map(c => c.id).join(',');
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h,7d,1y`;

    try {
      // CoinGecko has no YTD field — fetch Yahoo quotes for the same coins in
      // parallel (BTC-USD, ETH-USD…) so we can attach YTD from Yahoo's chart data.
      const ytdSymbols = CRYPTO_IDS.map(c => `${c.symbol}-USD`);
      const [cgRes, yQuotes] = await Promise.all([
        fetchCGWithRetry(url),
        fetchYahooQuotes(ytdSymbols).catch(() => []),
      ]);
      if (!cgRes.ok) throw new Error(`CoinGecko: ${cgRes.status}`);
      const raw = await cgRes.json() as Array<Record<string, unknown>>;

      const ytdMap = new Map<string, number | null>();
      for (const q of yQuotes) {
        const cgSymbol = q.symbol.replace(/-USD$/, '').toUpperCase();
        ytdMap.set(cgSymbol, q.ytdChangePercent);
      }

      const data = raw.map(coin => {
        const sym = (coin.symbol as string)?.toUpperCase();
        return {
          id: coin.id,
          symbol: sym,
          name: coin.name,
          price: coin.current_price,
          change24h: coin.price_change_24h,
          change24hPercent: coin.price_change_percentage_24h,
          change7dPercent: coin.price_change_percentage_7d_in_currency,
          change1yPercent: coin.price_change_percentage_1y_in_currency ?? null,
          ytdChangePercent: ytdMap.get(sym) ?? null,
          marketCap: coin.market_cap,
          volume24h: coin.total_volume,
          image: coin.image,
        };
      });

      setCached('markets', data);
      return NextResponse.json(data);
    } catch (err) {
      console.error('crypto markets error', err);
      return NextResponse.json({ error: 'Failed to fetch crypto data' }, { status: 500 });
    }
  }

  if (mode === 'historical') {
    const id = req.nextUrl.searchParams.get('id');
    const days = req.nextUrl.searchParams.get('days') ?? '365';
    if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });

    const key = `crypto-hist:${id}:${days}`;
    const cached = getCached(key, HIST_TTL);
    if (cached) return NextResponse.json(cached);

    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;

    try {
      const res = await fetchCGWithRetry(url);
      if (!res.ok) throw new Error(`CoinGecko: ${res.status}`);
      const raw = await res.json() as { prices?: [number, number][] };
      if (!raw.prices || raw.prices.length === 0) {
        throw new Error('CoinGecko returned no prices');
      }

      const data = raw.prices
        .filter(([, price]) => price != null && price > 0 && isFinite(price))
        .map(([ts, price]) => ({
          date: new Date(ts).toISOString().split('T')[0],
          close: price,
        }));

      const unique = Array.from(
        data.reduce((m, d) => { m.set(d.date, d); return m; }, new Map<string, { date: string; close: number }>()).values()
      ).sort((a, b) => a.date.localeCompare(b.date));

      setCached(key, unique);
      return NextResponse.json(unique);
    } catch (err) {
      console.error('crypto historical error', id, days, err);
      return NextResponse.json({ error: 'Failed to fetch crypto history' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
}
