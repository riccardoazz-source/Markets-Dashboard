import { NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { computeVolatility, Volatility } from '@/lib/volatility';

export const runtime = 'edge';

// Volatility over an asset's WHOLE history — the number the cards show.
//
// Deliberately the full series and not a trailing window: this figure answers "what kind
// of asset is this", which is a property of the thing, not of the last quarter. A trailing
// window would make a bond fund read like an equity for a month after a rate shock and
// then quietly change its mind, which is useless to filter on.
//
// That makes it expensive to compute and almost free to cache: a number built from
// thousands of bars does not move when one more arrives. The cache is a day, and a stale
// entry is served rather than refetching on every view.

interface Row extends Partial<Volatility> { symbol: string }

interface CacheEntry { row: Row; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 24 * 60 * 60_000;

// Yahoo clamps this to whatever the ticker actually has, so asking for 1970 asks for
// "everything" without needing to know each asset's inception.
const START = new Date('1970-01-01T00:00:00Z');

async function rowFor(symbol: string): Promise<Row> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.ts < TTL) return hit.row;
  try {
    const hist = await fetchYahooChart(symbol, START, new Date(), '1d');
    const v = computeVolatility(hist);
    const row: Row = v ? { symbol, ...v } : { symbol };
    cache.set(symbol, { row, ts: Date.now() });
    return row;
  } catch {
    // Keep whatever we had rather than turning a transient Yahoo failure into a blank
    // column across the whole page.
    if (hit) return hit.row;
    return { symbol };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('symbols') ?? '';
  const symbols = Array.from(new Set(raw.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 80);
  if (!symbols.length) return NextResponse.json([]);

  const rows = await Promise.all(symbols.map(rowFor));
  return NextResponse.json(rows);
}
