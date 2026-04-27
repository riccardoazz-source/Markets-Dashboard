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

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/csv,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Map Yahoo-style symbols to Stooq symbols.
// Stooq uses: ^spx, ^ndx etc for indexes; ticker.us for US stocks/ETFs;
// commodity.f for futures; pair (e.g. eurusd) for FX.
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
  'GC=F': 'gc.f',
  'SI=F': 'si.f',
  'PL=F': 'pl.f',
  'CL=F': 'cl.f',
  'BZ=F': 'cb.f',
  'NG=F': 'ng.f',
  'HG=F': 'hg.f',
  'ZW=F': 'zw.f',
  'ZC=F': 'zc.f',
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
  if (!trimmed || trimmed.toLowerCase().startsWith('no data')) return [];
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

export async function fetchStooqHistorical(
  yahooSymbol: string,
  from: Date,
  to: Date,
  interval: 'd' | 'w' | 'm' = 'd',
): Promise<ChartPoint[]> {
  const symbol = toStooqSymbol(yahooSymbol);
  const fromStr = format(from, 'yyyyMMdd');
  const toStr = format(to, 'yyyyMMdd');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=${interval}&d1=${fromStr}&d2=${toStr}`;

  const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`Stooq ${symbol}: HTTP ${res.status}`);
  const csv = await res.text();
  return parseStooqCSV(csv);
}

interface QuickQuote {
  symbol: string;
  name: string;
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  changePercent: number;
}

function parseQuickQuoteCSV(csv: string): QuickQuote | null {
  const trimmed = csv.trim();
  if (!trimmed) return null;
  const lines = trimmed.split('\n');
  if (lines.length < 2) return null;
  const cols = lines[1].split(',');
  // Format requested: f=sd2ohlcvpn → Symbol,Date,Open,High,Low,Close,Volume,Change %,Name
  if (cols.length < 8) return null;
  if (cols[5] === 'N/D' || cols[5] === '-') return null;

  const close = parseFloat(cols[5]);
  if (isNaN(close) || close <= 0) return null;

  return {
    symbol: cols[0],
    date: cols[1],
    open: parseFloat(cols[2]),
    high: parseFloat(cols[3]),
    low: parseFloat(cols[4]),
    price: close,
    volume: parseFloat(cols[6]) || 0,
    changePercent: parseFloat(cols[7]) || 0,
    name: cols.slice(8).join(',').trim(),
  };
}

export async function fetchStooqQuote(yahooSymbol: string): Promise<MarketQuote | null> {
  try {
    const symbol = toStooqSymbol(yahooSymbol);
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2ohlcvpn&h&e=csv`;
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) throw new Error(`Stooq quote ${symbol}: HTTP ${res.status}`);
    const csv = await res.text();
    const q = parseQuickQuoteCSV(csv);
    if (!q) return null;

    const previousClose =
      q.changePercent !== 0 ? q.price / (1 + q.changePercent / 100) : q.price;
    const change = q.price - previousClose;

    return {
      symbol: yahooSymbol,
      name: q.name || yahooSymbol,
      price: q.price,
      previousClose,
      change,
      changePercent: q.changePercent,
      currency: 'USD',
      high52w: null,
      low52w: null,
      volume: q.volume,
      trailingPE: null,
      forwardPE: null,
      marketCap: null,
    };
  } catch (e) {
    console.error('fetchStooqQuote error', yahooSymbol, e);
    return null;
  }
}

// Compute 52-week high/low from a year of historical points.
export function compute52w(points: ChartPoint[]): { high: number | null; low: number | null } {
  if (!points.length) return { high: null, low: null };
  const closes = points.map(p => p.close);
  return { high: Math.max(...closes), low: Math.min(...closes) };
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
