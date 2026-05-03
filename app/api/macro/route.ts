import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';

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

// ---------- Yahoo Finance yields (^TNX = 10Y, works from Vercel) ----------
const YAHOO_YIELD_MAP: Record<string, string> = {
  'DGS10': '^TNX',  // US 10-Year Treasury Note Yield (in %)
  'DGS2':  '^IRX',  // 13-week T-bill as rough 2Y proxy — replaced by Treasury CSV when available
};

async function fetchYahooYield(
  yahooSym: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const from = fromDate ? new Date(fromDate) : new Date('2000-01-01');
  const to   = new Date();
  const daysAgo = (Date.now() - from.getTime()) / 86_400_000;
  const interval: '1d' | '1wk' | '1mo' = daysAgo > 1500 ? '1mo' : daysAgo > 300 ? '1wk' : '1d';
  try {
    const pts = await fetchYahooChart(yahooSym, from, to, interval);
    return pts.map(p => ({ date: p.date, value: p.close }));
  } catch (e) {
    console.error(`[yahoo-yield] ${yahooSym} failed:`, (e as Error).message);
    return [];
  }
}

// ---------- NY Fed EFFR (Effective Federal Funds Rate, no key) ----------
// JSON API is simpler and avoids date-format ambiguity in the CSV endpoint.
async function fetchNYFedEffr(
  fromDate?: string,
  timeoutMs = 5_000,
): Promise<{ date: string; value: number }[]> {
  const url = 'https://markets.newyorkfed.org/api/rates/effr/all/data.json';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' },
    });
    if (!res.ok) { console.error(`[nyfed] effr HTTP ${res.status}`); return []; }
    const json = await res.json() as { refRates?: { effectiveDate: string; percentRate: number }[] };
    const rates = json?.refRates ?? [];
    const pts: { date: string; value: number }[] = [];
    for (const r of rates) {
      const date = r.effectiveDate;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!isFinite(r.percentRate)) continue;
      if (fromDate && date < fromDate) continue;
      pts.push({ date, value: r.percentRate });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[nyfed] effr loaded ${pts.length} points`);
    return pts;
  } catch (e) {
    console.error('[nyfed] effr failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- US Treasury Daily Yield Curve (free, no key) ----------
// Provides DGS2 ("2 Yr") and can supplement DGS10 ("10 Yr") when FRED/Yahoo fail.
// URL: https://home.treasury.gov/resource-center/data-chart-center/interest-rates/
//      daily-treasury-rates.csv/all/all?type=daily_treasury_yield_curve&...
const TREASURY_COL: Record<string, string> = {
  'DGS2':  '2 Yr',
  'DGS10': '10 Yr',
};

async function fetchUSTreasury(
  fredId: string,
  fromDate?: string,
  timeoutMs = 10_000,
): Promise<{ date: string; value: number }[]> {
  const col = TREASURY_COL[fredId];
  if (!col) return [];
  const url =
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' +
    '/daily-treasury-rates.csv/all/all?type=daily_treasury_yield_curve' +
    '&field_tdr_date_value=all&download=true';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*', 'Referer': 'https://home.treasury.gov/' },
    });
    if (!res.ok) { console.error(`[treasury] HTTP ${res.status}`); return []; }
    const csv = await res.text();
    if (!csv || csv.length < 50) return [];
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    // Header: Date,1 Mo,2 Mo,3 Mo,4 Mo,6 Mo,1 Yr,2 Yr,3 Yr,5 Yr,7 Yr,10 Yr,20 Yr,30 Yr,...
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const colIdx = headers.indexOf(col);
    if (colIdx === -1) { console.warn(`[treasury] column '${col}' not found`); return []; }
    const pts: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length <= colIdx) continue;
      const raw = parts[0].trim().replace(/"/g, '');   // MM/DD/YYYY
      const segs = raw.split('/');
      if (segs.length !== 3) continue;
      const date = `${segs[2]}-${segs[0].padStart(2, '0')}-${segs[1].padStart(2, '0')}`;
      if (fromDate && date < fromDate) continue;
      const val = parseFloat(parts[colIdx].trim().replace(/"/g, ''));
      if (isFinite(val)) pts.push({ date, value: val });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[treasury] ${fredId} loaded ${pts.length} points`);
    return pts;
  } catch (e) {
    console.error(`[treasury] ${fredId} failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- ECB Data Portal (Deposit Facility Rate = ECBDFR, no key) ----------
async function fetchECBRate(
  fromDate?: string,
  timeoutMs = 8_000,
): Promise<{ date: string; value: number }[]> {
  // ECB Statistical Data Warehouse — Deposit Facility Rate (DFR)
  const url =
    'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV' +
    '?format=csvdata&detail=dataonly';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*' },
    });
    if (!res.ok) { console.error(`[ecb] DFR HTTP ${res.status}`); return []; }
    const csv = await res.text();
    if (!csv || csv.length < 20) return [];
    const lines = csv.trim().split('\n');
    // ECB csvdata format: KEY,FREQ,REF_AREA,...,TIME_PERIOD,OBS_VALUE,...
    // or compacted: KEY,OBS_DIM0,OBS_VALUE,...
    // Find header to locate TIME_PERIOD and OBS_VALUE columns
    const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const timeIdx = header.indexOf('TIME_PERIOD');
    const valIdx  = header.indexOf('OBS_VALUE');
    if (timeIdx === -1 || valIdx === -1) {
      console.warn('[ecb] unexpected CSV header:', lines[0].slice(0, 120));
      return [];
    }
    const pts: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length <= Math.max(timeIdx, valIdx)) continue;
      const date = parts[timeIdx].trim().replace(/"/g, '');
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(date)) continue;
      // ECB dates are YYYY-MM or YYYY-MM-DD; normalise to YYYY-MM-01 when no day
      const normDate = date.length === 7 ? `${date}-01` : date;
      if (fromDate && normDate < fromDate) continue;
      const val = parseFloat(parts[valIdx].trim().replace(/"/g, ''));
      if (isFinite(val)) pts.push({ date: normDate, value: val });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[ecb] DFR loaded ${pts.length} points`);
    return pts;
  } catch (e) {
    console.error('[ecb] DFR failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- BLS public API ----------
// Maps FRED series IDs to BLS series IDs.
const BLS_MAP: Record<string, string> = {
  'UNRATE':   'LNS14000000',    // Unemployment Rate (seasonally adj.)
  'PAYEMS':   'CES0000000001',  // Total Nonfarm Payrolls (thousands)
  'CPIAUCSL': 'CUUR0000SA0',    // CPI All Urban, All Items
  'CPILFESL': 'CUUR0000SA0L1E', // CPI Less Food & Energy
};

type BlsRow = { year: string; period: string; value: string };
type BlsSeries = { seriesID: string; data: BlsRow[] };

// Batch-fetch multiple BLS series in ONE API call (25 queries/day limit per IP).
// Returns a map from BLS series ID → sorted points.
async function fetchBLSBatch(
  blsIds: string[],
  fromDate?: string,
  timeoutMs = 12_000,
): Promise<Map<string, { date: string; value: number }[]>> {
  const result = new Map<string, { date: string; value: number }[]>();
  if (!blsIds.length) return result;
  const fromYear = fromDate ? fromDate.slice(0, 4) : String(new Date().getFullYear() - 5);
  const toYear   = String(new Date().getFullYear());
  const body = JSON.stringify({ seriesid: blsIds, startyear: fromYear, endyear: toYear });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body,
    });
    if (!res.ok) { console.error(`[bls-batch] HTTP ${res.status}`); return result; }
    const json = await res.json() as { Results?: { series?: BlsSeries[] } };
    for (const s of json?.Results?.series ?? []) {
      const pts: { date: string; value: number }[] = [];
      for (const r of s.data) {
        if (!r.period.startsWith('M')) continue;
        const month = r.period.slice(1).padStart(2, '0');
        const date  = `${r.year}-${month}-01`;
        const val   = parseFloat(r.value);
        if (isFinite(val)) pts.push({ date, value: val });
      }
      pts.sort((a, b) => a.date.localeCompare(b.date));
      result.set(s.seriesID, pts);
    }
    console.log(`[bls-batch] loaded ${result.size}/${blsIds.length} series`);
    return result;
  } catch (e) {
    console.error('[bls-batch] failed:', (e as Error).message);
    return result;
  } finally {
    clearTimeout(t);
  }
}

// Single-series BLS fetch (used in history mode)
async function fetchBLS(
  blsId: string,
  fromDate?: string,
  timeoutMs = 10_000,
): Promise<{ date: string; value: number }[]> {
  const batch = await fetchBLSBatch([blsId], fromDate, timeoutMs);
  return batch.get(blsId) ?? [];
}

// ---------- Master fetch: FRED → Yahoo/NYFed/BLS fallback ----------
async function fetchMacroSeries(
  fredId: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  // T10Y2Y: compute as DGS10 - DGS2 when FRED is blocked
  if (fredId === 'T10Y2Y') {
    const fred = await fetchFRED('T10Y2Y', fromDate);
    if (fred.length > 0) return fred;
    const [d10, d2] = await Promise.all([
      fetchMacroSeries('DGS10', fromDate),
      fetchFRED('DGS2', fromDate),
    ]);
    if (!d10.length || !d2.length) return [];
    const map2 = new Map(d2.map(p => [p.date, p.value]));
    return d10.filter(p => map2.has(p.date)).map(p => ({ date: p.date, value: p.value - map2.get(p.date)! }));
  }

  // Try FRED first (works when FRED_API_KEY is set or FRED isn't blocked)
  const fred = await fetchFRED(fredId, fromDate);
  if (fred.length > 0) return fred;

  // US Treasury CSV — exact DGS2 and DGS10 (better than Yahoo proxy for yields)
  if (TREASURY_COL[fredId]) {
    const pts = await fetchUSTreasury(fredId, fromDate);
    if (pts.length > 0) { console.log(`[macro] ${fredId} loaded from US Treasury`); return pts; }
  }

  // Yahoo Finance fallback for Treasury yields (rough proxy when Treasury CSV fails)
  const yahooSym = YAHOO_YIELD_MAP[fredId];
  if (yahooSym) {
    const pts = await fetchYahooYield(yahooSym, fromDate);
    if (pts.length > 0) { console.log(`[macro] ${fredId} loaded from Yahoo (${yahooSym})`); return pts; }
  }

  // NY Fed fallback for Fed Funds Rate
  if (fredId === 'DFF') {
    const pts = await fetchNYFedEffr(fromDate);
    if (pts.length > 0) { console.log(`[macro] DFF loaded from NY Fed`); return pts; }
  }

  // ECB fallback for ECB Deposit Facility Rate
  if (fredId === 'ECBDFR') {
    const pts = await fetchECBRate(fromDate);
    if (pts.length > 0) { console.log(`[macro] ECBDFR loaded from ECB API`); return pts; }
  }

  // BLS fallback for employment / inflation
  const blsSym = BLS_MAP[fredId];
  if (blsSym) {
    const pts = await fetchBLS(blsSym, fromDate);
    if (pts.length > 0) { console.log(`[macro] ${fredId} loaded from BLS`); return pts; }
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

  // ── Parallel fetch: FRED + all fallback sources start simultaneously ──
  // FRED is blocked on most Vercel IPs; 2s timeout lets it fail fast instead
  // of burning 12s (two endpoints × 6s each) before fallbacks even start.
  const allBlsIds = ids.filter(id => BLS_MAP[id]).map(id => BLS_MAP[id]);
  const needsT2  = ids.some(id => id === 'DGS2'  || id === 'T10Y2Y');
  const needsT10 = ids.some(id => id === 'DGS10' || id === 'T10Y2Y');

  type Pts = { date: string; value: number }[];
  // Cap Yahoo at 6s — it's a last resort and we must stay under the 10s Lambda limit
  const cap6 = <T>(p: Promise<T>, fb: T): Promise<T> =>
    Promise.race([p, new Promise<T>(r => setTimeout(() => r(fb), 6_000))]);

  const needsYTnx = ids.includes('DGS10') || ids.includes('T10Y2Y');
  const needsYIrx = ids.includes('DGS2')  || ids.includes('T10Y2Y');

  const [fredResults, blsBatch, tDgs2, tDgs10, nyFedPts, ecbPts, yahooTnx, yahooIrx] = await Promise.all([
    Promise.all(ids.map(id => fetchFRED(id, fromStr, 2_000).then(pts => ({ id, pts })))),
    allBlsIds.length
      ? fetchBLSBatch(allBlsIds, fromStr, 6_000)
      : Promise.resolve(new Map<string, Pts>()),
    needsT2  ? fetchUSTreasury('DGS2',  fromStr, 5_000) : Promise.resolve<Pts>([]),
    needsT10 ? fetchUSTreasury('DGS10', fromStr, 5_000) : Promise.resolve<Pts>([]),
    ids.includes('DFF')    ? fetchNYFedEffr(fromStr, 5_000) : Promise.resolve<Pts>([]),
    ids.includes('ECBDFR') ? fetchECBRate(fromStr,  4_000)  : Promise.resolve<Pts>([]),
    needsYTnx ? cap6(fetchYahooYield('^TNX', fromStr), [] as Pts) : Promise.resolve<Pts>([]),
    needsYIrx ? cap6(fetchYahooYield('^IRX', fromStr), [] as Pts) : Promise.resolve<Pts>([]),
  ]);

  const fredMap = new Map(fredResults.map(r => [r.id, r.pts]));
  const needFallback = ids.filter(id => (fredMap.get(id) ?? []).length === 0);

  // T10Y2Y: compute spread from best available DGS10 + DGS2
  let t10y2yPts: Pts = [];
  if (needFallback.includes('T10Y2Y')) {
    const d10 = (fredMap.get('DGS10') ?? []).length ? fredMap.get('DGS10')!
      : tDgs10.length ? tDgs10 : yahooTnx;
    const d2  = (fredMap.get('DGS2')  ?? []).length ? fredMap.get('DGS2')!
      : tDgs2.length  ? tDgs2  : yahooIrx;
    if (d10.length && d2.length) {
      const m2 = new Map(d2.map(p => [p.date, p.value]));
      t10y2yPts = d10.filter(p => m2.has(p.date))
        .map(p => ({ date: p.date, value: p.value - m2.get(p.date)! }));
    }
  }

  // Assemble final results
  const results = ids.map(id => {
    let pts = fredMap.get(id) ?? [];
    if (!pts.length) { const blsSym = BLS_MAP[id]; if (blsSym) pts = blsBatch.get(blsSym) ?? []; }
    if (!pts.length && id === 'DFF')    pts = nyFedPts;
    if (!pts.length && id === 'ECBDFR') pts = ecbPts;
    if (!pts.length && id === 'DGS2')   pts = tDgs2.length  ? tDgs2  : yahooIrx;
    if (!pts.length && id === 'DGS10')  pts = tDgs10.length ? tDgs10 : yahooTnx;
    if (!pts.length && id === 'T10Y2Y') pts = t10y2yPts;
    if (!pts.length) return { id, latest: null, prev: null };
    return {
      id,
      latest: pts[pts.length - 1],
      prev: pts.length > 1 ? pts[pts.length - 2] : null,
    };
  });

  const okCount = results.filter(r => r.latest != null).length;
  console.log(`[macro] list: ${okCount}/${ids.length} series (FRED ${ids.length - needFallback.length}, fallback ${okCount - (ids.length - needFallback.length)})`);

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
