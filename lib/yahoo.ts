import { ChartPoint } from './stooq';

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
  // Step 1: hit fc.yahoo.com to get the B= consent cookie
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });

  const raw = cookieRes.headers.get('set-cookie') ?? '';
  const bMatch = raw.match(/\bB=([^;,\s]+)/);
  const cookie = bMatch ? `B=${bMatch[1]}` : '';

  // Step 2: exchange the cookie for a crumb
  const crumbRes = await fetch(
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: {
        'User-Agent': UA,
        'Cookie': cookie,
        'Accept': 'text/plain,*/*',
      },
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

export async function fetchYahooChart(
  symbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<ChartPoint[]> {
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

    // Crumb expired — refresh once and retry
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
      return [];
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      console.warn(`[yahoo] ${symbol} no result in response`);
      return [];
    }

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

    const points: ChartPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || isNaN(close) || close <= 0) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      points.push({ date, close });
    }

    return points.sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.error(`[yahoo] ${symbol} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
