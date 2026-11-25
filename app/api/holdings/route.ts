import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { fetchYahooTopHoldings, yahooSessionOk } from '@/lib/yahoo';
import { holdingsSourceFor, parseTopHoldings } from '@/lib/holdings';

// Holdings for any fund, and for any index through the fund that tracks it.
// Shared across the deployment for 12 hours: fund books change on rebalances, not by
// the minute, and the Yahoo call needs a crumb session that is not free to set up.

export const runtime = 'nodejs';

const load = unstable_cache(
  async (fund: string) => {
    const raw = await fetchYahooTopHoldings(fund);
    if (!raw) throw new Error('no response');   // thrown, so an outage is not cached
    return parseTopHoldings(raw);
  },
  ['fund-holdings'], { revalidate: 43200 });

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? '';
  const group = req.nextUrl.searchParams.get('group');
  const src = holdingsSourceFor(symbol, group);
  if (!src) return NextResponse.json({ error: 'no_source', symbol }, { status: 404 });

  if (req.nextUrl.searchParams.get('mode') === 'diag') {
    const session = await yahooSessionOk();
    const raw = await fetchYahooTopHoldings(src.fund);
    return NextResponse.json({
      symbol, source: src, crumbSession: session, gotResponse: !!raw,
      keys: raw ? Object.keys((raw as { topHoldings?: object }).topHoldings ?? {}) : [],
      parsed: raw ? parseTopHoldings(raw) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const h = await load(src.fund);
    return NextResponse.json({ symbol, ...src, ...h });
  } catch {
    return NextResponse.json({ symbol, ...src, holdings: [], sectors: [], listedShare: null, error: 'unavailable' });
  }
}
