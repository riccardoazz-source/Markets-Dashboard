import { NextRequest, NextResponse } from 'next/server';

// Edge runtime: near-zero cold start + same network that works for Yahoo Finance
// in /api/historical and /api/crypto. Node.js was tried to get different IPs for
// FRED, but FRED is blocked regardless — edge is strictly better here.
export const runtime = 'edge';

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

// ---------- Yahoo Finance yields (^TNX = 10Y, ^IRX = 13W T-Bill) ----------
const YAHOO_YIELD_MAP: Record<string, string> = {
  'DGS10': '^TNX',
  'DGS2':  '^IRX', // 13W T-Bill proxy — replaced by Treasury CSV when available
};

// Uses range-based queries directly, bypassing the period-based path in
// fetchYahooChart which can take >6s (two hosts × 8s) before failing over.
async function fetchYahooYield(
  yahooSym: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const daysAgo = fromDate
    ? (Date.now() - new Date(fromDate).getTime()) / 86_400_000
    : 180;
  const rangeParam = daysAgo > 3500 ? 'max' : daysAgo > 1500 ? '10y'
    : daysAgo > 800 ? '5y' : daysAgo > 300 ? '1y' : '6mo';
  const interval: '1d' | '1wk' | '1mo' = daysAgo > 1500 ? '1mo'
    : daysAgo > 300 ? '1wk' : '1d';

  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSym)}` +
      `?range=${rangeParam}&interval=${interval}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal, cache: 'no-store',
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
      });
      if (!res.ok) { console.warn(`[yahoo-yield] ${yahooSym} ${host} HTTP ${res.status}`); continue; }
      const json = await res.json() as { chart?: { result?: unknown[] } };
      const result = json?.chart?.result?.[0] as Record<string, unknown> | undefined;
      if (!result) { console.warn(`[yahoo-yield] ${yahooSym} ${host} no result`); continue; }
      const timestamps = (result.timestamp as number[]) ?? [];
      const closes = (
        (result.indicators as Record<string, unknown>)?.quote as Array<Record<string, unknown>>
      )?.[0]?.close as number[] ?? [];
      const pts: { date: string; value: number }[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c == null || !isFinite(c) || c <= 0) continue;
        pts.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), value: c });
      }
      pts.sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length > 0) {
        console.log(`[yahoo-yield] ${yahooSym} ${host}: ${pts.length} pts`);
        return pts;
      }
    } catch (e) {
      console.error(`[yahoo-yield] ${yahooSym} ${host}:`, (e as Error).message);
    } finally {
      clearTimeout(t);
    }
  }
  console.warn(`[yahoo-yield] ${yahooSym} all hosts failed`);
  return [];
}

// ---------- NY Fed EFFR (Effective Federal Funds Rate, no key) ----------
// recentOnly=true → last/10.json (~500 B); false → all/data.json (full history, ~2 MB).
async function fetchNYFedEffr(
  fromDate?: string,
  timeoutMs = 5_000,
  recentOnly = false,
): Promise<{ date: string; value: number }[]> {
  // For list mode we only need 2 points; last/10 is ~500 B vs all/data ~2 MB.
  const url = recentOnly
    ? 'https://markets.newyorkfed.org/api/rates/effr/last/10.json'
    : 'https://markets.newyorkfed.org/api/rates/effr/all/data.json';
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
    console.log(`[nyfed] effr loaded ${pts.length} points (recentOnly=${recentOnly})`);
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

function buildTreasuryUrl(year?: number): string {
  const base = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates';
  const suffix = '?type=daily_treasury_yield_curve&download=true';
  if (year) return `${base}/daily-treasury-rates.csv/${year}/all${suffix}`;
  return `${base}/daily-treasury-rates.csv/all/all${suffix}&field_tdr_date_value=all`;
}

function parseTreasuryCsv(csv: string, col: string, fromDate?: string) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const colIdx = headers.indexOf(col);
  if (colIdx === -1) return [];
  const pts: { date: string; value: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length <= colIdx) continue;
    const raw = parts[0].trim().replace(/"/g, ''); // MM/DD/YYYY
    const segs = raw.split('/');
    if (segs.length !== 3) continue;
    const date = `${segs[2]}-${segs[0].padStart(2, '0')}-${segs[1].padStart(2, '0')}`;
    if (fromDate && date < fromDate) continue;
    const val = parseFloat(parts[colIdx].trim().replace(/"/g, ''));
    if (isFinite(val)) pts.push({ date, value: val });
  }
  pts.sort((a, b) => a.date.localeCompare(b.date));
  return pts;
}

async function fetchUSTreasury(
  fredId: string,
  fromDate?: string,
  timeoutMs = 5_000,
  recentOnly = false,
): Promise<{ date: string; value: number }[]> {
  const col = TREASURY_COL[fredId];
  if (!col) return [];

  const tryUrl = async (url: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal, cache: 'no-store',
        headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*', 'Referer': 'https://home.treasury.gov/' },
      });
      if (!res.ok) { console.error(`[treasury] HTTP ${res.status} for ${url}`); return null; }
      return await res.text();
    } catch (e) {
      console.error(`[treasury] ${fredId} failed:`, (e as Error).message);
      return null;
    } finally { clearTimeout(t); }
  };

  if (recentOnly) {
    // For list mode: only need latest + prev — fetch current year CSV (~80 rows vs 20k)
    const now = new Date();
    for (const yr of [now.getFullYear(), now.getFullYear() - 1]) {
      const csv = await tryUrl(buildTreasuryUrl(yr));
      if (!csv || csv.length < 50) continue;
      const pts = parseTreasuryCsv(csv, col, fromDate);
      if (pts.length > 0) {
        console.log(`[treasury] ${fredId} loaded ${pts.length} pts from ${yr}`);
        return pts;
      }
    }
    return [];
  }

  // History mode: fetch full dataset
  const csv = await tryUrl(buildTreasuryUrl());
  if (!csv || csv.length < 50) return [];
  const pts = parseTreasuryCsv(csv, col, fromDate);
  console.log(`[treasury] ${fredId} loaded ${pts.length} points`);
  return pts;
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

// ---------- Master fetch: all sources in parallel, first hit wins ----------
async function fetchMacroSeries(
  fredId: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  type Pts = { date: string; value: number }[];

  // T10Y2Y is computed as DGS10 - DGS2
  if (fredId === 'T10Y2Y') {
    const [fredSpread, d10, d2] = await Promise.all([
      fetchFRED('T10Y2Y', fromDate, 2_000),
      fetchMacroSeries('DGS10', fromDate),
      fetchMacroSeries('DGS2',  fromDate),
    ]);
    if (fredSpread.length > 0) return fredSpread;
    if (!d10.length || !d2.length) return [];
    const map2 = new Map(d2.map(p => [p.date, p.value]));
    return d10.filter(p => map2.has(p.date))
      .map(p => ({ date: p.date, value: p.value - map2.get(p.date)! }));
  }

  const yahooSym = YAHOO_YIELD_MAP[fredId];
  const blsSym = BLS_MAP[fredId];

  // Fire all sources in parallel — drastically faster than sequential fallbacks.
  // Wall time = max(each source) instead of sum(each source).
  const [fred, treasury, yahoo, nyFed, yahooDff, ecb, bls] = await Promise.all([
    fetchFRED(fredId, fromDate, 2_000),
    TREASURY_COL[fredId] ? fetchUSTreasury(fredId, fromDate, 6_000) : Promise.resolve<Pts>([]),
    yahooSym             ? fetchYahooYield(yahooSym, fromDate)      : Promise.resolve<Pts>([]),
    fredId === 'DFF'     ? fetchNYFedEffr(fromDate, 6_000)          : Promise.resolve<Pts>([]),
    // ^IRX (13W T-Bill) ≈ Fed Funds Rate within ~10 bps — used as DFF proxy
    fredId === 'DFF'     ? fetchYahooYield('^IRX', fromDate)        : Promise.resolve<Pts>([]),
    fredId === 'ECBDFR'  ? fetchECBRate(fromDate, 6_000)            : Promise.resolve<Pts>([]),
    blsSym               ? fetchBLS(blsSym, fromDate, 6_000)        : Promise.resolve<Pts>([]),
  ]);

  // Priority: most authoritative source first
  if (fred.length)     { console.log(`[macro] ${fredId} from FRED (${fred.length} pts)`);   return fred; }
  if (treasury.length) { console.log(`[macro] ${fredId} from Treasury (${treasury.length} pts)`); return treasury; }
  if (nyFed.length)    { console.log(`[macro] ${fredId} from NY Fed (${nyFed.length} pts)`); return nyFed; }
  if (ecb.length)      { console.log(`[macro] ${fredId} from ECB (${ecb.length} pts)`);     return ecb; }
  if (bls.length)      { console.log(`[macro] ${fredId} from BLS (${bls.length} pts)`);     return bls; }
  if (yahoo.length)    { console.log(`[macro] ${fredId} from Yahoo (${yahoo.length} pts)`); return yahoo; }
  if (yahooDff.length) { console.log(`[macro] DFF from Yahoo ^IRX proxy (${yahooDff.length} pts)`); return yahooDff; }

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

  const needsYTnx = ids.includes('DGS10') || ids.includes('T10Y2Y');
  // ^IRX is also the DFF fallback (13W T-Bill ≈ Fed Funds Rate within ~10 bps)
  const needsYIrx = ids.includes('DGS2') || ids.includes('T10Y2Y') || ids.includes('DFF');

  const [fredResults, blsBatch, tDgs2, tDgs10, nyFedPts, ecbPts, yahooTnx, yahooIrx] = await Promise.all([
    Promise.all(ids.map(id => fetchFRED(id, fromStr, 2_000).then(pts => ({ id, pts })))),
    allBlsIds.length
      ? fetchBLSBatch(allBlsIds, fromStr, 6_000)
      : Promise.resolve(new Map<string, Pts>()),
    needsT2  ? fetchUSTreasury('DGS2',  fromStr, 5_000, true) : Promise.resolve<Pts>([]),
    needsT10 ? fetchUSTreasury('DGS10', fromStr, 5_000, true) : Promise.resolve<Pts>([]),
    ids.includes('DFF')    ? fetchNYFedEffr(fromStr, 5_000, true) : Promise.resolve<Pts>([]),
    ids.includes('ECBDFR') ? fetchECBRate(fromStr,  4_000)  : Promise.resolve<Pts>([]),
    // fetchYahooYield has its own 4s-per-host timeout (max 8s), so no outer cap needed
    needsYTnx ? fetchYahooYield('^TNX', fromStr) : Promise.resolve<Pts>([]),
    needsYIrx ? fetchYahooYield('^IRX', fromStr) : Promise.resolve<Pts>([]),
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
    // DFF: NY Fed JSON → Yahoo ^IRX (13W T-Bill ≈ Fed Funds Rate within ~10 bps)
    if (!pts.length && id === 'DFF')    pts = nyFedPts.length ? nyFedPts : yahooIrx;
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
