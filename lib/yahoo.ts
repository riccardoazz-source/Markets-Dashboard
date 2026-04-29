import { ChartPoint } from './stooq';

export interface YahooMeta {
  price: number;
  previousClose: number;
  currency: string;
  high52w: number | null;
  low52w: number | null;
}

export interface YahooData {
  meta: YahooMeta | null;
  points: ChartPoint[];
}

export interface YahooQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  high52w: number | null;
  low52w: number | null;
  fiftyTwoWeekChangePercent: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  volume: number | null;
}

interface CrumbSession { cookie: string; crumb: string; ts: number }

const CRUMB_TTL = 25 * 60_000;
const SESSION_FAIL_TTL = 30_000; // don't retry crumb for 30s after failure

let session: CrumbSession | null = null;
let sessionPromise: Promise<CrumbSession> | null = null;
let sessionFailedAt = 0;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

async function fetchCrumb(): Promise<CrumbSession> {
  const cookieRes = await fetchWithTimeout(
    'https://fc.yahoo.com',
    { headers: { 'User-Agent': UA }, redirect: 'follow' },
    4_000,
  );
  const raw = cookieRes.headers.get('set-cookie') ?? '';
  const bMatch = raw.match(/\bB=([^;,\s]+)/);
  const cookie = bMatch ? `B=${bMatch[1]}` : '';

  const crumbRes = await fetchWithTimeout(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'text/plain,*/*' } },
    4_000,
  );
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.toLowerCase().includes('<!doctype')) {
    throw new Error('[yahoo] no crumb returned');
  }
  return { cookie, crumb, ts: Date.now() };
}

async function getSession(): Promise<CrumbSession> {
  if (session && Date.now() - session.ts < CRUMB_TTL) return session;
  // Hard cool-off after recent failure — don't re-hammer fc.yahoo.com
  if (Date.now() - sessionFailedAt < SESSION_FAIL_TTL) {
    throw new Error('[yahoo] session in cooldown');
  }
  if (sessionPromise) return sessionPromise;
  sessionPromise = fetchCrumb()
    .then(s => { session = s; return s; })
    .catch(e => { sessionFailedAt = Date.now(); throw e; })
    .finally(() => { sessionPromise = null; });
  return sessionPromise;
}

// ---------------------------------------------------------------------------
// Single chart fetch (used for historical + meta)
// ---------------------------------------------------------------------------

// No-auth version — try this first before the crumb dance
async function fetchChartRawNoAuth(
  symbol: string,
  query: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
    }, timeoutMs);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchChartRaw(
  symbol: string,
  query: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  // Try no-auth first
  const noAuth = await fetchChartRawNoAuth(symbol, query, timeoutMs);
  if (noAuth) return noAuth;

  // Fall back to crumb auth
  let s: CrumbSession;
  try { s = await getSession(); } catch { return null; }

  const buildUrl = (crumb: string) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?${query}&crumb=${encodeURIComponent(crumb)}`;

  try {
    let res = await fetchWithTimeout(
      buildUrl(s.crumb),
      { headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' } },
      timeoutMs,
    );
    if (res.status === 401 || res.status === 403) {
      session = null;
      try { s = await getSession(); } catch { return null; }
      res = await fetchWithTimeout(
        buildUrl(s.crumb),
        { headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' } },
        timeoutMs,
      );
    }
    if (!res.ok) {
      console.error(`[yahoo] ${symbol} HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json?.chart?.result?.[0] ?? null;
  } catch (e) {
    console.error(`[yahoo] ${symbol} chart failed:`, (e as Error).message);
    return null;
  }
}

export async function fetchYahooData(
  symbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<YahooData> {
  const period1 = Math.floor(from.getTime() / 1000);
  const period2 = Math.floor(to.getTime() / 1000);
  const result = await fetchChartRaw(
    symbol,
    `period1=${period1}&period2=${period2}&interval=${interval}`,
    8_000,
  );
  if (!result) return { meta: null, points: [] };

  const m = (result.meta as Record<string, number | string> | undefined) ?? {};
  const metaPrice = (m.regularMarketPrice as number) ?? 0;
  const metaPrev = (m.chartPreviousClose as number) ?? (m.previousClose as number) ?? 0;
  const meta: YahooMeta | null =
    metaPrice > 0 && metaPrev > 0
      ? {
          price: metaPrice,
          previousClose: metaPrev,
          currency: (m.currency as string) ?? 'USD',
          high52w: (m.fiftyTwoWeekHigh as number) ?? null,
          low52w: (m.fiftyTwoWeekLow as number) ?? null,
        }
      : null;

  const timestamps: number[] = (result.timestamp as number[]) ?? [];
  const indicators = result.indicators as Record<string, unknown> | undefined;
  const quotes = (indicators?.quote as Array<Record<string, unknown>> | undefined) ?? [];
  const closes: number[] = (quotes[0]?.close as number[]) ?? [];

  const points: ChartPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || isNaN(close) || close <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    points.push({ date, close });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { meta, points };
}

export async function fetchYahooChart(
  symbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<ChartPoint[]> {
  const { points } = await fetchYahooData(symbol, from, to, interval);
  return points;
}

// ---------------------------------------------------------------------------
// Batch quote — try v7 first, fall back to per-symbol v8 chart
// ---------------------------------------------------------------------------

async function fetchQuotesV7(symbols: string[]): Promise<YahooQuote[]> {
  let s: CrumbSession;
  try { s = await getSession(); } catch { return []; }

  const buildUrl = (crumb: string) =>
    `https://query1.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(','))}` +
    `&crumb=${encodeURIComponent(crumb)}`;

  try {
    let res = await fetchWithTimeout(
      buildUrl(s.crumb),
      { headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' } },
      5_000,
    );
    if (res.status === 401 || res.status === 403) {
      session = null;
      try { s = await getSession(); } catch { return []; }
      res = await fetchWithTimeout(
        buildUrl(s.crumb),
        { headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' } },
        5_000,
      );
    }
    if (!res.ok) {
      console.error(`[yahoo-v7] HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    const items: Record<string, unknown>[] = json?.quoteResponse?.result ?? [];
    return items.map(it => ({
      symbol: (it.symbol as string) ?? '',
      name:
        (it.shortName as string) ?? (it.longName as string) ?? (it.symbol as string) ?? '',
      price: (it.regularMarketPrice as number) ?? 0,
      previousClose: (it.regularMarketPreviousClose as number) ?? 0,
      change: (it.regularMarketChange as number) ?? 0,
      changePercent: (it.regularMarketChangePercent as number) ?? 0,
      currency: (it.currency as string) ?? 'USD',
      high52w: (it.fiftyTwoWeekHigh as number) ?? null,
      low52w: (it.fiftyTwoWeekLow as number) ?? null,
      fiftyTwoWeekChangePercent:
        (it.fiftyTwoWeekChangePercent as number) != null
          ? (it.fiftyTwoWeekChangePercent as number) * 100
          : null,
      trailingPE: (it.trailingPE as number) ?? null,
      forwardPE: (it.forwardPE as number) ?? null,
      marketCap: (it.marketCap as number) ?? null,
      volume: (it.regularMarketVolume as number) ?? null,
    }));
  } catch (e) {
    console.error('[yahoo-v7] fetch failed:', (e as Error).message);
    return [];
  }
}

async function fetchQuoteV8(symbol: string): Promise<YahooQuote | null> {
  // Tiny payload: just last day, gives us meta which has everything we need
  const result = await fetchChartRaw(symbol, 'range=1d&interval=1d', 4_000);
  if (!result) return null;

  const m = (result.meta as Record<string, number | string> | undefined) ?? {};
  const price = (m.regularMarketPrice as number) ?? 0;
  const prev = (m.chartPreviousClose as number) ?? (m.previousClose as number) ?? 0;
  if (price <= 0 || prev <= 0) return null;

  return {
    symbol,
    name: (m.shortName as string) ?? (m.longName as string) ?? symbol,
    price,
    previousClose: prev,
    change: price - prev,
    changePercent: ((price - prev) / prev) * 100,
    currency: (m.currency as string) ?? 'USD',
    high52w: (m.fiftyTwoWeekHigh as number) ?? null,
    low52w: (m.fiftyTwoWeekLow as number) ?? null,
    fiftyTwoWeekChangePercent: null,
    trailingPE: null,
    forwardPE: null,
    marketCap: null,
    volume: (m.regularMarketVolume as number) ?? null,
  };
}

async function fetchQuotesV8Fallback(symbols: string[]): Promise<YahooQuote[]> {
  const results: YahooQuote[] = [];
  const BATCH = 5;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const r = await Promise.all(batch.map(s => fetchQuoteV8(s)));
    for (const q of r) if (q) results.push(q);
  }
  return results;
}

// No-auth path: v8/chart with browser-like headers but no cookie/crumb.
// Works from Cloudflare Edge IPs even when cookie-based auth is blocked.
async function fetchQuoteNoAuth(symbol: string): Promise<YahooQuote | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1d&interval=1d&includePrePost=false`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
      },
    }, 6_000);
    if (!res.ok) return null;
    const json = await res.json() as { chart?: { result?: unknown[] } };
    const result = json?.chart?.result?.[0] as Record<string, unknown> | undefined;
    if (!result) return null;
    const m = (result.meta as Record<string, unknown>) ?? {};
    const price = Number(m.regularMarketPrice) || 0;
    const prev = Number(m.chartPreviousClose) || Number(m.previousClose) || 0;
    if (price <= 0) return null;
    return {
      symbol,
      name: (m.shortName as string) ?? (m.longName as string) ?? symbol,
      price,
      previousClose: prev || price,
      change: price - prev,
      changePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0,
      currency: (m.currency as string) ?? 'USD',
      high52w: (m.fiftyTwoWeekHigh as number) ?? null,
      low52w: (m.fiftyTwoWeekLow as number) ?? null,
      fiftyTwoWeekChangePercent: null,
      trailingPE: null,
      forwardPE: null,
      marketCap: null,
      volume: (m.regularMarketVolume as number) ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchQuotesNoAuth(symbols: string[]): Promise<YahooQuote[]> {
  const results: YahooQuote[] = [];
  const BATCH = 10;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const r = await Promise.all(batch.map(s => fetchQuoteNoAuth(s)));
    for (const q of r) if (q) results.push(q);
  }
  return results;
}

export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuote[]> {
  if (symbols.length === 0) return [];

  // 1. Try v7 batch with crumb (fastest — one request for all symbols)
  const v7 = await fetchQuotesV7(symbols);
  if (v7.length > 0) return v7;

  // 2. Try v8/chart without any auth (works from Cloudflare Edge IPs)
  console.warn('[yahoo] v7 empty — trying no-auth v8/chart');
  const noAuth = await fetchQuotesNoAuth(symbols);
  if (noAuth.length > 0) {
    console.log(`[yahoo] no-auth OK: ${noAuth.length}/${symbols.length}`);
    return noAuth;
  }

  // 3. Try v8/chart per-symbol with crumb auth
  console.warn('[yahoo] no-auth empty — falling back to v8 with crumb');
  return fetchQuotesV8Fallback(symbols);
}
