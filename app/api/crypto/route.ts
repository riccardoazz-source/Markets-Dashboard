import { NextRequest, NextResponse } from 'next/server';
import { CRYPTO_IDS } from '@/lib/config';

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
  const mode = req.nextUrl.searchParams.get('mode') ?? 'markets';

  if (mode === 'markets') {
    const cached = getCached('markets');
    if (cached) return NextResponse.json(cached);

    const ids = CRYPTO_IDS.map(c => c.id).join(',');
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h,7d`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 60 },
      });

      if (!res.ok) throw new Error(`CoinGecko: ${res.status}`);
      const raw = await res.json() as Array<Record<string, unknown>>;

      const data = raw.map(coin => ({
        id: coin.id,
        symbol: (coin.symbol as string)?.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change24h: coin.price_change_24h,
        change24hPercent: coin.price_change_percentage_24h,
        change7dPercent: coin.price_change_percentage_7d_in_currency,
        marketCap: coin.market_cap,
        volume24h: coin.total_volume,
        image: coin.image,
      }));

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
    const cached = getCached(key);
    if (cached) return NextResponse.json(cached);

    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 300 },
      });
      if (!res.ok) throw new Error(`CoinGecko: ${res.status}`);
      const raw = await res.json() as { prices: [number, number][] };

      const data = raw.prices.map(([ts, price]) => ({
        date: new Date(ts).toISOString().split('T')[0],
        close: price,
      }));

      const unique = Array.from(
        data.reduce((m, d) => { m.set(d.date, d); return m; }, new Map<string, { date: string; close: number }>()).values()
      ).sort((a, b) => a.date.localeCompare(b.date));

      setCached(key, unique);
      return NextResponse.json(unique);
    } catch (err) {
      console.error('crypto historical error', id, err);
      return NextResponse.json({ error: 'Failed to fetch crypto history' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
}
