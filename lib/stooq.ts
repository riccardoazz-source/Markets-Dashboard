import { format } from 'date-fns';

export interface ChartPoint {
  date: string;
  close: number;
}

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number | null;
  previousClose: number | null;
  change: number;
  changePercent: number;
  currency: string;
  high52w: number | null;
  low52w: number | null;
  volume: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
}

const HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/csv,text/plain,*/*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': 'https://stooq.com/',
};

const INDEX_MAP: Record<string, string> = {
  '^GSPC':     '^spx',
  '^NDX':      '^ndx',
  '^DJI':      '^dji',
  '^RUT':      '^rut',
  '^STOXX50E': '^stx50',
  '^GDAXI':    '^dax',
  '^FTSE':     '^ftm',
  '^FCHI':     '^cac',
  '^N225':     '^nkx',
};

const COMMODITY_MAP: Record<string, string> = {
  'GC=F': 'gc.f', 'SI=F': 'si.f', 'PL=F': 'pl.f',
  'CL=F': 'cl.f', 'BZ=F': 'cb.f', 'NG=F': 'ng.f',
  'HG=F': 'hg.f', 'ZW=F': 'zw.f', 'ZC=F': 'zc.f',
};

export function toStooqSymbol(yahooSymbol: string): string {
  if (INDEX_MAP[yahooSymbol]) return INDEX_MAP[yahooSymbol];
  if (COMMODITY_MAP[yahooSymbol]) return COMMODITY_MAP[yahooSymbol];
  if (yahooSymbol.endsWith('=F')) return yahooSymbol.replace('=F', '').toLowerCase() + '.f';
  if (yahooSymbol.endsWith('-USD')) return yahooSymbol.replace('-USD', '').toLowerCase() + 'usd';
  return yahooSymbol.toLowerCase() + '.us';
}

function parseStooqCSV(csv: string): ChartPoint[] {
  const trimmed = csv.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('no data') || lower.startsWith('exceeded')) return [];
  const lines = trimmed.split('\n');
  if (lines.length < 2) return [];

  const points: ChartPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    const date = cols[0];
    const close = parseFloat(cols[4]);
    if (!isNaN(close) && close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      points.push({ date, close });
    }
  }
  return points;
}

export async function fetchStooqDaily(
  yahooSymbol: string,
  from: Date,
  to: Date,
  interval: 'd' | 'w' | 'm' = 'd',
): Promise<ChartPoint[]> {
  const symbol = toStooqSymbol(yahooSymbol);
  const fromStr = format(from, 'yyyyMMdd');
  const toStr = format(to, 'yyyyMMdd');
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=${interval}&d1=${fromStr}&d2=${toStr}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) {
      console.error(`[stooq] ${symbol} HTTP ${res.status}`);
      return [];
    }
    const csv = await res.text();
    const points = parseStooqCSV(csv);
    if (points.length === 0) {
      console.warn(`[stooq] ${symbol} empty response (first 80 chars):`, csv.slice(0, 80));
    }
    return points;
  } catch (e) {
    console.error(`[stooq] ${symbol} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function quoteFromPoints(yahooSymbol: string, points: ChartPoint[]): MarketQuote | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const closes = points.map(p => p.close);
  return {
    symbol: yahooSymbol,
    name: yahooSymbol,
    price: last.close,
    previousClose: prev.close,
    change: last.close - prev.close,
    changePercent: ((last.close - prev.close) / prev.close) * 100,
    currency: 'USD',
    high52w: Math.max(...closes),
    low52w: Math.min(...closes),
    volume: null,
    trailingPE: null,
    forwardPE: null,
    marketCap: null,
  };
}

export function returnSince(points: ChartPoint[], sinceISODate: string): number | null {
  const filtered = points.filter(p => p.date >= sinceISODate);
  if (filtered.length < 2) return null;
  const start = filtered[0].close;
  const end = filtered[filtered.length - 1].close;
  return ((end - start) / start) * 100;
}

export function cagrFromPoints(points: ChartPoint[], years: number): number | null {
  if (points.length < 2 || years <= 0) return null;
  const start = points[0].close;
  const end = points[points.length - 1].close;
  if (start <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}
