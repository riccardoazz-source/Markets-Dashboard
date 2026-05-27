import { NextRequest, NextResponse } from 'next/server';
import { CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS } from '@/lib/config';

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

// Jan 1 USD price per coin id — immutable historical data, cached for the whole year.
const ytdAnchorCache = new Map<string, number>();
let ytdAnchorYear = 0;

async function fetchYtdAnchor(id: string): Promise<number | null> {
  const year = new Date().getUTCFullYear();
  if (ytdAnchorYear !== year) { ytdAnchorCache.clear(); ytdAnchorYear = year; }
  const cached = ytdAnchorCache.get(id);
  if (cached != null) return cached;

  // CoinGecko /coins/{id}/history needs DD-MM-YYYY format
  const dateStr = `01-01-${year}`;
  const url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${dateStr}&localization=false`;
  try {
    const res = await fetchCG(url, 10_000);
    if (!res.ok) return null;
    const json = await res.json() as { market_data?: { current_price?: { usd?: number } } };
    const price = json?.market_data?.current_price?.usd;
    if (typeof price === 'number' && isFinite(price) && price > 0) {
      ytdAnchorCache.set(id, price);
      return price;
    }
  } catch { /* ignore */ }
  return null;
}

// Sequential fetch — CoinGecko free tier caps at 30 req/min.
// Firing all coins in parallel bursts easily breaches that limit on cold starts
// (in-memory cache is empty on each serverless instance start).
// A small inter-request delay keeps the burst well below the rate cap.
async function fetchYtdAnchors(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of ids) {
    try {
      const p = await fetchYtdAnchor(id);
      if (p != null) map.set(id, p);
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 120)); // ~8 req/s ≪ 30 req/min ceiling
  }
  return map;
}

// 1st-of-month USD price per coin id — immutable once the month started, cached per month.
const mtdAnchorCache = new Map<string, number>();
let mtdAnchorMonth = '';

async function fetchMtdAnchor(id: string): Promise<number | null> {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
  if (mtdAnchorMonth !== monthKey) { mtdAnchorCache.clear(); mtdAnchorMonth = monthKey; }
  const cached = mtdAnchorCache.get(id);
  if (cached != null) return cached;

  // CoinGecko /coins/{id}/history needs DD-MM-YYYY format
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dateStr = `01-${mm}-${now.getUTCFullYear()}`;
  const url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${dateStr}&localization=false`;
  try {
    const res = await fetchCG(url, 10_000);
    if (!res.ok) return null;
    const json = await res.json() as { market_data?: { current_price?: { usd?: number } } };
    const price = json?.market_data?.current_price?.usd;
    if (typeof price === 'number' && isFinite(price) && price > 0) {
      mtdAnchorCache.set(id, price);
      return price;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchMtdAnchors(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of ids) {
    try {
      const p = await fetchMtdAnchor(id);
      if (p != null) map.set(id, p);
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 120));
  }
  return map;
}

// 5-years-ago USD price per coin id — for 5Y change %.
// Cached for one calendar day since "5 years ago" only shifts by one day per day.
const fiveYearAnchorCache = new Map<string, { price: number; day: string }>();

async function fetchFiveYearAnchor(id: string): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = fiveYearAnchorCache.get(id);
  if (cached && cached.day === today) return cached.price;

  const target = new Date();
  target.setUTCFullYear(target.getUTCFullYear() - 5);
  const dd = String(target.getUTCDate()).padStart(2, '0');
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = target.getUTCFullYear();
  const dateStr = `${dd}-${mm}-${yyyy}`;
  const url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${dateStr}&localization=false`;
  try {
    const res = await fetchCG(url, 10_000);
    if (!res.ok) return null;
    const json = await res.json() as { market_data?: { current_price?: { usd?: number } } };
    const price = json?.market_data?.current_price?.usd;
    if (typeof price === 'number' && isFinite(price) && price > 0) {
      fiveYearAnchorCache.set(id, { price, day: today });
      return price;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchFiveYearAnchors(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of ids) {
    try {
      const p = await fetchFiveYearAnchor(id);
      if (p != null) map.set(id, p);
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 120));
  }
  return map;
}

// Yahoo Finance fallback — single 5y chart fetch per coin yields 5Y, YTD, MTD anchors.
// Yahoo isn't rate-limited like CoinGecko's free tier, so it's the reliable source
// when CoinGecko anchor fetches fail (which is most of the time on cold serverless
// instances). One round-trip per coin instead of three.
interface YahooAnchors { fiveY: number | null; ytd: number | null; mtd: number | null }
const yahooAnchorCache = new Map<string, { anchors: YahooAnchors; day: string }>();

async function fetchYahooCryptoAnchors(coinId: string): Promise<YahooAnchors> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = yahooAnchorCache.get(coinId);
  if (cached && cached.day === today) return cached.anchors;

  const symbol = CRYPTO_YAHOO_SYMBOLS[coinId];
  const empty: YahooAnchors = { fiveY: null, ytd: null, mtd: null };
  if (!symbol) return empty;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&includePrePost=false`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return empty;
    const json = await res.json() as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
    };
    const r = json.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    if (!ts.length || !closes.length) return empty;

    const findFirstValid = (fromTs: number): number | null => {
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < fromTs) continue;
        const c = closes[i];
        if (typeof c === 'number' && isFinite(c) && c > 0) return c;
      }
      return null;
    };

    const now = new Date();
    const year = now.getUTCFullYear();
    const jan1 = Math.floor(Date.UTC(year, 0, 1) / 1000);
    const monthStart = Math.floor(Date.UTC(year, now.getUTCMonth(), 1) / 1000);
    const fiveYearsAgo = Math.floor((Date.now() - 5 * 365 * 86_400_000) / 1000);

    const anchors: YahooAnchors = {
      fiveY: findFirstValid(fiveYearsAgo),
      ytd: findFirstValid(jan1),
      mtd: findFirstValid(monthStart),
    };
    yahooAnchorCache.set(coinId, { anchors, day: today });
    return anchors;
  } catch {
    return empty;
  } finally {
    clearTimeout(t);
  }
}

async function fetchYahooAnchorsAll(ids: string[]): Promise<Map<string, YahooAnchors>> {
  const map = new Map<string, YahooAnchors>();
  // Yahoo is fine with parallel — no rate limit at this volume (8 coins)
  const results = await Promise.all(
    ids.map(id => fetchYahooCryptoAnchors(id).then(a => ({ id, a })).catch(() => ({ id, a: { fiveY: null, ytd: null, mtd: null } as YahooAnchors })))
  );
  for (const { id, a } of results) map.set(id, a);
  return map;
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
    // price_change_percentage=30d gives us a reliable MTD proxy (last 30 calendar
    // days) without any extra API calls, avoiding the 30 req/min rate-limit issue
    // that plagued the per-coin /history anchor approach.
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h,7d,30d,1y`;

    try {
      // Anchor strategy:
      // - Yahoo Finance is the PRIMARY source — one 5y chart fetch per coin yields
      //   5Y, YTD, MTD anchors. Yahoo isn't rate-limited like CoinGecko's free tier
      //   (which was returning null on cold starts because of the 30 req/min cap).
      // - CoinGecko per-coin /history is a SECONDARY source (still hit in parallel
      //   so cached values back-fill into subsequent requests).
      const coinIds = CRYPTO_IDS.map(c => c.id);
      const [cgRes, yahooAnchors, anchors, mtdAnchors, fiveYearAnchors] = await Promise.all([
        fetchCGWithRetry(url),
        fetchYahooAnchorsAll(coinIds),
        fetchYtdAnchors(coinIds).catch(() => new Map<string, number>()),
        fetchMtdAnchors(coinIds).catch(() => new Map<string, number>()),
        fetchFiveYearAnchors(coinIds).catch(() => new Map<string, number>()),
      ]);
      if (!cgRes.ok) throw new Error(`CoinGecko: ${cgRes.status}`);
      const raw = await cgRes.json() as Array<Record<string, unknown>>;

      const data = raw.map(coin => {
        const sym = (coin.symbol as string)?.toUpperCase();
        const currentPrice = coin.current_price as number;
        const id = coin.id as string;
        const ya = yahooAnchors.get(id) ?? { fiveY: null, ytd: null, mtd: null };

        // YTD: CoinGecko anchor first (precise Jan 1 UTC), Yahoo fallback (first
        // trading day ≥ Jan 1).
        const jan1Price = anchors.get(id) ?? ya.ytd;
        const ytdChangePercent =
          jan1Price != null && currentPrice > 0
            ? ((currentPrice - jan1Price) / jan1Price) * 100
            : null;

        // MTD: CoinGecko anchor → Yahoo anchor → 30d rolling proxy from markets endpoint.
        const monthStartPrice = mtdAnchors.get(id) ?? ya.mtd;
        const mtdFromAnchor =
          monthStartPrice != null && currentPrice > 0
            ? ((currentPrice - monthStartPrice) / monthStartPrice) * 100
            : null;
        const mtd30d = coin.price_change_percentage_30d_in_currency as number | null | undefined;
        const mtdChangePercent = mtdFromAnchor ?? (typeof mtd30d === 'number' && isFinite(mtd30d) ? mtd30d : null);

        // 5Y: CoinGecko anchor → Yahoo anchor. Yahoo is the reliable primary
        // because CoinGecko's /history endpoint is rate-limited on cold starts.
        const fiveYearPrice = fiveYearAnchors.get(id) ?? ya.fiveY;
        const fiveYearChangePercent =
          fiveYearPrice != null && currentPrice > 0
            ? ((currentPrice - fiveYearPrice) / fiveYearPrice) * 100
            : null;
        return {
          id: coin.id,
          symbol: sym,
          name: coin.name,
          price: currentPrice,
          change24h: coin.price_change_24h,
          change24hPercent: coin.price_change_percentage_24h,
          change7dPercent: coin.price_change_percentage_7d_in_currency,
          change1yPercent: coin.price_change_percentage_1y_in_currency ?? null,
          mtdChangePercent,
          ytdChangePercent,
          fiveYearChangePercent,
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
