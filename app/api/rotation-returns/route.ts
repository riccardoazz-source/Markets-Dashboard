import { NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';

export const runtime = 'edge';

interface RollingReturn {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  ma200: number | null;
}

interface CacheEntry { data: RollingReturn[]; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 5 * 60_000;

function rolling(history: { date: string; close: number }[], daysAgo: number): number | null {
  if (history.length < 2) return null;
  const current = history[history.length - 1].close;
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const targetStr = d.toISOString().slice(0, 10);
  let past: number | null = null;
  for (const pt of history) {
    if (pt.date <= targetStr) past = pt.close;
    else break;
  }
  if (!past || past === 0) return null;
  return (current / past - 1) * 100;
}

// 200-day simple moving average: average of the last 200 daily closes.
// 375-day fetch ≈ 267 trading days — enough for this MA.
function ma200d(history: { date: string; close: number }[]): number | null {
  if (history.length < 200) return null;
  const last200 = history.slice(-200);
  return last200.reduce((s, pt) => s + pt.close, 0) / 200;
}

function buildRow(symbol: string, history: { date: string; close: number }[]): RollingReturn {
  return {
    symbol,
    r1m: rolling(history, 30),
    r3m: rolling(history, 90),
    r6m: rolling(history, 180),
    r1y: rolling(history, 365),
    ma200: ma200d(history),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const extra = searchParams.get('extra');

  if (extra) {
    const syms = Array.from(new Set(extra.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 60);
    if (syms.length === 0) return NextResponse.json([]);
    const key = 'extra:' + [...syms].sort().join(',');
    const cachedExtra = cache.get(key);
    if (cachedExtra && Date.now() - cachedExtra.ts < TTL) {
      return NextResponse.json(cachedExtra.data);
    }
    const from = subDays(new Date(), 375);
    const to = new Date();
    const results = await Promise.allSettled(
      syms.map(sym => fetchYahooChart(sym, from, to, '1d').catch(() => []))
    );
    const data: RollingReturn[] = syms.map((symbol, i) => {
      const history = results[i].status === 'fulfilled' ? results[i].value : [];
      return buildRow(symbol, history);
    });
    cache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  }

  const cached = cache.get('all');
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json(cached.data);
  }

  const allSymbols = [
    ...INDEXES.map(i => i.symbol),
    ...COMMODITIES.map(c => c.symbol),
    ...CRYPTO_IDS.map(e => CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`),
    ...SECTORS.map(s => s.symbol),
  ];

  const from = subDays(new Date(), 375);
  const to = new Date();

  const results = await Promise.allSettled(
    allSymbols.map(sym => fetchYahooChart(sym, from, to, '1d').catch(() => []))
  );

  const data: RollingReturn[] = allSymbols.map((symbol, i) => {
    const history = results[i].status === 'fulfilled' ? results[i].value : [];
    return buildRow(symbol, history);
  });

  cache.set('all', { data, ts: Date.now() });
  return NextResponse.json(data);
}
