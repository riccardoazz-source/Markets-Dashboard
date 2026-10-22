import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooQuotes } from '@/lib/yahoo';
import { isBondSymbol, resolveBondSeries, pctChange, fromDate } from '@/lib/bondSeries';
import { fetchCurveRows, fetchSecurityRows } from '@/lib/treasuryCurve';
import { normalizeAuctionRow } from '@/lib/bonds';
import { isGovtSymbol, parseGovtSymbol, govtDisplayName } from '@/lib/govtBonds';
import { fetchGovtSeries } from '@/lib/govtFetch';

/** A foreign government yield in the shape every other quote uses. */
async function govtQuote(symbol: string) {
  const hit = parseGovtSymbol(symbol);
  if (!hit) return null;
  const { points } = await fetchGovtSeries(hit.tenor);
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const now = new Date();
  const since = (iso: string) => {
    const w = points.filter(p => p.date >= iso);
    if (w.length < 2) return null;
    const a = w[0].close, b = w[w.length - 1].close;
    return a === 0 ? null : ((b - a) / Math.abs(a)) * 100;
  };
  const back = (months: number) => { const d = new Date(now); d.setMonth(d.getMonth() - months); return since(d.toISOString().slice(0, 10)); };
  const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const last52 = points.filter(p => p.date >= yearAgo.toISOString().slice(0, 10)).map(p => p.close);
  return {
    symbol,
    name: govtDisplayName(hit.country, hit.tenor),
    price: last.close,
    previousClose: prev?.close,
    change: prev ? last.close - prev.close : 0,
    changePercent: prev && prev.close !== 0 ? ((last.close - prev.close) / Math.abs(prev.close)) * 100 : 0,
    currency: '%',
    high52w: last52.length ? Math.max(...last52) : null,
    low52w: last52.length ? Math.min(...last52) : null,
    ytdChangePercent: since(`${now.getFullYear()}-01-01`),
    mtdChangePercent: since(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`),
    oneMonthChangePercent: back(1),
    threeMonthChangePercent: back(3),
    sixMonthChangePercent: back(6),
    fiveYearChangePercent: back(60),
  };
}

/**
 * A bond rendered in the shape every other quote uses, so the standard panel needs no
 * special case. `price` carries whatever the series measures — a yield in percent for a
 * maturity bucket, a price per 100 face for one security — because a bucket has no price
 * and inventing one would be worse than labelling the axis honestly in the UI.
 */
async function bondQuote(symbol: string) {
  // Six years: enough for the 5Y tile, and the only window on the row that needs depth.
  const r = await resolveBondSeries(symbol, 6, { fetchCurveRows, fetchSecurityRows, normalizeAuctionRow });
  if (!r || r.series.length === 0) return null;
  const s = r.series;
  const last = s[s.length - 1];
  const prev = s.length > 1 ? s[s.length - 2] : null;
  const now = new Date();
  const ytd = `${now.getFullYear()}-01-01`;
  const mtd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const since = (iso: string) => pctChange(fromDate(s, iso));
  const back = (y: number) => {
    const d = new Date(now); d.setFullYear(d.getFullYear() - y);
    return pctChange(fromDate(s, d.toISOString().slice(0, 10)));
  };
  const vals = s.map(p => p.close);
  const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const last52 = fromDate(s, yearAgo.toISOString().slice(0, 10)).map(p => p.close);
  return {
    symbol,
    name: r.name,
    price: last.close,
    previousClose: prev?.close,
    change: prev ? last.close - prev.close : 0,
    changePercent: prev && prev.close !== 0 ? ((last.close - prev.close) / Math.abs(prev.close)) * 100 : 0,
    // Not a traded currency: a yield is in percent and a bond price is per 100 face.
    currency: r.unit === 'yield' ? '%' : 'per 100',
    high52w: last52.length ? Math.max(...last52) : (vals.length ? Math.max(...vals) : null),
    low52w: last52.length ? Math.min(...last52) : (vals.length ? Math.min(...vals) : null),
    ytdChangePercent: since(ytd),
    mtdChangePercent: since(mtd),
    oneMonthChangePercent: (() => { const d = new Date(now); d.setMonth(d.getMonth() - 1); return since(d.toISOString().slice(0, 10)); })(),
    threeMonthChangePercent: (() => { const d = new Date(now); d.setMonth(d.getMonth() - 3); return since(d.toISOString().slice(0, 10)); })(),
    sixMonthChangePercent: (() => { const d = new Date(now); d.setMonth(d.getMonth() - 6); return since(d.toISOString().slice(0, 10)); })(),
    fiveYearChangePercent: back(5),
  };
}

export const runtime = 'edge';

interface CacheEntry { data: unknown[]; ts: number }
const cache = new Map<string, CacheEntry>();
const FRESH = 60_000;
const STALE = 30 * 60_000;

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? [];
  if (!symbols.length) return NextResponse.json({ error: 'No symbols' }, { status: 400 });

  // Treasuries come from the Treasury's own files, not from a price vendor, so they are
  // split off before the vendor call rather than being sent to it and coming back empty.
  // Everything on the tile row is derived from the SAME series the chart draws, so the
  // number above the line and the line itself can never disagree.
  const bondSymbols = symbols.filter(isBondSymbol);
  const govtSymbols = symbols.filter(isGovtSymbol);
  const rest = symbols.filter(s => !isBondSymbol(s) && !isGovtSymbol(s));
  const [bondQuotes, govtQuotes] = await Promise.all([
    bondSymbols.length ? Promise.all(bondSymbols.map(bondQuote)) : Promise.resolve([]),
    govtSymbols.length ? Promise.all(govtSymbols.map(govtQuote)) : Promise.resolve([]),
  ]);
  const bonds = [...bondQuotes, ...govtQuotes].filter((q): q is NonNullable<typeof q> => q !== null);
  if (rest.length === 0) return NextResponse.json(bonds);

  // Keyed on the vendor symbols only — bonds never reach this cache, so mixing them into
  // the key would split it for no reason.
  const key = [...rest].sort().join(',');
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < FRESH) return NextResponse.json([...bonds, ...entry.data]);

  try {
    const quotes = await fetchYahooQuotes(rest);
    if (quotes.length > 0) {
      cache.set(key, { data: quotes, ts: Date.now() });
      return NextResponse.json([...bonds, ...quotes]);
    }
    if (entry && Date.now() - entry.ts < STALE) return NextResponse.json([...bonds, ...entry.data]);
    return NextResponse.json(bonds);
  } catch (err) {
    console.error('quotes error', err);
    if (entry && Date.now() - entry.ts < STALE) return NextResponse.json([...bonds, ...entry.data]);
    return NextResponse.json(bonds, { status: 200 });
  }
}
