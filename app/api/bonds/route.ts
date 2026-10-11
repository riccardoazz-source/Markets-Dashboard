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
const CURVE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?type=daily_treasury_yield_curve&download=true&field_tdr_date_value=all';

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

async function fetchCurve(timeoutMs = 9_000): Promise<CurveSnapshot | null> {
  try {
    const res = await fetch(CURVE, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://home.treasury.gov/' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) { console.error(`[bonds] curve HTTP ${res.status}`); return null; }
    return parseCurveCsv(await res.text());
  } catch (e) {
    console.error('[bonds] curve failed:', (e as Error).message);
    return null;
  }
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
      curve: curve ? { date: curve.date, tenors: curve.points.length, byCol: curve.byCol } : null,
      universe: { count: uni.secs.length, trace: uni.trace, sample: uni.secs.slice(0, 3) },
      note: 'Prices are computed from the par curve, not quoted. No free per-CUSIP market feed exists.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const curve = await loadCurve();
  if (!curve) {
    return NextResponse.json({ error: 'curve_unavailable' }, { status: 503 });
  }

  if (mode === 'curve') {
    return NextResponse.json({
      date: curve.date,
      buckets: BUCKETS.map(b => ({ ...b, yieldPct: curve.byCol[b.curveCol] ?? null })),
    });
  }

  if (mode === 'securities') {
    const bucketId = sp.get('bucket');
    const { secs, trace } = await loadUniverse(today);
    const inBucket = bucketId
      ? secs.filter(s => bucketFor(s.maturityDate, today)?.id === bucketId)
      : secs;
    // Priced here rather than in the browser: the bootstrap runs once for the whole list
    // instead of once per row, and the client never has to hold the curve.
    const rows: BondRow[] = inBucket
      .map(s => toRow(s, today, curve.points))
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate) || a.cusip.localeCompare(b.cusip));
    return NextResponse.json({
      asOf: today,
      curveDate: curve.date,
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
