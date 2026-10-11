import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import {
  BUCKETS, bucketFor, toRow, normalizeAuctionRow, dedupeByCusip,
  type CurvePoint, type TreasurySecurity, type BondRow,
} from '@/lib/bonds';

// ── US Treasury securities ───────────────────────────────────────────────────
//
// Two upstreams, both official, both free, neither needing a key:
//
//   home.treasury.gov        the daily par yield curve, every tenor, as CSV. The app
//                            already downloads this file for DGS2/DGS10 and reads two of
//                            its columns; here the whole row is used.
//   api.fiscaldata.treasury  the auction record: CUSIP, type, term, issue and maturity
//                            dates, coupon, and the price the security was sold at.
//
// What NEITHER provides is a current secondary-market price per CUSIP. No free public
// source does — TRACE is not an open API and the vendors that carry it charge. So the
// price here is COMPUTED by discounting each bond's real cash flows on the live curve,
// and is labelled that way on every surface that shows it. See lib/bonds.ts.
//
// Written against a schema that could not be checked from the machine it was written on:
// the egress proxy refuses both hosts. So the parser reads fields structurally, tolerates
// the field-name variants the API has used, and `?mode=diag` returns exactly what came
// back. If the shape has moved, diag says so instead of the page quietly emptying.

export const runtime = 'nodejs';
export const revalidate = 3600;

const UA = 'Mozilla/5.0 (compatible; MarketPulse/1.0)';
const FISCAL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';
const CURVE_BASE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv';

/**
 * The curve CSV for ONE year — about 250 rows.
 *
 * The first version of this asked for `all/all`, which is every daily curve the Treasury
 * has ever published: roughly 20,000 rows, downloaded in full to read the single most
 * recent one. It timed out on Vercel and the whole section rendered its empty state. The
 * macro route already knew better and says so in a comment next to the same URL builder
 * ("~80 rows vs 20k"); this one did not reuse it.
 */
const curveUrl = (year: number) =>
  `${CURVE_BASE}/${year}/all?type=daily_treasury_yield_curve&download=true`;

// ── The par curve ────────────────────────────────────────────────────────────

/** Column header → years. The CSV carries every tenor in one row. */
const CURVE_TENORS: [string, number][] = [
  ['1 Mo', 1 / 12], ['1.5 Month', 0.125], ['2 Mo', 2 / 12], ['3 Mo', 0.25], ['4 Mo', 4 / 12],
  ['6 Mo', 0.5], ['1 Yr', 1], ['2 Yr', 2], ['3 Yr', 3], ['5 Yr', 5],
  ['7 Yr', 7], ['10 Yr', 10], ['20 Yr', 20], ['30 Yr', 30],
];

interface CurveSnapshot {
  date: string;
  points: CurvePoint[];
  /** Keyed by the CSV column, for the tiles. */
  byCol: Record<string, number>;
}

function parseCurveCsv(csv: string): CurveSnapshot | null {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  // Row 1 is the most recent date: this CSV is newest-first.
  const cells = lines[1].split(',').map(c => c.trim().replace(/"/g, ''));
  const raw = cells[0];
  const segs = raw.split('/');
  if (segs.length !== 3) return null;
  const date = `${segs[2]}-${segs[0].padStart(2, '0')}-${segs[1].padStart(2, '0')}`;

  const points: CurvePoint[] = [];
  const byCol: Record<string, number> = {};
  for (const [col, years] of CURVE_TENORS) {
    const i = headers.indexOf(col);
    if (i < 0 || i >= cells.length) continue;
    const v = parseFloat(cells[i]);
    if (!isFinite(v)) continue;
    points.push({ years, pct: v });
    byCol[col] = v;
  }
  points.sort((a, b) => a.years - b.years);
  return points.length >= 4 ? { date, points, byCol } : null;
}

async function fetchCurve(timeoutMs = 9_000): Promise<{ snap: CurveSnapshot | null; trace: string[] }> {
  const trace: string[] = [];
  const now = new Date().getFullYear();
  // Current year first, previous as a fallback: in the first days of January the new
  // year's file exists but can still be empty.
  for (const year of [now, now - 1]) {
    const url = curveUrl(year);
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://home.treasury.gov/' },
        next: { revalidate: 1800 },
      });
      trace.push(`${year}: HTTP ${res.status}`);
      if (!res.ok) continue;
      const csv = await res.text();
      trace.push(`${year}: ${csv.length} bytes`);
      const snap = parseCurveCsv(csv);
      if (snap) {
        trace.push(`${year}: parsed ${snap.points.length} tenors for ${snap.date}`);
        return { snap, trace };
      }
      trace.push(`${year}: parsed nothing — header was "${csv.split('\n')[0]?.slice(0, 90)}"`);
    } catch (e) {
      trace.push(`${year}: ${(e as Error).message}`);
    }
  }
  return { snap: null, trace };
}

// ── The security universe ────────────────────────────────────────────────────

async function fetchUniverse(today: string, timeoutMs = 12_000): Promise<{
  secs: TreasurySecurity[]; trace: string[];
}> {
  const trace: string[] = [];
  const params = new URLSearchParams({
    // Only what is still outstanding. Without this the file reaches back decades.
    filter: `maturity_date:gt:${today}`,
    sort: 'maturity_date',
    'page[size]': '10000',
  });
  const url = `${FISCAL}?${params}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      next: { revalidate: 21600 },
    });
    trace.push(`HTTP ${res.status}`);
    if (!res.ok) return { secs: [], trace };
    const json = await res.json() as { data?: Record<string, unknown>[] };
    const rows = Array.isArray(json?.data) ? json.data : [];
    trace.push(`${rows.length} auction rows`);
    if (rows.length > 0) trace.push(`fields: ${Object.keys(rows[0]).slice(0, 14).join(', ')}`);
    const parsed = rows.map(normalizeAuctionRow).filter((s): s is TreasurySecurity => s !== null);
    trace.push(`${parsed.length} parsed`);
    const deduped = dedupeByCusip(parsed);
    trace.push(`${deduped.length} distinct CUSIPs`);
    return { secs: deduped, trace };
  } catch (e) {
    trace.push(`failed: ${(e as Error).message}`);
    return { secs: [], trace };
  }
}

// Shared across the deployment rather than per serverless instance, so the first reader
// of the hour pays for the fetch and the rest do not.
const loadCurve = unstable_cache(async () => fetchCurve(), ['bonds-curve'], { revalidate: 3600 });
const loadUniverse = unstable_cache(
  async (today: string) => fetchUniverse(today), ['bonds-universe'], { revalidate: 21600 });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') ?? 'curve';
  const today = new Date().toISOString().slice(0, 10);

  if (mode === 'diag') {
    const [curve, uni] = await Promise.all([fetchCurve(), fetchUniverse(today)]);
    return NextResponse.json({
      today,
      curve: curve.snap
        ? { date: curve.snap.date, tenors: curve.snap.points.length, byCol: curve.snap.byCol, trace: curve.trace }
        : { error: 'unavailable', trace: curve.trace },
      universe: { count: uni.secs.length, trace: uni.trace, sample: uni.secs.slice(0, 3) },
      note: 'Prices are computed from the par curve, not quoted. No free per-CUSIP market feed exists.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // NOTHING below requires the curve to have loaded.
  //
  // The first version bailed out here with a 503 when the curve was missing, and the page
  // rendered one apologetic paragraph where the whole section should have been. That was
  // the wrong unit of failure: the buckets are a fixed list, the securities in them and
  // their coupons, maturities and ISINs are exact facts that do not involve the curve at
  // all, and only the YIELD on a tile and the computed PRICE in the table depend on it.
  // Degrade per field, not per page — a missing number can say so; a missing section
  // cannot say anything.
  const { snap: curve, trace: curveTrace } = await loadCurve();

  if (mode === 'curve') {
    const { secs } = await loadUniverse(today);
    const counts = new Map<string, number>();
    for (const s of secs) {
      const b = bucketFor(s.maturityDate, today);
      if (b) counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
    }
    return NextResponse.json({
      date: curve?.date ?? null,
      curveAvailable: !!curve,
      curveTrace: curve ? undefined : curveTrace,
      buckets: BUCKETS.map(b => ({
        ...b,
        yieldPct: curve?.byCol[b.curveCol] ?? null,
        count: counts.get(b.id) ?? 0,
      })),
    });
  }

  if (mode === 'securities') {
    const bucketId = sp.get('bucket');
    const { secs, trace } = await loadUniverse(today);
    const inBucket = bucketId
      ? secs.filter(s => bucketFor(s.maturityDate, today)?.id === bucketId)
      : secs;
    // Priced here rather than in the browser: the bootstrap runs once for the whole list
    // instead of once per row, and the client never has to hold the curve. With no curve
    // the rows still go out — coupon, maturity, ISIN and issue price are exact and owe
    // the curve nothing — and `priced` is null on each, which the table renders as "—".
    const rows: BondRow[] = inBucket
      .map(s => curve
        ? toRow(s, today, curve.points)
        : { ...s, priced: null, vsPar: null, vsIssue: null })
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate) || a.cusip.localeCompare(b.cusip));
    return NextResponse.json({
      asOf: today,
      curveDate: curve?.date ?? null,
      curveAvailable: !!curve,
      bucket: bucketId,
      count: rows.length,
      priced: rows.filter(r => r.priced).length,
      rows,
      // Repeated in the payload, not only in the UI: anything reading this endpoint
      // directly should see it too.
      priceBasis: 'computed from the US Treasury par yield curve — not a traded quote',
      trace: secs.length === 0 ? trace : undefined,
    });
  }

  return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
}
