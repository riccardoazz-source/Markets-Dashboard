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

interface CrumbSession {
  cookie: string;
  crumb: string;
  ts: number;
}

const CRUMB_TTL = 25 * 60_000;
let session: CrumbSession | null = null;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchCrumb(): Promise<CrumbSession> {
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });

  const raw = cookieRes.headers.get('set-cookie') ?? '';
  const bMatch = raw.match(/\bB=([^;,\s]+)/);
  const cookie = bMatch ? `B=${bMatch[1]}` : '';

  const crumbRes = await fetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'text/plain,*/*' },
      cache: 'no-store',
    },
  );

  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.toLowerCase().includes('<!doctype')) {
    throw new Error('[yahoo] failed to obtain crumb');
  }

  return { cookie, crumb, ts: Date.now() };
}

async function getSession(): Promise<CrumbSession> {
  if (session && Date.now() - session.ts < CRUMB_TTL) return session;
  session = await fetchCrumb();
  return session;
}

export async function fetchYahooData(
  symbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<YahooData> {
  let { cookie, crumb } = await getSession();

  const period1 = Math.floor(from.getTime() / 1000);
  const period2 = Math.floor(to.getTime() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=${interval}` +
    `&crumb=${encodeURIComponent(crumb)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);

  try {
    let res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });

    if (res.status === 401 || res.status === 403) {
      session = null;
      ({ cookie, crumb } = await getSession());
      const retryUrl = url.replace(/crumb=[^&]+/, `crumb=${encodeURIComponent(crumb)}`);
      res = await fetch(retryUrl, {
        headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' },
        cache: 'no-store',
      });
    }

    if (!res.ok) {
      console.error(`[yahoo] ${symbol} HTTP ${res.status}`);
      return { meta: null, points: [] };
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      console.warn(`[yahoo] ${symbol} no chart result`);
      return { meta: null, points: [] };
    }

    // Meta: use Yahoo's own previousClose — immune to dividend-adjusted distortions
    const m = result.meta ?? {};
    const metaPrice: number = m.regularMarketPrice ?? 0;
    const metaPrev: number = m.chartPreviousClose ?? m.previousClose ?? 0;
    const meta: YahooMeta | null =
      metaPrice > 0 && metaPrev > 0
        ? {
            price: metaPrice,
            previousClose: metaPrev,
            currency: m.currency ?? 'USD',
            high52w: m.fiftyTwoWeekHigh ?? null,
            low52w: m.fiftyTwoWeekLow ?? null,
          }
        : null;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

    const points: ChartPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || isNaN(close) || close <= 0) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      points.push({ date, close });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));

    return { meta, points };
  } catch (e) {
    console.error(`[yahoo] ${symbol} fetch failed:`, (e as Error).message);
    return { meta: null, points: [] };
  } finally {
    clearTimeout(timer);
  }
}

// Convenience wrapper — callers that only need points
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
// Batch quote endpoint — like CoinGecko's /markets, returns N symbols in ONE
// request with price, day change, 52w change, P/E, etc.
// ---------------------------------------------------------------------------

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

export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuote[]> {
  if (symbols.length === 0) return [];

  let { cookie, crumb } = await getSession();

  const buildUrl = (c: string) =>
    `https://query1.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(','))}` +
    `&crumb=${encodeURIComponent(c)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);

  try {
    let res = await fetch(buildUrl(crumb), {
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });

    if (res.status === 401 || res.status === 403) {
      session = null;
      ({ cookie, crumb } = await getSession());
      res = await fetch(buildUrl(crumb), {
        headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' },
        cache: 'no-store',
      });
    }

    if (!res.ok) {
      console.error(`[yahoo-batch] HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    const items: Record<string, unknown>[] = json?.quoteResponse?.result ?? [];

    return items.map((it) => ({
      symbol: (it.symbol as string) ?? '',
      name:
        (it.shortName as string) ??
        (it.longName as string) ??
        (it.symbol as string) ??
        '',
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
    console.error('[yahoo-batch] fetch failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
