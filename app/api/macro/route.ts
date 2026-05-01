import { NextRequest, NextResponse } from 'next/server';

// Explicitly use Node.js runtime (not Edge) so FRED requests come from AWS Lambda IPs.
export const runtime = 'nodejs';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60_000;
const STALE = 6 * 60 * 60_000;

function getCached(key: string, ttl: number) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < ttl) return e.data;
  return null;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- FRED API (preferred when FRED_API_KEY is set) ----------
async function fetchFREDApi(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'asc',
  });
  if (fromDate) params.set('observation_start', fromDate);
  const url = `https://api.stlouisfed.org/fred/series/observations?${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.error(`[fred-api] ${seriesId} HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as { observations?: { date: string; value: string }[] };
    const obs = json.observations ?? [];
    const points: { date: string; value: number }[] = [];
    for (const o of obs) {
      const num = parseFloat(o.value);
      if (!isNaN(num) && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
        points.push({ date: o.date, value: num });
      }
    }
    return points;
  } catch (e) {
    console.error(`[fred-api] ${seriesId} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- FRED public CSV (no key, sometimes blocked) ----------
async function fetchFREDCsv(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const params = new URLSearchParams({ id: seriesId });
  if (fromDate) params.set('cosd', fromDate);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/csv,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://fred.stlouisfed.org/',
      },
    });
    if (!res.ok) {
      console.error(`[fred-csv] ${seriesId} HTTP ${res.status}`);
      return [];
    }
    const csv = await res.text();
    if (!csv || csv.length < 10) {
      console.error(`[fred-csv] ${seriesId} empty/short response`);
      return [];
    }
    const lines = csv.trim().split('\n');
    const points: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(',');
      if (parts.length < 2) continue;
      const date = parts[0].trim();
      const num = parseFloat(parts[1].trim());
      if (!isNaN(num) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        points.push({ date, value: num });
      }
    }
    if (points.length === 0) {
      console.warn(`[fred-csv] ${seriesId} parsed zero points; head:`, csv.slice(0, 120));
    }
    return points;
  } catch (e) {
    console.error(`[fred-csv] ${seriesId} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- FRED legacy .txt endpoint (tab-separated, no key required) ----------
async function fetchFREDTxt(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const url = `https://fred.stlouisfed.org/data/${encodeURIComponent(seriesId)}.txt`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'text/plain,*/*' },
    });
    if (!res.ok) {
      console.error(`[fred-txt] ${seriesId} HTTP ${res.status}`);
      return [];
    }
    const txt = await res.text();
    const lines = txt.split('\n');
    const points: { date: string; value: number }[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const date = parts[0].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (fromDate && date < fromDate) continue;
      const num = parseFloat(parts[1].trim());
      if (!isNaN(num)) points.push({ date, value: num });
    }
    return points;
  } catch (e) {
    console.error(`[fred-txt] ${seriesId} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- Combined FRED fetch with fallback chain ----------
async function fetchFRED(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  // 1. JSON API (requires FRED_API_KEY env var — most reliable)
  if (process.env.FRED_API_KEY) {
    const api = await fetchFREDApi(seriesId, fromDate, timeoutMs);
    if (api.length > 0) return api;
  }
  // 2. Public CSV endpoint
  const csv = await fetchFREDCsv(seriesId, fromDate, timeoutMs);
  if (csv.length > 0) return csv;
  // 3. Legacy .txt endpoint (tab-separated, different URL path)
  return fetchFREDTxt(seriesId, fromDate, timeoutMs);
}

// ---------- Stooq (free, works from Vercel, no key) ----------
// Maps selected FRED rate series to Stooq symbols.
const STOOQ_MAP: Record<string, string> = {
  'DGS10':       '10usy.b',    // US 10-Year Treasury
  'DGS2':        '2usy.b',     // US 2-Year Treasury
  'DFF':         'fffunds.b',  // Effective Fed Funds Rate
  'MORTGAGE30US':'30usmr.b',   // 30-Year Mortgage Rate
};

async function fetchStooq(
  symbol: string,
  fromDate?: string,
  timeoutMs = 7_000,
): Promise<{ date: string; value: number }[]> {
  const d1 = fromDate ? fromDate.replace(/-/g, '') : '19900101';
  const d2 = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d1}&d2=${d2}&i=d`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,text/plain,*/*' },
    });
    if (!res.ok) { console.error(`[stooq] ${symbol} HTTP ${res.status}`); return []; }
    const csv = await res.text();
    if (!csv || csv.length < 20 || csv.includes('No data')) return [];
    const lines = csv.trim().split('\n');
    const pts: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const date = cols[0].trim();
      const close = parseFloat(cols[4].trim()); // Close column
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isFinite(close) && close > 0) {
        pts.push({ date, value: close });
      }
    }
    return pts;
  } catch (e) {
    console.error(`[stooq] ${symbol} failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- BLS public API (free, no key, works from Vercel) ----------
// Covers employment and inflation series.
const BLS_MAP: Record<string, string> = {
  'UNRATE':   'LNS14000000',   // Unemployment Rate (seasonally adj.)
  'PAYEMS':   'CES0000000001', // Total Nonfarm Payrolls (thousands)
  'CPIAUCSL': 'CUUR0000SA0',   // CPI All Urban, All Items (not SA)
  'CPILFESL': 'CUUR0000SA0L1E',// CPI Less Food & Energy
};

async function fetchBLS(
  blsSeriesId: string,
  fromDate?: string,
  timeoutMs = 9_000,
): Promise<{ date: string; value: number }[]> {
  const fromYear = fromDate ? fromDate.slice(0, 4) : '2010';
  const toYear   = String(new Date().getFullYear());
  const url = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
  const body = JSON.stringify({ seriesid: [blsSeriesId], startyear: fromYear, endyear: toYear });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) { console.error(`[bls] ${blsSeriesId} HTTP ${res.status}`); return []; }
    const json = await res.json() as {
      Results?: { series?: Array<{ data: Array<{ year: string; period: string; value: string }> }> };
    };
    const rows = json?.Results?.series?.[0]?.data ?? [];
    if (!rows.length) return [];
    const pts: { date: string; value: number }[] = [];
    for (const r of rows) {
      if (!r.period.startsWith('M')) continue; // skip annual rows
      const month = r.period.slice(1).padStart(2, '0');
      const date  = `${r.year}-${month}-01`;
      const val   = parseFloat(r.value);
      if (isFinite(val)) pts.push({ date, value: val });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch (e) {
    console.error(`[bls] ${blsSeriesId} failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- Master fetch: FRED → Stooq / BLS fallback ----------
async function fetchMacroSeries(
  fredId: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  // T10Y2Y is a computed spread — handle separately
  if (fredId === 'T10Y2Y') {
    const stooqId10 = STOOQ_MAP['DGS10'];
    const stooqId2  = STOOQ_MAP['DGS2'];
    const [d10, d2] = await Promise.all([
      fetchFRED('DGS10', fromDate).then(d => d.length > 0 ? d : fetchStooq(stooqId10, fromDate)),
      fetchFRED('DGS2',  fromDate).then(d => d.length > 0 ? d : fetchStooq(stooqId2,  fromDate)),
    ]);
    if (!d10.length || !d2.length) return [];
    const map2 = new Map(d2.map(p => [p.date, p.value]));
    return d10.filter(p => map2.has(p.date)).map(p => ({ date: p.date, value: p.value - map2.get(p.date)! }));
  }

  // Try FRED first (works when FRED_API_KEY is set, or if not blocked)
  const fred = await fetchFRED(fredId, fromDate);
  if (fred.length > 0) return fred;

  // Stooq fallback for rate series
  const stooqSym = STOOQ_MAP[fredId];
  if (stooqSym) {
    const sq = await fetchStooq(stooqSym, fromDate);
    if (sq.length > 0) { console.log(`[macro] ${fredId} loaded from Stooq`); return sq; }
  }

  // BLS fallback for employment / inflation
  const blsSym = BLS_MAP[fredId];
  if (blsSym) {
    const bls = await fetchBLS(blsSym, fromDate);
    if (bls.length > 0) { console.log(`[macro] ${fredId} loaded from BLS`); return bls; }
  }

  return [];
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'list';

  // Historical data for one series
  if (mode === 'history') {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });
    const from = req.nextUrl.searchParams.get('from') ?? undefined;
    const key = `hist:${id}:${from ?? ''}`;
    const cached = getCached(key, TTL);
    if (cached) return NextResponse.json(cached);
    try {
      const pts = await fetchMacroSeries(id, from);
      const data = pts.map(p => ({ date: p.date, close: p.value }));
      if (data.length > 0) {
        cache.set(key, { data, ts: Date.now() });
      } else {
        const stale = getCached(key, STALE);
        if (stale) return NextResponse.json(stale);
      }
      return NextResponse.json(data);
    } catch (err) {
      console.error('macro history error', id, err);
      const stale = getCached(key, STALE);
      if (stale) return NextResponse.json(stale);
      return NextResponse.json([], { status: 200 });
    }
  }

  // Latest values for a list of series
  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').filter(Boolean);
  if (!ids.length) return NextResponse.json([]);

  const key = `list:${[...ids].sort().join(',')}`;
  const cached = getCached(key, TTL);
  if (cached) return NextResponse.json(cached);

  // Fetch last ~6 months so we always have latest + previous observation
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  const fromStr = from.toISOString().split('T')[0];

  // Parallelize ALL requests (each is to a different series URL — no batching needed)
  const results = await Promise.all(ids.map(async (id) => {
    const pts = await fetchMacroSeries(id, fromStr);
    if (pts.length === 0) return { id, latest: null, prev: null };
    return {
      id,
      latest: pts[pts.length - 1],
      prev: pts.length > 1 ? pts[pts.length - 2] : null,
    };
  }));

  const okCount = results.filter(r => r.latest != null).length;
  console.log(`[macro] list: ${okCount}/${ids.length} series loaded`);

  // Don't cache an all-empty response (probably a transient FRED issue)
  if (okCount > 0) {
    cache.set(key, { data: results, ts: Date.now() });
  } else {
    // Serve stale cache on total failure
    const stale = getCached(key, STALE);
    if (stale) return NextResponse.json(stale);
  }
  return NextResponse.json(results);
}
