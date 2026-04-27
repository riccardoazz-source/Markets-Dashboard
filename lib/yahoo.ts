export interface ChartPoint {
  date: string;
  close: number;
}

export interface YahooQuote {
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
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface ChartMeta {
  currency?: string;
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume?: number;
}

interface ChartApiResponse {
  chart: {
    result?: Array<{
      meta?: ChartMeta;
      timestamp?: number[];
      indicators: { quote: Array<{ close: (number | null)[] }> };
    }>;
    error?: { description: string } | null;
  };
}

async function callChart(url: string): Promise<ChartApiResponse> {
  const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`Yahoo chart: ${res.status}`);
  return (await res.json()) as ChartApiResponse;
}

export async function fetchYahooChartByRange(
  symbol: string,
  range: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'max',
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<{ meta: ChartMeta | null; points: ChartPoint[] }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}`;
  const json = await callChart(url);
  if (json.chart.error) throw new Error(json.chart.error.description);

  const result = json.chart.result?.[0];
  if (!result) return { meta: null, points: [] };

  const meta = result.meta ?? null;
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const ts = result.timestamp ?? [];
  const points = ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().split('T')[0], close: closes[i] }))
    .filter((p): p is ChartPoint => p.close != null);

  return { meta, points };
}

export async function fetchYahooChart(
  symbol: string,
  period1: number,
  period2: number,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<ChartPoint[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=${interval}`;
  const json = await callChart(url);
  if (json.chart.error) throw new Error(json.chart.error.description);

  const result = json.chart.result?.[0];
  if (!result?.timestamp) return [];

  const closes = result.indicators.quote[0]?.close ?? [];
  return result.timestamp
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().split('T')[0], close: closes[i] }))
    .filter((p): p is ChartPoint => p.close != null);
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuote | null> {
  try {
    const { meta } = await fetchYahooChartByRange(symbol, '1d', '1d');
    if (!meta) return null;

    const price = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = price != null && prev != null ? price - prev : 0;
    const changePercent = price != null && prev ? ((price - prev) / prev) * 100 : 0;

    return {
      symbol,
      name: meta.longName ?? meta.shortName ?? symbol,
      price,
      previousClose: prev,
      change,
      changePercent,
      currency: meta.currency ?? 'USD',
      high52w: meta.fiftyTwoWeekHigh ?? null,
      low52w: meta.fiftyTwoWeekLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      trailingPE: null,
      forwardPE: null,
      marketCap: null,
    };
  } catch (e) {
    console.error('fetchYahooQuote error', symbol, e);
    return null;
  }
}

interface QuoteSummaryResponse {
  quoteSummary: {
    result?: Array<{
      summaryDetail?: { trailingPE?: { raw: number }; forwardPE?: { raw: number } };
      defaultKeyStatistics?: { forwardPE?: { raw: number } };
      price?: { marketCap?: { raw: number } };
    }>;
  };
}

export async function fetchYahooPE(symbol: string): Promise<{ trailingPE: number | null; forwardPE: number | null; marketCap: number | null }> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=summaryDetail,defaultKeyStatistics,price`;
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return { trailingPE: null, forwardPE: null, marketCap: null };
    const json = (await res.json()) as QuoteSummaryResponse;
    const r = json.quoteSummary.result?.[0];
    return {
      trailingPE: r?.summaryDetail?.trailingPE?.raw ?? null,
      forwardPE: r?.summaryDetail?.forwardPE?.raw ?? r?.defaultKeyStatistics?.forwardPE?.raw ?? null,
      marketCap: r?.price?.marketCap?.raw ?? null,
    };
  } catch {
    return { trailingPE: null, forwardPE: null, marketCap: null };
  }
}

// Helper: filter chart points to those after a given date and compute return
export function returnSince(points: ChartPoint[], sinceISODate: string): number | null {
  const filtered = points.filter(p => p.date >= sinceISODate);
  if (filtered.length < 2) return null;
  const start = filtered[0].close;
  const end = filtered[filtered.length - 1].close;
  return ((end - start) / start) * 100;
}

// Helper: compute CAGR from full series
export function cagrFromPoints(points: ChartPoint[], years: number): number | null {
  if (points.length < 2) return null;
  const start = points[0].close;
  const end = points[points.length - 1].close;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}
