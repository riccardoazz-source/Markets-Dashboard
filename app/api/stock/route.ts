import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooData, fetchYahooEarnings } from '@/lib/yahoo';
import { fetchFmpEarnings } from '@/lib/fmp';
import { subWeeks, subMonths, subYears, startOfYear } from 'date-fns';

export const runtime = 'edge';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH = 5 * 60_000;
const STALE = 60 * 60_000;

function getCached(key: string, ttl: number) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < ttl) return e.data;
  return null;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getStartDate(timeframe: string): Date {
  const now = new Date();
  switch (timeframe) {
    case '1W':  return subWeeks(now, 1);
    case '1M':  return subMonths(now, 1);
    case '3M':  return subMonths(now, 3);
    case '6M':  return subMonths(now, 6);
    case 'YTD': return startOfYear(now);
    case '1Y':  return subYears(now, 1);
    case '3Y':  return subYears(now, 3);
    case '5Y':  return subYears(now, 5);
    case '10Y': return subYears(now, 10);
    case 'MAX': return new Date('1900-01-01');
    default:    return subYears(now, 1);
  }
}

function getInterval(timeframe: string): '1d' | '1wk' | '1mo' {
  if (['1W', '1M', '3M', '6M', 'YTD', '1Y'].includes(timeframe)) return '1d';
  if (['3Y', '5Y'].includes(timeframe)) return '1wk';
  return '1mo'; // 10Y and MAX
}

interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

async function searchYahoo(q: string, timeoutMs = 5000): Promise<SearchHit[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
    });
    if (!res.ok) {
      console.error('[stock-search] HTTP', res.status);
      return [];
    }
    const json = await res.json() as { quotes?: Record<string, unknown>[] };
    const out: SearchHit[] = [];
    for (const it of json.quotes ?? []) {
      const symbol = (it.symbol as string) ?? '';
      if (!symbol) continue;
      out.push({
        symbol,
        name:
          (it.longname as string) ??
          (it.shortname as string) ??
          (it.name as string) ??
          symbol,
        exchange: (it.exchDisp as string) ?? (it.exchange as string) ?? '',
        type: (it.quoteType as string) ?? (it.typeDisp as string) ?? '',
      });
    }
    return out;
  } catch (e) {
    console.error('[stock-search] failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'history';

  // ---- Earnings (quarterly EPS history + financials) ----
  if (mode === 'earnings') {
    const symbol = req.nextUrl.searchParams.get('symbol');
    if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });
    const key = `earn:${symbol}`;
    const cached = getCached(key, 60 * 60_000);
    if (cached) return NextResponse.json(cached);

    // FMP (primary): 5y quarterly + 20y annual on the free tier
    let data = await fetchFmpEarnings(symbol);
    // Yahoo fallback: in case FMP doesn't cover the symbol (some non-US tickers)
    if (!data || (data.quarterly.length === 0 && data.financials.length === 0)) {
      data = await fetchYahooEarnings(symbol);
    }

    const payload = data ?? { quarterly: [], financials: [], currency: 'USD' };
    if (data && (data.quarterly.length > 0 || data.financials.length > 0)) {
      cache.set(key, { data: payload, ts: Date.now() });
    }
    return NextResponse.json(payload);
  }

  // ---- Quick earnings diagnostic (no cache) ----
  if (mode === 'diag') {
    const sym = req.nextUrl.searchParams.get('symbol') ?? 'AAPL';
    const [fmp, yahoo] = await Promise.all([
      fetchFmpEarnings(sym).catch((e: Error) => ({ error: e.message })),
      fetchYahooEarnings(sym).catch((e: Error) => ({ error: e.message })),
    ]);
    const fmpResult = fmp && 'quarterly' in fmp ? `OK: ${fmp.quarterly.length} EPS, ${fmp.financials.length} fin` : `FAIL: ${JSON.stringify(fmp)}`;
    const yahooResult = yahoo && 'quarterly' in yahoo ? `OK: ${yahoo.quarterly.length} EPS, ${yahoo.financials.length} fin / first EPS: ${JSON.stringify(yahoo.quarterly[0])} / first fin: ${JSON.stringify(yahoo.financials[0])}` : `FAIL: ${JSON.stringify(yahoo)}`;
    return NextResponse.json({ fmpApiKey: !!process.env.FMP_API_KEY, fmp: fmpResult, yahoo: yahooResult });
  }

  // ---- Search by ticker / ISIN / name ----
  if (mode === 'search') {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q || q.length < 1) return NextResponse.json([]);
    const key = `search:${q.toLowerCase()}`;
    const cached = getCached(key, FRESH);
    if (cached) return NextResponse.json(cached);
    const hits = await searchYahoo(q);
    if (hits.length > 0) cache.set(key, { data: hits, ts: Date.now() });
    return NextResponse.json(hits);
  }

  // ---- Historical data + dividends + meta for one symbol ----
  const symbol = req.nextUrl.searchParams.get('symbol');
  const timeframe = req.nextUrl.searchParams.get('timeframe') ?? '5Y';
  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  const key = `stk:${symbol}:${timeframe}`;
  const cached = getCached(key, FRESH);
  if (cached) return NextResponse.json(cached);

  const from = getStartDate(timeframe);
  const to = new Date();
  const interval = getInterval(timeframe);

  try {
    const data = await fetchYahooData(symbol, from, to, interval, true);
    const payload = {
      symbol,
      meta: data.meta,
      prices: data.points,
      adjPrices: data.adjPoints ?? [],
      dividends: data.dividends ?? [],
    };
    if (data.points.length > 0) {
      cache.set(key, { data: payload, ts: Date.now() });
    } else {
      const stale = getCached(key, STALE);
      if (stale) return NextResponse.json(stale);
    }
    return NextResponse.json(payload);
  } catch (err) {
    console.error('stock error', symbol, err);
    const stale = getCached(key, STALE);
    if (stale) return NextResponse.json(stale);
    return NextResponse.json({ symbol, meta: null, prices: [], dividends: [] }, { status: 200 });
  }
}
