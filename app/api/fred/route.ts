// Dedicated Node.js route for FRED-type macro indicators.
// The main /api/macro route runs on Edge runtime where fred.stlouisfed.org
// is blocked. This route runs on Node.js with a broader fallback chain:
// FRED CSV → FRED TXT → DBnomics → World Bank (GDP) / OECD (INDPRO).
//
// Returns the same shapes as /api/macro so MacroSection can use either interchangeably.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

type DP = { date: string; value: number };

const cache = new Map<string, { data: unknown; ts: number }>();
const TTL   = 30 * 60_000;
const STALE = 6  * 60 * 60_000;
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=21600' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getCached(key: string, ttl: number) {
  const e = cache.get(key);
  return e && Date.now() - e.ts < ttl ? e.data : null;
}

// ─── FRED CSV (public, no key) ─────────────────────────────────────────────
async function tryFREDCsv(id: string, fromDate?: string): Promise<DP[]> {
  const p = new URLSearchParams({ id });
  if (fromDate) p.set('cosd', fromDate);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?${p}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://fred.stlouisfed.org/' },
    });
    if (!res.ok) return [];
    const csv = await res.text();
    if (!csv || csv.length < 20) return [];
    const pts: DP[] = [];
    for (const line of csv.trim().split('\n').slice(1)) {
      const [d, v] = line.split(',');
      const date = d?.trim();
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (fromDate && date < fromDate) continue;
      const num = parseFloat((v ?? '').trim());
      if (isFinite(num)) pts.push({ date, value: num });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// ─── FRED legacy TXT (tab-separated, public) ──────────────────────────────
async function tryFREDTxt(id: string, fromDate?: string): Promise<DP[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`https://fred.stlouisfed.org/data/${encodeURIComponent(id)}.txt`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' },
    });
    if (!res.ok) return [];
    const txt = await res.text();
    const pts: DP[] = [];
    for (const line of txt.split('\n')) {
      const [d, v] = line.trim().split(/\s+/);
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (fromDate && d < fromDate) continue;
      const num = parseFloat(v ?? '');
      if (isFinite(num)) pts.push({ date: d, value: num });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// ─── DBnomics FRED mirror ──────────────────────────────────────────────────
function normalizePeriod(p: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  if (/^\d{4}-\d{2}$/.test(p)) return `${p}-01`;
  const qm = p.match(/^(\d{4})-Q([1-4])$/);
  if (qm) { const m = (parseInt(qm[2]) - 1) * 3 + 1; return `${qm[1]}-${String(m).padStart(2,'0')}-01`; }
  const sm = p.match(/^(\d{4})-S([12])$/);
  if (sm) return `${sm[1]}-${sm[2] === '1' ? '01' : '07'}-01`;
  if (/^\d{4}$/.test(p)) return `${p}-07-01`;
  return null;
}

async function tryDBnomics(id: string, fromDate?: string): Promise<DP[]> {
  const enc = encodeURIComponent(id);
  for (const url of [
    `https://api.db.nomics.world/v22/series/FRED/${enc}/${enc}?observations=1`,
    `https://api.db.nomics.world/v22/series/FRED/${enc}?observations=1`,
  ]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': UA } });
      if (!res.ok) continue;
      const json = await res.json() as {
        series?: { docs?: Array<{ period?: string[]; value?: (number | string | null)[] }> }
      };
      const doc = json?.series?.docs?.[0];
      if (!doc?.period?.length) continue;
      const pts: DP[] = [];
      for (let i = 0; i < doc.period!.length; i++) {
        const date = normalizePeriod(doc.period![i]);
        if (!date) continue;
        if (fromDate && date < fromDate) continue;
        const raw = doc.value?.[i];
        const num = typeof raw === 'number' ? raw : raw == null ? NaN : parseFloat(String(raw));
        if (isFinite(num)) pts.push({ date, value: num });
      }
      pts.sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length) return pts;
    } catch { /* next url */ } finally { clearTimeout(t); }
  }
  return [];
}

// ─── World Bank (GDP fallback) ─────────────────────────────────────────────
async function tryWorldBank(indicator: string): Promise<DP[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(
      `https://api.worldbank.org/v2/country/US/indicator/${indicator}?format=json&mrv=60&per_page=60`,
      { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const json = await res.json() as [unknown, Array<{ date?: string; value?: number | null }>];
    const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : [];
    const pts: DP[] = [];
    for (const r of rows) {
      if (!r.date || r.value == null || !isFinite(r.value)) continue;
      pts.push({ date: `${r.date}-07-01`, value: r.value / 1e9 }); // USD → B$
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// ─── OECD (INDPRO fallback) ────────────────────────────────────────────────
async function tryOECDIndPro(fromDate?: string): Promise<DP[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(
      'https://stats.oecd.org/SDMX-JSON/data/MEI_BTE6/USA.PRMNTO01.IDX2015.M/all?format=json',
      { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const json = await res.json() as {
      dataSets?: Array<{ observations?: Record<string, [number, ...unknown[]]> }>;
      structure?: { dimensions?: { observation?: Array<{ id: string; values: Array<{ id: string }> }> } };
    };
    const obs     = json?.dataSets?.[0]?.observations ?? {};
    const timeDim = (json?.structure?.dimensions?.observation ?? []).find(d => d.id === 'TIME_PERIOD');
    if (!timeDim?.values?.length) return [];
    const periods = timeDim.values;
    const pts: DP[] = [];
    for (const [key, vals] of Object.entries(obs)) {
      const tIdx = parseInt(key.split(':').at(-1) ?? '-1', 10);
      if (tIdx < 0 || tIdx >= periods.length) continue;
      const raw = periods[tIdx].id;
      const date = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (fromDate && date < fromDate)) continue;
      const v = vals[0];
      if (typeof v === 'number' && isFinite(v)) pts.push({ date, value: v });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// ─── Master fetcher ────────────────────────────────────────────────────────
async function fetchFredSeries(id: string, fromDate?: string): Promise<DP[]> {
  // Run all FRED sources in parallel — first non-empty result wins
  const [csv, txt, dbn] = await Promise.all([
    tryFREDCsv(id, fromDate),
    tryFREDTxt(id, fromDate),
    tryDBnomics(id, fromDate),
  ]);
  if (csv.length) return csv;
  if (txt.length) return txt;
  if (dbn.length) return dbn;

  // Series-specific fallbacks when all FRED sources fail
  if (id === 'GDP')   return tryWorldBank('NY.GDP.MKTP.CD');
  if (id === 'GDPC1') return tryWorldBank('NY.GDP.MKTP.KD');
  if (id === 'INDPRO') return tryOECDIndPro(fromDate);
  return [];
}

// ─── GET handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'list';

  // ── History mode ─────────────────────────────────────────────────────────
  if (mode === 'history') {
    const id   = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json([]);
    const from = req.nextUrl.searchParams.get('from') ?? undefined;
    const key  = `hist:${id}:${from ?? ''}`;
    const hit  = getCached(key, TTL);
    if (hit) return NextResponse.json(hit, { headers: CACHE_HEADERS });

    const pts  = await fetchFredSeries(id, from);
    const data = pts.map(p => ({ date: p.date, close: p.value })); // → HistoricalPoint
    if (data.length) cache.set(key, { data, ts: Date.now() });
    else {
      const stale = getCached(key, STALE);
      if (stale) return NextResponse.json(stale, { headers: CACHE_HEADERS });
    }
    return NextResponse.json(data, { headers: CACHE_HEADERS });
  }

  // ── List mode (latest + prev per series) ─────────────────────────────────
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (!ids.length) return NextResponse.json([]);

  const key  = `list:${[...ids].sort().join(',')}`;
  const hit  = getCached(key, TTL);
  if (hit) return NextResponse.json(hit, { headers: CACHE_HEADERS });

  const from18 = new Date();
  from18.setMonth(from18.getMonth() - 18);
  const fromStr = from18.toISOString().slice(0, 10);

  const results = await Promise.all(
    ids.map(async id => {
      const pts = await fetchFredSeries(id, fromStr);
      if (!pts.length) return { id, latest: null, prev: null };
      return { id, latest: pts.at(-1)!, prev: pts.length > 1 ? pts.at(-2)! : null };
    })
  );

  const okCount = results.filter(r => r.latest !== null).length;
  console.log(`[fred] list: ${okCount}/${ids.length} ok`);

  if (okCount > 0) cache.set(key, { data: results, ts: Date.now() });
  else {
    const stale = getCached(key, STALE);
    if (stale) return NextResponse.json(stale, { headers: CACHE_HEADERS });
  }
  return NextResponse.json(results, { headers: CACHE_HEADERS });
}
