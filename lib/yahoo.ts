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
  adjPoints?: ChartPoint[];
  dividends?: { date: string; amount: number }[];
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
  // Yahoo switched from B= to A3= cookies; extract first name=value pair regardless of name
  const cookieMatch = raw.match(/^([A-Za-z0-9_]+=\S+?)(?=;|,|$)/);
  const cookie = cookieMatch ? cookieMatch[1] : '';

  if (!cookie) throw new Error('[yahoo] fc.yahoo.com set no cookie');

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

// No-auth version — try query2 first (less blocked on Vercel Edge), then query1
async function fetchChartRawNoAuth(
  symbol: string,
  query: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com/',
        },
      }, timeoutMs);
      if (!res.ok) continue;
      const json = await res.json();
      const result = json?.chart?.result?.[0] ?? null;
      if (result) return result;
    } catch {
      // try next host
    }
  }
  return null;
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

function daysToRangeParam(daysAgo: number): string | null {
  if (daysAgo > 5000) return 'max'; // MAX timeframe fallback
  if (daysAgo > 2900) return '10y';
  if (daysAgo > 1500) return '5y';
  if (daysAgo > 800)  return '3y';
  if (daysAgo > 300)  return '1y';
  if (daysAgo > 140)  return '6mo';
  if (daysAgo > 60)   return '3mo';
  if (daysAgo > 20)   return '1mo';
  return null;
}

export async function fetchYahooData(
  symbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
  includeEvents = false,
): Promise<YahooData> {
  const period1 = Math.floor(from.getTime() / 1000);
  const period2 = Math.floor(to.getTime() / 1000);
  const eventsQ = includeEvents ? '&events=div%2Csplit' : '';

  // Yahoo Finance does not handle negative period1 (dates before 1970-01-01) correctly
  // and silently returns a short window instead of all history. Use range=max directly.
  let result: Record<string, unknown> | null = null;
  if (period1 < 0) {
    result = await fetchChartRaw(symbol, `range=max&interval=${interval}${eventsQ}`, 10_000);
  } else {
    result = await fetchChartRaw(
      symbol,
      `period1=${period1}&period2=${period2}&interval=${interval}${eventsQ}`,
      8_000,
    );
    // If period-based query failed (common for futures on Vercel Edge), try range-based
    if (!result) {
      const daysAgo = (Date.now() - from.getTime()) / (1000 * 60 * 60 * 24);
      const rangeStr = daysToRangeParam(daysAgo);
      if (rangeStr) {
        result = await fetchChartRaw(symbol, `range=${rangeStr}&interval=${interval}${eventsQ}`, 8_000);
      }
    }
  }

  if (!result) return { meta: null, points: [], dividends: [] };

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
  // adjclose is split + dividend adjusted — the correct total-return price.
  const adjCloses: number[] =
    ((indicators?.adjclose as Array<Record<string, unknown>> | undefined)?.[0]?.adjclose as number[]) ?? [];

  const points: ChartPoint[] = [];
  const adjPoints: ChartPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || isNaN(close) || close <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    points.push({ date, close });
    const adj = adjCloses[i];
    if (adj != null && isFinite(adj) && adj > 0) adjPoints.push({ date, close: adj });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  adjPoints.sort((a, b) => a.date.localeCompare(b.date));

  // Extract dividend events when requested
  let dividends: { date: string; amount: number }[] | undefined;
  if (includeEvents) {
    dividends = [];
    const events = result.events as Record<string, unknown> | undefined;
    const divs = events?.dividends as Record<string, { amount?: number; date?: number }> | undefined;
    if (divs) {
      for (const k of Object.keys(divs)) {
        const ev = divs[k];
        const amt = Number(ev?.amount);
        const ts = Number(ev?.date);
        if (isFinite(amt) && amt > 0 && isFinite(ts) && ts > 0) {
          const date = new Date(ts * 1000).toISOString().slice(0, 10);
          dividends.push({ date, amount: amt });
        }
      }
      dividends.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return { meta, points, adjPoints: adjPoints.length > 0 ? adjPoints : undefined, dividends };
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
  // range=1y&interval=1d: daily closes — second-to-last is yesterday's close
  // (chartPreviousClose is the start-of-range value, NOT the previous trading day).
  const result = await fetchChartRaw(symbol, 'range=1y&interval=1d', 5_000);
  if (!result) return null;

  const m = (result.meta as Record<string, unknown> | undefined) ?? {};
  const price = Number(m.regularMarketPrice) || 0;
  if (price <= 0) return null;

  const indicators = result.indicators as Record<string, unknown> | undefined;
  const quotes = indicators?.quote as Array<Record<string, unknown>> | undefined;
  const closes = (quotes?.[0]?.close as (number | null)[] | undefined) ?? [];
  const validCloses = closes.filter((c): c is number => c != null && c > 0);

  let prev = 0;
  if (validCloses.length >= 2) {
    prev = validCloses[validCloses.length - 2];
  } else {
    prev = Number(m.previousClose) || Number(m.chartPreviousClose) || 0;
  }
  if (prev <= 0) return null;

  const changePercent = ((price - prev) / prev) * 100;
  const change = price - prev;

  let fiftyTwoWeekChangePercent: number | null = null;
  const firstValid = validCloses[0];
  if (firstValid && firstValid > 0) {
    fiftyTwoWeekChangePercent = ((price - firstValid) / firstValid) * 100;
  }

  return {
    symbol,
    name: (m.shortName as string) ?? (m.longName as string) ?? symbol,
    price,
    previousClose: prev,
    change,
    changePercent,
    currency: (m.currency as string) ?? 'USD',
    high52w: (m.fiftyTwoWeekHigh as number) ?? null,
    low52w: (m.fiftyTwoWeekLow as number) ?? null,
    fiftyTwoWeekChangePercent,
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

// No-auth path: v8/chart with range=1y&interval=1d gives daily closes — the
// previous trading day's close is closes[length-2], from which we can compute
// the actual daily % change correctly. The first valid close in the array
// gives the 1Y reference price.
async function fetchQuoteNoAuth(symbol: string): Promise<YahooQuote | null> {
  const url =
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1y&interval=1d&includePrePost=false`;
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
    if (price <= 0) return null;

    const indicators = result.indicators as Record<string, unknown> | undefined;
    const quotes = indicators?.quote as Array<Record<string, unknown>> | undefined;
    const closes = (quotes?.[0]?.close as (number | null)[] | undefined) ?? [];
    const validCloses = closes.filter((c): c is number => c != null && c > 0);

    // Daily %: previous trading day's close = second-to-last valid close
    // (last close == today, which equals regularMarketPrice during/after trading)
    let prev = 0;
    if (validCloses.length >= 2) {
      prev = validCloses[validCloses.length - 2];
    } else {
      prev = Number(m.previousClose) || Number(m.chartPreviousClose) || 0;
    }
    const changePercent = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    const change = prev > 0 ? price - prev : 0;

    // 1Y change: from first valid daily close (about 252 trading days ago)
    let fiftyTwoWeekChangePercent: number | null = null;
    const firstValid = validCloses[0];
    if (firstValid && firstValid > 0) {
      fiftyTwoWeekChangePercent = ((price - firstValid) / firstValid) * 100;
    }

    return {
      symbol,
      name: (m.shortName as string) ?? (m.longName as string) ?? symbol,
      price,
      previousClose: prev,
      change,
      changePercent,
      currency: (m.currency as string) ?? 'USD',
      high52w: (m.fiftyTwoWeekHigh as number) ?? null,
      low52w: (m.fiftyTwoWeekLow as number) ?? null,
      fiftyTwoWeekChangePercent,
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

// v7 batch WITHOUT crumb — single request, correct % from Yahoo directly.
// query2 subdomain often passes Vercel Edge without auth.
async function fetchQuotesV7NoAuth(symbols: string[]): Promise<YahooQuote[]> {
  const url =
    `https://query2.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(','))}&formatted=false&lang=en-US&region=US`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
    }, 8_000);
    if (!res.ok) return [];
    const json = await res.json() as { quoteResponse?: { result?: Record<string, unknown>[] } };
    const items = json?.quoteResponse?.result ?? [];
    if (!items.length) return [];
    return items.map(it => {
      const price    = Number(it.regularMarketPrice) || 0;
      const prevClose = Number(it.regularMarketPreviousClose) || 0;
      // Compute daily change from price/previousClose — Yahoo's pre-computed
      // regularMarketChangePercent from query2 without auth can return YTD or
      // year-over-year change instead of the actual daily change.
      const change        = prevClose > 0 ? price - prevClose : Number(it.regularMarketChange) || 0;
      const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100
                                          : Number(it.regularMarketChangePercent) || 0;
      return {
        symbol:    (it.symbol as string) ?? '',
        name:      (it.shortName as string) ?? (it.longName as string) ?? (it.symbol as string) ?? '',
        price,
        previousClose: prevClose,
        change,
        changePercent,
        currency:  (it.currency as string) ?? 'USD',
        high52w:   it.fiftyTwoWeekHigh != null ? Number(it.fiftyTwoWeekHigh) : null,
        low52w:    it.fiftyTwoWeekLow  != null ? Number(it.fiftyTwoWeekLow)  : null,
        fiftyTwoWeekChangePercent:
          it.fiftyTwoWeekChangePercent != null
            ? Number(it.fiftyTwoWeekChangePercent) * 100
            : null,
        trailingPE: it.trailingPE != null ? Number(it.trailingPE) : null,
        forwardPE:  it.forwardPE  != null ? Number(it.forwardPE)  : null,
        marketCap:  it.marketCap  != null ? Number(it.marketCap)  : null,
        volume:     it.regularMarketVolume != null ? Number(it.regularMarketVolume) : null,
      };
    }).filter(q => q.price > 0);
  } catch {
    return [];
  }
}

export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuote[]> {
  if (symbols.length === 0) return [];

  // v7 no-auth (query2) returns corrupted regularMarketPreviousClose (year-ago value)
  // for indices, making daily % wrong. Use per-symbol v8/chart instead — its
  // meta.regularMarketChangePercent is always the accurate daily change.

  // 1. v8/chart per-symbol without auth — accurate daily % from chart meta
  const noAuth = await fetchQuotesNoAuth(symbols);
  if (noAuth.length > 0) {
    console.log(`[yahoo] v8-noauth OK: ${noAuth.length}/${symbols.length}`);
    return noAuth;
  }

  // 2. v7 batch with crumb auth
  console.warn('[yahoo] v8-noauth empty — trying v7 with crumb');
  const v7 = await fetchQuotesV7(symbols);
  if (v7.length > 0) return v7;

  // 3. v8/chart per-symbol with crumb auth
  console.warn('[yahoo] v7 empty — trying v8 with crumb');
  return fetchQuotesV8Fallback(symbols);
}

// ---------------------------------------------------------------------------
// Earnings (quarterly EPS history) via Yahoo quoteSummary
// ---------------------------------------------------------------------------

export interface YahooEarningsPoint {
  date: string;        // YYYY-MM-DD (quarter end)
  period: string;      // "3Q2024" or "2024-09-30"
  eps: number;         // actual EPS
  estimate?: number;   // EPS estimate (if available)
}

export interface YahooFinancialQuarter {
  date: string;             // YYYY-MM-DD (period end)
  revenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  eps?: number;
  epsEstimate?: number;
  isAnnual?: boolean;       // true for full-year income statements (not quarterly)
}

export interface YahooEarnings {
  quarterly: YahooEarningsPoint[];
  financials: YahooFinancialQuarter[];
  currency: string;
}

function quarterToEndDate(periodStr: string): string | null {
  const m = periodStr.match(/^(\d)Q(\d{4})$/);
  if (!m) return null;
  const q = parseInt(m[1]);
  const y = parseInt(m[2]);
  if (!(q >= 1 && q <= 4) || !y) return null;
  const endMonth = q * 3;
  const endDay = endMonth === 6 || endMonth === 9 ? 30 : 31;
  return `${y}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
}

interface QuoteSummaryRoot {
  quoteSummary?: { result?: Array<Record<string, unknown>> };
}

async function fetchQuoteSummary(
  symbol: string,
  modules: string,
  timeoutMs = 8_000,
): Promise<Record<string, unknown> | null> {
  // v11 no-auth is always 404; v10 returns 401 "Invalid Crumb" — requires crumb auth.
  // Fetch crumb first, then try v10 on query2 and query1 with crumb + cookie.
  let s: CrumbSession;
  try { s = await getSession(); } catch (e) {
    console.warn('[quoteSummary] crumb fetch failed:', (e as Error).message);
    return null;
  }

  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
      + `?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(s.crumb)}`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' },
      }, timeoutMs);
      if (res.status === 401 || res.status === 403) {
        // Crumb expired — refresh once and retry on the same host
        session = null;
        try { s = await getSession(); } catch { return null; }
        const retry = await fetchWithTimeout(
          `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
          + `?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(s.crumb)}`,
          { headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' } },
          timeoutMs,
        );
        if (!retry.ok) continue;
        const json = await retry.json() as QuoteSummaryRoot;
        const result = json?.quoteSummary?.result?.[0];
        if (result) return result;
        continue;
      }
      if (!res.ok) continue;
      const json = await res.json() as QuoteSummaryRoot;
      const result = json?.quoteSummary?.result?.[0];
      if (result) return result;
    } catch { /* try next host */ }
  }
  return null;
}

// fundamentals-timeseries returns 20+ years of quarterly metrics with crumb auth.
// Used for the long EPS history + revenue/costs/profit.
const FUNDAMENTALS_TYPES = [
  'quarterlyTotalRevenue',
  'quarterlyCostOfRevenue',
  'quarterlyGrossProfit',
  'quarterlyOperatingIncome',
  'quarterlyNetIncome',
  'quarterlyEpsActual',
  'quarterlyEpsEstimate',
  'quarterlyDilutedEPS',
  'quarterlyBasicEPS',
] as const;

type FundamentalEntry = {
  asOfDate?: string;
  currencyCode?: string;
  reportedValue?: { raw?: number };
};

async function fetchFundamentalsTimeseries(
  symbol: string,
  timeoutMs = 10_000,
): Promise<{ byType: Record<string, FundamentalEntry[]>; currency: string } | null> {
  let s: CrumbSession;
  try { s = await getSession(); }
  catch (e) {
    console.warn(`[fundamentals] ${symbol}: crumb fetch failed:`, (e as Error).message);
    return null;
  }

  // 30 years back is enough for any public company; period2 future-proofs against clock skew.
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 30 * 365 * 86_400;
  const period2 = now + 60 * 86_400;
  // Yahoo expects literal commas in the type parameter — do NOT encodeURIComponent the whole string.
  const typeParam = FUNDAMENTALS_TYPES.join(',');

  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    const buildUrl = (crumb: string) =>
      `https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
      + `?symbol=${encodeURIComponent(symbol)}`
      + `&type=${typeParam}`           // commas must be literal, not %2C
      + `&period1=${period1}&period2=${period2}`
      + `&lang=en-US&region=US`
      + `&crumb=${encodeURIComponent(crumb)}`;
    try {
      let res = await fetchWithTimeout(buildUrl(s.crumb), {
        headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' },
      }, timeoutMs);
      if (res.status === 401 || res.status === 403) {
        session = null;
        try { s = await getSession(); } catch { continue; }
        res = await fetchWithTimeout(buildUrl(s.crumb), {
          headers: { 'User-Agent': UA, 'Cookie': s.cookie, 'Accept': 'application/json' },
        }, timeoutMs);
      }
      if (!res.ok) {
        console.warn(`[fundamentals] ${symbol} ${host}: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json() as {
        timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> };
      };
      const results = json?.timeseries?.result;
      if (!Array.isArray(results) || results.length === 0) {
        console.warn(`[fundamentals] ${symbol} ${host}: empty result array`);
        continue;
      }
      const byType: Record<string, FundamentalEntry[]> = {};
      let currency = 'USD';
      for (const r of results) {
        const type = r?.meta?.type?.[0];
        if (!type) continue;
        const arr = r[type];
        if (!Array.isArray(arr)) continue;
        const entries = arr.filter((e): e is FundamentalEntry => e && typeof e === 'object');
        if (entries.length === 0) continue;
        byType[type] = entries;
        const c = entries.find(e => e.currencyCode)?.currencyCode;
        if (c) currency = c;
      }
      if (Object.keys(byType).length === 0) {
        console.warn(`[fundamentals] ${symbol} ${host}: result array has no recognizable types`);
        continue;
      }
      const quarterCount = byType['quarterlyEpsActual']?.length ?? byType['quarterlyTotalRevenue']?.length ?? 0;
      console.log(`[fundamentals] ${symbol} ${host}: ${quarterCount} quarters, types: ${Object.keys(byType).join(',')}`);
      return { byType, currency };
    } catch (e) {
      console.warn(`[fundamentals] ${symbol} ${host} failed:`, (e as Error).message);
    }
  }
  return null;
}

function buildFinancialsFromTimeseries(
  data: { byType: Record<string, FundamentalEntry[]>; currency: string },
): { financials: YahooFinancialQuarter[]; epsPoints: YahooEarningsPoint[] } {
  const byDate = new Map<string, YahooFinancialQuarter>();
  const mapField: Record<string, keyof YahooFinancialQuarter> = {
    quarterlyTotalRevenue: 'revenue',
    quarterlyCostOfRevenue: 'costOfRevenue',
    quarterlyGrossProfit: 'grossProfit',
    quarterlyOperatingIncome: 'operatingIncome',
    quarterlyNetIncome: 'netIncome',
    quarterlyEpsActual: 'eps',
    quarterlyEpsEstimate: 'epsEstimate',
  };
  for (const [type, entries] of Object.entries(data.byType)) {
    const field = mapField[type];
    if (!field) continue;
    for (const e of entries) {
      const date = e?.asOfDate;
      const value = e?.reportedValue?.raw;
      if (typeof date === 'string' && typeof value === 'number' && isFinite(value)) {
        const existing = byDate.get(date) ?? { date, isAnnual: false };
        (existing as unknown as Record<string, unknown>)[field] = value;
        byDate.set(date, existing);
      }
    }
  }

  // Fallback EPS: if epsActual missing for a quarter, use dilutedEPS, then basicEPS.
  for (const fallback of ['quarterlyDilutedEPS', 'quarterlyBasicEPS']) {
    const entries = data.byType[fallback] ?? [];
    for (const e of entries) {
      const date = e?.asOfDate;
      const value = e?.reportedValue?.raw;
      if (typeof date === 'string' && typeof value === 'number' && isFinite(value)) {
        const existing = byDate.get(date) ?? { date };
        if (existing.eps == null) existing.eps = value;
        byDate.set(date, existing);
      }
    }
  }

  const financials = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const epsPoints: YahooEarningsPoint[] = financials
    .filter(q => q.eps != null)
    .map(q => ({ date: q.date, period: q.date, eps: q.eps as number, estimate: q.epsEstimate }));
  return { financials, epsPoints };
}

export async function fetchYahooEarnings(symbol: string): Promise<YahooEarnings | null> {
  // Run both sources in parallel.
  const [tsData, qsResult] = await Promise.all([
    fetchFundamentalsTimeseries(symbol).catch(() => null),
    fetchQuoteSummary(
      symbol,
      'earnings,earningsHistory,incomeStatementHistoryQuarterly,incomeStatementHistory',
    ).catch(() => null),
  ]);

  const epsMap = new Map<string, YahooEarningsPoint>();
  const financialsMap = new Map<string, YahooFinancialQuarter>();
  let currency = 'USD';
  const today = new Date().toISOString().slice(0, 10);

  // 1. Seed from fundamentals-timeseries (past quarters only — strips forward estimates)
  if (tsData) {
    const { financials: tsFinancials, epsPoints: tsEps } = buildFinancialsFromTimeseries(tsData);
    currency = tsData.currency;
    for (const ep of tsEps) {
      if (ep.date <= today) epsMap.set(ep.date, ep);
    }
    for (const f of tsFinancials) {
      if (f.date <= today) financialsMap.set(f.date, f);
    }
  }

  if (qsResult) {
    type RV = { raw?: number };
    type IsEntry = {
      endDate?: { raw?: number; fmt?: string };
      totalRevenue?: RV;
      costOfRevenue?: RV;
      grossProfit?: RV;
      operatingIncome?: RV;
      netIncome?: RV;
      dilutedEPS?: RV;
      basicEPS?: RV;
    };

    // 2. Annual income statement — 4 fiscal years of revenue/costs/profit + diluted EPS
    const annualIs = (qsResult.incomeStatementHistory as { incomeStatementHistory?: IsEntry[] } | undefined)
      ?.incomeStatementHistory ?? [];
    for (const e of annualIs) {
      const rawTs = e?.endDate?.raw;
      const date = rawTs != null
        ? new Date(rawTs * 1000).toISOString().slice(0, 10)
        : e?.endDate?.fmt ?? null;
      if (!date || date > today) continue;
      // Financials: only set if not already present (don't clobber quarterly with annual)
      if (!financialsMap.has(date)) {
        financialsMap.set(date, {
          date,
          revenue: e?.totalRevenue?.raw,
          costOfRevenue: e?.costOfRevenue?.raw,
          grossProfit: e?.grossProfit?.raw,
          operatingIncome: e?.operatingIncome?.raw,
          netIncome: e?.netIncome?.raw,
          isAnnual: true,
        });
      }
      // Annual EPS — prefer diluted, fall back to basic. Only add if no quarterly entry exists.
      const annualEps = e?.dilutedEPS?.raw ?? e?.basicEPS?.raw;
      if (typeof annualEps === 'number' && isFinite(annualEps) && !epsMap.has(date)) {
        epsMap.set(date, { date, period: `FY ${date.slice(0, 4)}`, eps: annualEps });
      }
    }

    // 3. Quarterly income statement — 4 most recent quarters of revenue/costs/profit + diluted EPS
    const quarterlyIs = (qsResult.incomeStatementHistoryQuarterly as { incomeStatementHistory?: IsEntry[] } | undefined)
      ?.incomeStatementHistory ?? [];
    for (const e of quarterlyIs) {
      const rawTs = e?.endDate?.raw;
      const date = rawTs != null
        ? new Date(rawTs * 1000).toISOString().slice(0, 10)
        : e?.endDate?.fmt ?? null;
      if (!date || date > today) continue;
      const existing = financialsMap.get(date) ?? { date };
      financialsMap.set(date, {
        ...existing,
        date,
        isAnnual: false, // confirmed quarterly by incomeStatementHistoryQuarterly
        revenue: e?.totalRevenue?.raw ?? existing.revenue,
        costOfRevenue: e?.costOfRevenue?.raw ?? existing.costOfRevenue,
        grossProfit: e?.grossProfit?.raw ?? existing.grossProfit,
        operatingIncome: e?.operatingIncome?.raw ?? existing.operatingIncome,
        netIncome: e?.netIncome?.raw ?? existing.netIncome,
      });
      // Quarterly diluted EPS — supplements earningsHistory
      const qEps = e?.dilutedEPS?.raw ?? e?.basicEPS?.raw;
      if (typeof qEps === 'number' && isFinite(qEps) && !epsMap.has(date)) {
        epsMap.set(date, { date, period: date, eps: qEps });
      }
    }

    // 4. earnings module — financialsChart provides another source of revenue + net income
    type FChartEntry = { date?: number | string; revenue?: RV; earnings?: RV };
    const earningsModule = qsResult.earnings as {
      earningsChart?: { quarterly?: Array<{ date?: string; actual?: RV; estimate?: RV }> };
      financialsChart?: { yearly?: FChartEntry[]; quarterly?: FChartEntry[] };
      financialCurrency?: string;
    } | undefined;
    if (earningsModule?.financialCurrency) currency = earningsModule.financialCurrency;

    // Annual revenue + earnings (net income) from financialsChart.yearly.
    // date is the fiscal year number (e.g. 2024 for FY2024).
    for (const y of earningsModule?.financialsChart?.yearly ?? []) {
      const yr = typeof y.date === 'number' ? y.date : Number(y.date);
      if (!Number.isInteger(yr) || yr < 1990 || yr > 2100) continue;
      // Anchor annual financials at Dec 31 of fiscal year unless we already have a fiscal-year-end entry
      const anchorDate = `${yr}-12-31`;
      if (anchorDate > today) continue;
      // Skip if we already have an entry in this calendar year (probably the fiscal year end from incomeStatementHistory)
      const hasYearEntry = Array.from(financialsMap.keys()).some(d => d.startsWith(`${yr}-`));
      if (!hasYearEntry) {
        financialsMap.set(anchorDate, {
          date: anchorDate,
          revenue: y.revenue?.raw,
          netIncome: y.earnings?.raw,
          isAnnual: true,
        });
      }
    }

    // Quarterly revenue + earnings from financialsChart.quarterly — fills gaps in incomeStatementHistoryQuarterly
    for (const q of earningsModule?.financialsChart?.quarterly ?? []) {
      const periodStr = typeof q.date === 'string' ? q.date : '';
      if (!periodStr) continue;
      const date = quarterToEndDate(periodStr);
      if (!date || date > today) continue;
      const existing = financialsMap.get(date) ?? { date };
      financialsMap.set(date, {
        ...existing,
        date,
        isAnnual: false, // confirmed quarterly by financialsChart
        revenue: existing.revenue ?? q.revenue?.raw,
        netIncome: existing.netIncome ?? q.earnings?.raw,
      });
    }

    // 5. earningsHistory — authoritative quarterly EPS actuals (overwrites timeseries/income-statement EPS)
    type HistEntry = { quarter?: RV; epsActual?: RV; epsEstimate?: RV };
    const hist = (qsResult.earningsHistory as { history?: HistEntry[] } | undefined)?.history ?? [];
    for (const h of hist) {
      const rawTs = h?.quarter?.raw;
      const actual = h?.epsActual?.raw;
      const estimate = h?.epsEstimate?.raw;
      if (typeof rawTs === 'number' && typeof actual === 'number' && isFinite(actual)) {
        const date = new Date(rawTs * 1000).toISOString().slice(0, 10);
        if (date <= today) {
          epsMap.set(date, {
            date, period: date, eps: actual,
            estimate: typeof estimate === 'number' ? estimate : undefined,
          });
        }
      }
    }

    // 6. earningsChart.quarterly — backup quarterly EPS (in "3Q2025" format)
    for (const q of earningsModule?.earningsChart?.quarterly ?? []) {
      const periodStr = q?.date ?? '';
      const actual = q?.actual?.raw;
      const estimate = q?.estimate?.raw;
      if (typeof actual === 'number' && isFinite(actual)) {
        const date = quarterToEndDate(periodStr);
        if (date && date <= today && !epsMap.has(date)) {
          epsMap.set(date, {
            date, period: periodStr, eps: actual,
            estimate: typeof estimate === 'number' ? estimate : undefined,
          });
        }
      }
    }
  }

  const quarterly = Array.from(epsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const financials = Array.from(financialsMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  if (!quarterly.length && !financials.length) {
    console.warn(`[yahoo-earnings] ${symbol}: all sources returned no usable data`);
    return null;
  }
  const withRevenue = financials.filter(f => f.revenue != null).length;
  const withNetIncome = financials.filter(f => f.netIncome != null).length;
  console.log(`[yahoo-earnings] ${symbol}: ${quarterly.length} EPS / ${financials.length} fin (${withRevenue} w/ revenue, ${withNetIncome} w/ netIncome) / modules: ${Object.keys(qsResult ?? {}).join(',')}`);
  return { quarterly, financials, currency };
}
