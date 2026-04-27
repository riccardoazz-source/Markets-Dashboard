import { NextRequest, NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

yahooFinance.setGlobalConfig({ validation: { logErrors: false } });

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 60_000;

function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}
function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') ?? [];
  if (!symbols.length) return NextResponse.json({ error: 'No symbols' }, { status: 400 });

  const key = symbols.sort().join(',');
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  try {
    const results = await Promise.allSettled(
      symbols.map(s =>
        yahooFinance.quote(s, {}, { validateResult: false }).catch(() => null)
      )
    );

    const quotes = results
      .map((r, i) => {
        if (r.status === 'rejected' || !r.value) return null;
        const q = r.value as Record<string, unknown>;
        return {
          symbol: symbols[i],
          name: (q.longName as string) || (q.shortName as string) || symbols[i],
          price: (q.regularMarketPrice as number) ?? null,
          change: (q.regularMarketChange as number) ?? 0,
          changePercent: (q.regularMarketChangePercent as number) ?? 0,
          currency: (q.currency as string) ?? 'USD',
          trailingPE: (q.trailingPE as number) ?? null,
          forwardPE: (q.forwardPE as number) ?? null,
          marketCap: (q.marketCap as number) ?? null,
          high52w: (q.fiftyTwoWeekHigh as number) ?? null,
          low52w: (q.fiftyTwoWeekLow as number) ?? null,
          volume: (q.regularMarketVolume as number) ?? null,
          avgVolume: (q.averageDailyVolume3Month as number) ?? null,
        };
      })
      .filter(Boolean);

    setCached(key, quotes);
    return NextResponse.json(quotes);
  } catch (err) {
    console.error('quotes error', err);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}
