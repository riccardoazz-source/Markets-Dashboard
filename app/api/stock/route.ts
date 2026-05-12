import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooData, fetchYahooEarnings } from '@/lib/yahoo';
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
    const cached = getCached(key, 6 * 60 * 60_000); // 6h — earnings update infrequently
    if (cached) return NextResponse.json(cached);
    const data = await fetchYahooEarnings(symbol);
    const payload = data ?? { quarterly: [], financials: [], currency: 'USD' };
    if (data && (data.quarterly.length > 0 || data.financials.length > 0)) {
      cache.set(key, { data: payload, ts: Date.now() });
    }
    return NextResponse.json(payload);
  }

  // ---- Earnings debug — raw fundamentals-timeseries response (no cache) ----
  if (mode === 'earnings-debug') {
    const symbol = req.nextUrl.searchParams.get('symbol') ?? 'AAPL';
    const results: Record<string, unknown> = {};

    // Get a fresh crumb session
    let cookie = '';
    try {
      const cookieRes = await fetch('https://fc.yahoo.com', {
        headers: { 'User-Agent': UA }, redirect: 'follow', cache: 'no-store',
      });
      const raw = cookieRes.headers.get('set-cookie') ?? '';
      const cookieMatch = raw.match(/^([A-Za-z0-9_]+=\S+?)(?=;|,|$)/);
      cookie = cookieMatch ? cookieMatch[1] : '';
    } catch { /* */ }

    let crumb = '';
    if (cookie) {
      try {
        const r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
          headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'text/plain,*/*' }, cache: 'no-store',
        });
        const text = (await r.text()).trim();
        if (text && !text.toLowerCase().includes('<!doctype')) crumb = text;
      } catch { /* */ }
    }
    results['auth'] = { cookieFound: !!cookie, crumbFound: !!crumb, crumbSnippet: crumb.slice(0, 20) };

    if (!crumb || !cookie) return NextResponse.json(results);

    const now = Math.floor(Date.now() / 1000);
    const period1 = now - 30 * 365 * 86_400;
    const period2 = now + 60 * 86_400;
    const types = 'quarterlyTotalRevenue,quarterlyNetIncome,quarterlyEpsActual';

    // Variant 1: current code
    for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
      const url = `https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
        + `?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${period1}&period2=${period2}`
        + `&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' }, cache: 'no-store',
        });
        const j = await r.json() as Record<string, unknown>;
        results[`timeseries-${host.split('.')[0]}`] = { status: r.status, sample: JSON.stringify(j).slice(0, 1200) };
      } catch (e) { results[`timeseries-${host.split('.')[0]}`] = { error: (e as Error).message }; }
    }

    // Variant 2: with corsDomain + padTimeSeries (what Yahoo's own site sends)
    {
      const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
        + `?lang=en-US&region=US&symbol=${encodeURIComponent(symbol)}&padTimeSeries=true`
        + `&type=${types}&merge=false&period1=${period1}&period2=${period2}`
        + `&corsDomain=finance.yahoo.com&crumb=${encodeURIComponent(crumb)}`;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' }, cache: 'no-store',
        });
        const j = await r.json() as Record<string, unknown>;
        results['timeseries-yahoo-format'] = { status: r.status, sample: JSON.stringify(j).slice(0, 1200) };
      } catch (e) { results['timeseries-yahoo-format'] = { error: (e as Error).message }; }
    }

    // Variant 3: quoteSummary with incomeStatementHistoryQuarterly (fallback path)
    {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
        + `?modules=incomeStatementHistoryQuarterly&crumb=${encodeURIComponent(crumb)}`;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' }, cache: 'no-store',
        });
        const j = await r.json() as Record<string, unknown>;
        results['incomeStatement-quoteSummary'] = { status: r.status, sample: JSON.stringify(j).slice(0, 1200) };
      } catch (e) { results['incomeStatement-quoteSummary'] = { error: (e as Error).message }; }
    }

    return NextResponse.json(results);
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
