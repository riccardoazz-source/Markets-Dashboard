export interface ChartPoint {
  date: string;
  close: number;
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

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Yahoo chart ${symbol}: ${res.status}`);

  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp?: number[];
        indicators: { quote: Array<{ close: (number | null)[] }> };
      }>;
      error?: { description: string } | null;
    };
  };

  if (json.chart.error) throw new Error(json.chart.error.description);

  const result = json.chart.result?.[0];
  if (!result?.timestamp) return [];

  const closes = result.indicators.quote[0]?.close ?? [];
  return result.timestamp
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: closes[i],
    }))
    .filter((p): p is ChartPoint => p.close != null);
}
