import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooTopHoldingsDetailed, fetchYahooQuotesGentle, yahooSessionOk } from '@/lib/yahoo';
import { holdingsSourceFor, parseTopHoldings } from '@/lib/holdings';

// Holdings for any fund, and for any index through the fund that tracks it — each holding
// enriched with price, day change, market cap and P/E, so every fund renders in the same
// table as the S&P 500 list instead of a bare name-and-weight column.
//
// Edge, for the reason given in /api/sp500: from the nodejs runtime's IPs Yahoo answers
// 429 to everything; from the edge it does not.
export const runtime = 'edge';

type Row = {
  symbol: string; name: string; sector: string; subIndustry: string; weight: number | null;
  price: number | null; changePercent: number | null; marketCap: number | null;
  trailingPE: number | null; forwardPE: number | null;
};
type Payload = { rows: Row[]; sectors: { sector: string; weight: number }[]; listedShare: number | null;
  status: 'ok' | 'no_data' | 'failed'; detail?: string };

const cache = new Map<string, { p: Payload; ts: number }>();

async function load(fund: string): Promise<Payload> {
  const hit = cache.get(fund);
  if (hit && Date.now() - hit.ts < 43_200_000) return hit.p;
  const r = await fetchYahooTopHoldingsDetailed(fund);
  if (!r.result) {
    // 404 is Yahoo saying it has nothing for this fund — a fact, cached like one. Anything
    // else is a failed request, which is not cached so the next open retries.
    const p: Payload = { rows: [], sectors: [], listedShare: null,
      status: r.status === 404 ? 'no_data' : 'failed', detail: `HTTP ${r.status ?? '—'}: ${r.error ?? ''}` };
    if (p.status === 'no_data') cache.set(fund, { p, ts: Date.now() });
    return p;
  }
  const h = parseTopHoldings(r.result);
  const syms = h.holdings.map(x => x.symbol).filter((x): x is string => !!x);
  const q = syms.length ? (await fetchYahooQuotesGentle(syms).catch(() => ({ quotes: [] }))).quotes : [];
  const bySym = new Map(q.map(x => [x.symbol.toUpperCase(), x]));
  const rows: Row[] = h.holdings.map(x => {
    const qq = x.symbol ? bySym.get(x.symbol.toUpperCase()) : undefined;
    return {
      symbol: x.symbol ?? x.name, name: x.name, sector: '', subIndustry: '', weight: x.weight,
      price: qq?.price ?? null, changePercent: qq?.changePercent ?? null, marketCap: qq?.marketCap ?? null,
      trailingPE: qq?.trailingPE ?? null, forwardPE: qq?.forwardPE ?? null,
    };
  });
  const p: Payload = { rows, sectors: h.sectors, listedShare: h.listedShare, status: 'ok' };
  cache.set(fund, { p, ts: Date.now() });
  return p;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? '';
  const group = req.nextUrl.searchParams.get('group');
  const src = holdingsSourceFor(symbol, group);
  if (!src) return NextResponse.json({ error: 'no_source', symbol }, { status: 404 });

  if (req.nextUrl.searchParams.get('mode') === 'diag') {
    const session = await yahooSessionOk();
    const r = await fetchYahooTopHoldingsDetailed(src.fund);
    return NextResponse.json({
      symbol, source: src, crumbSession: session, status: r.status, error: r.error,
      parsed: r.result ? parseTopHoldings(r.result) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ symbol, ...src, ...(await load(src.fund)) });
}
