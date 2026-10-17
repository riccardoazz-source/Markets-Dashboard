// ── The published Treasury par curve, as a series ────────────────────────────
//
// Lifted out of the bonds route so other routes can read it: /api/historical and
// /api/quotes both need it to serve a bond the way they serve any other symbol, and a
// Next.js route cannot be imported from another route.
//
// Fetched a year at a time. The `all/all` file is every curve ever published — about
// 20,000 rows — and reaching for it to read one day is what made the Bonds tab time out
// and render empty the first time it shipped.

import { parseCurveRows, type CurveDay } from './curveParse';

export { parseCurveRows, yearsForTimeframe, CURVE_TENORS, type CurveDay } from './curveParse';

const UA = 'Mozilla/5.0 (compatible; MarketPulse/1.0)';
const CURVE_BASE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv';

export const curveUrl = (year: number) =>
  `${CURVE_BASE}/${year}/all?type=daily_treasury_yield_curve&download=true`;

/** `years` calendar years of curve, ending today. Capped, because each is a request. */
export async function fetchCurveRows(years: number, timeoutMs = 12_000): Promise<CurveDay[]> {
  const now = new Date().getFullYear();
  const n = Math.min(Math.max(Math.ceil(years), 1), 30);
  const parts = await Promise.all(
    Array.from({ length: n }, (_, i) => now - i).map(async y => {
      try {
        const res = await fetch(curveUrl(y), {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://home.treasury.gov/' },
          next: { revalidate: 86400 },
        });
        if (!res.ok) return [];
        return parseCurveRows(await res.text());
      } catch { return []; }
    }),
  );
  return parts.flat().sort((a, b) => a.date.localeCompare(b.date));
}

// ── One security's terms ─────────────────────────────────────────────────────
//
// Fetched with the Fiscal Data API's own filter rather than by pulling the whole
// outstanding universe and searching it: a route that only needs one bond should not
// download ten thousand auction records to find it.
//
// Uses `next: { revalidate }` rather than unstable_cache because the routes that call
// this run on the edge runtime, where unstable_cache is not available. The data cache
// honours it either way, so the first reader of the day pays and the rest do not.

const FISCAL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';

export async function fetchSecurityRows(cusip: string, timeoutMs = 10_000): Promise<Record<string, unknown>[]> {
  const c = cusip.trim().toUpperCase();
  if (!/^[0-9A-Z]{9}$/.test(c)) return [];
  const params = new URLSearchParams({ filter: `cusip:eq:${c}`, 'page[size]': '20' });
  try {
    const res = await fetch(`${FISCAL}?${params}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Record<string, unknown>[] };
    return Array.isArray(json?.data) ? json.data : [];
  } catch { return []; }
}
