import { ChartPoint } from './stooq';

// ---------------------------------------------------------------------------
// Twelve Data client — works from Vercel (not blocked like Yahoo)
// 800 credits/day free, 8 req/min, batch requests supported
// ---------------------------------------------------------------------------

const API_KEY = process.env.TWELVEDATA_API_KEY ?? '319ddc9917744390a29a35966040a078';
const BASE = 'https://api.twelvedata.com';

// Yahoo Finance symbol → Twelve Data symbol
const SYMBOL_MAP: Record<string, string> = {
  // Major indexes
  '^GSPC':     'SPX',
  '^NDX':      'NDX',
  '^DJI':      'DJI',
  '^RUT':      'RUT',
  '^STOXX50E': 'SX5E',
  '^GDAXI':    'DAX',
  '^FTSE':     'FTSE100',
  '^FCHI':     'CAC40',
  '^N225':     'N225',
  // Commodities (Twelve Data forex/commodity format)
  'GC=F': 'XAU/USD',
  'SI=F': 'XAG/USD',
  'PL=F': 'XPT/USD',
  'CL=F': 'WTI/USD',
  'BZ=F': 'BRENT/USD',
  'NG=F': 'NATGAS/USD',
  'HG=F': 'XCU/USD',
  'ZW=F': 'WHEAT/USD',
  'ZC=F': 'CORN/USD',
};

// Reverse map for parsing responses
const REVERSE_MAP: Record<string, string> = {};
for (const [yahoo, td] of Object.entries(SYMBOL_MAP)) REVERSE_MAP[td] = yahoo;

export function toTwelveSymbol(yahooSymbol: string): string {
  return SYMBOL_MAP[yahooSymbol] ?? yahooSymbol;
}

export interface TDQuote {
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
  ytdChangePercent: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  volume: number | null;
}

async function fetchWithTimeout(url: string, ms = 8_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

function parseQuoteItem(
  tdSymbol: string,
  q: Record<string, unknown>,
  originalSymbol: string,
): TDQuote | null {
  // Twelve Data returns { code, message, status } for errors
  if ((q.code != null) || q.status === 'error') {
    console.warn(`[12d] ${tdSymbol}: ${q.message ?? 'error'}`);
    return null;
  }

  const close = parseFloat(String(q.close ?? '0'));
  if (!close || close <= 0) return null;

  const prev = parseFloat(String(q.previous_close ?? '0'));
  const change = parseFloat(String(q.change ?? String(close - prev)));
  const pct = parseFloat(String(q.percent_change ?? '0'));
  const fw = q.fifty_two_week as Record<string, string> | undefined;

  return {
    symbol: originalSymbol,
    name: (q.name as string) ?? originalSymbol,
    price: close,
    previousClose: prev || close,
    change,
    changePercent: pct,
    currency: (q.currency as string) ?? 'USD',
    high52w: fw?.high ? parseFloat(fw.high) : null,
    low52w: fw?.low ? parseFloat(fw.low) : null,
    // Twelve Data doesn't expose 52W return % or YTD directly in quote; skip for now
    fiftyTwoWeekChangePercent: null,
    ytdChangePercent: null,
    trailingPE: null,
    forwardPE: null,
    marketCap: null,
    volume: q.volume ? parseInt(String(q.volume)) : null,
  };
}

export async function fetchTDQuotes(yahooSymbols: string[]): Promise<TDQuote[]> {
  if (yahooSymbols.length === 0) return [];

  const tdSymbols = yahooSymbols.map(toTwelveSymbol);
  // URL-encode each symbol individually (XAU/USD → XAU%2FUSD) but keep comma separators raw
  const symbolParam = tdSymbols.map(s => encodeURIComponent(s)).join(',');
  const url = `${BASE}/quote?symbol=${symbolParam}&apikey=${API_KEY}`;

  try {
    const res = await fetchWithTimeout(url, 10_000);
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      console.error(`[12d] non-JSON response (HTTP ${res.status}):`, text.slice(0, 200));
      return [];
    }

    // Detect global error response: { code, message, status: 'error' }
    if (json.code != null || json.status === 'error') {
      console.error(`[12d] API error (HTTP ${res.status}):`, json.code, json.message);
      return [];
    }

    if (!res.ok) {
      console.error(`[12d] quote HTTP ${res.status}:`, JSON.stringify(json).slice(0, 200));
      return [];
    }

    // Single symbol: json IS the quote object (has "symbol" field)
    // Multiple symbols: json is { SYMBOL: quoteObj, ... }
    const isSingle = typeof json.symbol === 'string';
    const entries: [string, Record<string, unknown>][] = isSingle
      ? [[tdSymbols[0], json]]
      : (Object.entries(json) as [string, Record<string, unknown>][]);

    const parsed = entries
      .map(([tdSym, q]) => {
        const original =
          REVERSE_MAP[tdSym] ??
          yahooSymbols.find(y => toTwelveSymbol(y) === tdSym) ??
          tdSym;
        return parseQuoteItem(tdSym, q, original);
      })
      .filter((q): q is TDQuote => q !== null);

    console.log(`[12d] quote OK: ${parsed.length}/${yahooSymbols.length} symbols`);
    return parsed;
  } catch (e) {
    console.error('[12d] quote failed:', (e as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Time series (for charts and CAGR)
// ---------------------------------------------------------------------------

function tdInterval(yahooInterval: '1d' | '1wk' | '1mo'): string {
  if (yahooInterval === '1wk') return '1week';
  if (yahooInterval === '1mo') return '1month';
  return '1day';
}

export async function fetchTDTimeSeries(
  yahooSymbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<ChartPoint[]> {
  const tdSym = toTwelveSymbol(yahooSymbol);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const url =
    `${BASE}/time_series?symbol=${tdSym}&interval=${tdInterval(interval)}` +
    `&start_date=${fromStr}&end_date=${toStr}&order=ASC&apikey=${API_KEY}`;

  try {
    const res = await fetchWithTimeout(url, 8_000);
    if (!res.ok) {
      console.error(`[12d] time_series HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as { status?: string; message?: string; values?: Array<Record<string, string>> };
    if (json.status === 'error') {
      console.error(`[12d] time_series error for ${tdSym}:`, json.message);
      return [];
    }
    return (json.values ?? [])
      .map(v => ({
        date: (v.datetime ?? '').slice(0, 10),
        close: parseFloat(v.close),
      }))
      .filter(p => p.date && !isNaN(p.close) && p.close > 0);
  } catch (e) {
    console.error(`[12d] time_series ${tdSym} failed:`, (e as Error).message);
    return [];
  }
}
