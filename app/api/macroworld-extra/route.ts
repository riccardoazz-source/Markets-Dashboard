import { NextResponse } from 'next/server';
import { IMF_SUMMARY_CODES, IMF_COUNTRY_INDEX } from '@/lib/imfConfig';
import { fetchYahooChart } from '@/lib/yahoo';

// Edge runtime + DBnomics: the exact same network path that already powers the
// Macro section's DBnomics/FRED fetches in production (works on Vercel, unlike the
// IMF DataMapper / OECD SDMX which block datacenter IPs).
export const runtime = 'edge';
export const maxDuration = 25;

// ─────────────────────────────────────────────────────────────────────────────
// Macro World "extra" metrics that the World Bank indicator API does not carry:
//   • Central bank policy rate           — IMF IFS  FPOLM_PA (monthly, ISO-2 areas)
//   • Real GDP growth forecast (next yr) — IMF WEO  NGDP_RPCH   (has forecast years)
//   • General govt gross debt, % of GDP  — IMF WEO  GGXWDG_NGDP (broad coverage)
// All via DBnomics REST JSON. Everything degrades to null on failure so the caller
// simply shows "—" — it can never break the World Bank data.
//
//   GET /api/macroworld-extra?mode=summary → { ISO3: { policyRate, gdpFcst…, debt } }
// ─────────────────────────────────────────────────────────────────────────────

const DB = 'https://api.db.nomics.world/v22';
const TTL = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Metric = { value: number; year: string } | null;
type ExtraMap = Record<string, { policyRate: Metric; gdpFcstCurr: Metric; gdpFcstNext: Metric; debt: Metric }>;
interface Cached { data: ExtraMap; ts: number }
let cache: Cached | null = null;

// ISO3 → the IMF IFS REF_AREA (ISO-2) code for the policy rate (FPOLM_PA). Euro-area
// members share the ECB rate → all map to "U2". Areas IFS doesn't cover → null.
const POLICY_CC: Record<string, string> = {
  USA: 'US', EMU: 'U2', DEU: 'U2', FRA: 'U2', ITA: 'U2', ESP: 'U2', NLD: 'U2',
  JPN: 'JP', GBR: 'GB', CHE: 'CH', SWE: 'SE', CAN: 'CA', AUS: 'AU', NZL: 'NZ',
  POL: 'PL', RUS: 'RU', CHN: 'CN', IND: 'IN', IDN: 'ID', KOR: 'KR', MEX: 'MX',
  BRA: 'BR', CHL: 'CL', COL: 'CO', PER: 'PE', ZAF: 'ZA', TUR: 'TR', SAU: 'SA',
  THA: 'TH', ISR: 'IL', ARE: 'AE', SGP: 'SG', VNM: 'VN', NGA: 'NG', EGY: 'EG',
  KEN: 'KE', MAR: 'MA',
};

interface DbDoc { period?: string[]; value?: (number | string | null)[]; dimensions?: Record<string, string> }

async function dbFetch(url: string, timeoutMs = 7_000): Promise<{ series?: { docs?: DbDoc[] } } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' }, next: { revalidate: 86400 } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// Last finite observation of a DBnomics doc (optionally at/least a given year).
function lastFinite(doc: DbDoc, notAfterYear?: number): Metric {
  const periods = doc.period ?? [];
  const values = doc.value ?? [];
  for (let i = periods.length - 1; i >= 0; i--) {
    const yr = String(periods[i]).slice(0, 4);
    if (notAfterYear && parseInt(yr, 10) > notAfterYear) continue;
    const v = values[i];
    const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
    if (isFinite(num)) return { value: num, year: yr };
  }
  return null;
}

// Value for a specific year in a DBnomics doc (used to pick the forecast year).
function valueAtYear(doc: DbDoc, year: number): Metric {
  const periods = doc.period ?? [];
  const values = doc.value ?? [];
  for (let i = 0; i < periods.length; i++) {
    if (String(periods[i]).slice(0, 4) === String(year)) {
      const v = values[i];
      const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
      if (isFinite(num)) return { value: num, year: String(year) };
    }
  }
  return null;
}

// Central bank policy rates from IMF IFS (indicator FPOLM_PA, monthly). One
// dimension query for all needed ISO-2 areas — same approach that works for WEO.
// IFS stops updating FPOLM_PA for advanced economies (euro area, UK…) that report
// via the ECB/BoE, so a stale years-old value must be rejected (those areas are
// instead filled from FRED below). Returns ISO3 → latest recent policy rate.
async function imfPolicyRates(): Promise<Record<string, Metric>> {
  const nowYear = parseInt(new Date().toISOString().slice(0, 4), 10);
  const areas = Array.from(new Set(Object.values(POLICY_CC)));
  const dims = encodeURIComponent(JSON.stringify({ FREQ: ['M'], INDICATOR: ['FPOLM_PA'], REF_AREA: areas }));
  const j = await dbFetch(`${DB}/series/IMF/IFS?dimensions=${dims}&observations=1&limit=300&metadata=false`, 14_000);
  const docs = j?.series?.docs ?? [];
  const byArea: Record<string, DbDoc> = {};
  for (const d of docs) { const ra = d.dimensions?.['REF_AREA']; if (ra && !byArea[ra]) byArea[ra] = d; }
  const out: Record<string, Metric> = {};
  for (const [iso, cc] of Object.entries(POLICY_CC)) {
    const m = byArea[cc] ? lastFinite(byArea[cc]) : null;
    // Drop anything older than ~3 years — it's a discontinued series, not the current rate.
    out[iso] = m && parseInt(m.year, 10) >= nowYear - 3 ? m : null;
  }
  return out;
}

// FRED API key (same one the Macro route uses; already in the repo). Direct FRED
// works on Vercel — DBnomics no longer hosts FRED.
const FRED_KEY = process.env.FRED_API_KEY || 'f3c277afe140cbee307e1b716840f5a9';

// Latest non-null FRED observation.
async function fredLatest(id: string): Promise<Metric> {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=12`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'Accept': 'application/json' }, next: { revalidate: 86400 } });
    if (!r.ok) return null;
    const j = await r.json() as { observations?: Array<{ date: string; value: string }> };
    for (const o of j.observations ?? []) { const v = parseFloat(o.value); if (isFinite(v)) return { value: v, year: o.date.slice(0, 4) }; }
    return null;
  } catch { return null; } finally { clearTimeout(t); }
}

// Advanced economies where IFS is stale → use the exact central-bank-rate series
// the Macro section already uses, so Macro World matches Macro. Euro members share
// the ECB deposit facility rate.
const FRED_OVERRIDE: Record<string, string> = {
  USA: 'DFEDTARU',            // Fed funds target (upper)
  EMU: 'ECBDFR', DEU: 'ECBDFR', FRA: 'ECBDFR', ITA: 'ECBDFR', ESP: 'ECBDFR', NLD: 'ECBDFR', // ECB deposit rate
  JPN: 'IRSTCI01JPM156N',     // BoJ immediate rate
  GBR: 'IRSTCI01GBM156N',     // BoE immediate rate
};
async function fredPolicyOverrides(): Promise<Record<string, Metric>> {
  const ids = Array.from(new Set(Object.values(FRED_OVERRIDE)));
  const byId = Object.fromEntries(await Promise.all(ids.map(async id => [id, await fredLatest(id)] as const)));
  const out: Record<string, Metric> = {};
  for (const [iso, id] of Object.entries(FRED_OVERRIDE)) { const m = byId[id]; if (m) out[iso] = m; }
  return out;
}

// One IMF WEO subject for many countries in a single DBnomics dimension query.
// Returns iso3 → doc. Tries a couple of dataset aliases since WEO is versioned.
async function weoSubject(subject: string): Promise<Record<string, DbDoc>> {
  const dims = encodeURIComponent(JSON.stringify({ 'weo-subject': [subject], 'weo-country': IMF_SUMMARY_CODES }));
  const out: Record<string, DbDoc> = {};
  for (const ds of ['IMF/WEO:latest', 'IMF/WEO']) {
    const j = await dbFetch(`${DB}/series/${ds}?dimensions=${dims}&observations=1&limit=1000`, 12_000);
    const docs = j?.series?.docs;
    if (Array.isArray(docs) && docs.length) {
      for (const d of docs) {
        const iso = d.dimensions?.['weo-country'];
        if (iso && !out[iso]) out[iso] = d;
      }
      if (Object.keys(out).length) return out;
    }
  }
  return out;
}

async function buildExtra(): Promise<ExtraMap> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const nowYear = parseInt(new Date().toISOString().slice(0, 4), 10);

  const [growthDocs, debtDocs, policyMap, fredMap] = await Promise.all([
    weoSubject('NGDP_RPCH'),
    weoSubject('GGXWDG_NGDP'),
    imfPolicyRates(),
    fredPolicyOverrides(),
  ]);

  const out: ExtraMap = {};
  for (const iso of IMF_SUMMARY_CODES) {
    const g = growthDocs[iso];
    // Two forecast horizons, each carrying its own year so the UI can label them
    // dynamically (this year's estimate + next year's forecast).
    const gdpFcstCurr = g ? valueAtYear(g, nowYear) : null;
    const gdpFcstNext = g ? valueAtYear(g, nowYear + 1) : null;
    const d = debtDocs[iso];
    const debt = d ? (valueAtYear(d, nowYear) ?? lastFinite(d)) : null;
    // FRED override (advanced economies) wins over the IFS value when present.
    out[iso] = { policyRate: fredMap[iso] ?? policyMap[iso] ?? null, gdpFcstCurr, gdpFcstNext, debt };
  }
  if (Object.values(out).some(v => v.policyRate || v.gdpFcstCurr || v.gdpFcstNext || v.debt)) cache = { data: out, ts: Date.now() };
  return out;
}

// Raw DBnomics fetch (any shape) — used only by the debug probe.
async function rawDb(u: string): Promise<{ status: number; json: unknown } | { error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    const status = r.status;
    let json: unknown = null;
    try { json = await r.json(); } catch { json = null; }
    return { status, json };
  } catch (e) { return { error: (e as Error).message }; } finally { clearTimeout(t); }
}

// DBnomics doc → {date, close} series (annual / monthly / daily periods normalised).
function docToSeries(doc?: DbDoc): { date: string; close: number }[] {
  if (!doc?.period) return [];
  const out: { date: string; close: number }[] = [];
  const vals = doc.value ?? [];
  for (let i = 0; i < doc.period.length; i++) {
    const p = doc.period[i];
    const v = vals[i];
    const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
    if (!isFinite(num)) continue;
    let date: string | null = null;
    if (/^\d{4}$/.test(p)) date = `${p}-01-01`;
    else if (/^\d{4}-\d{2}$/.test(p)) date = `${p}-01`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) date = p;
    if (date) out.push({ date, close: num });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Full FRED series (asc) as {date, close} — for advanced-economy policy-rate history.
async function fredSeries(id: string): Promise<{ date: string; close: number }[]> {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&file_type=json&sort_order=asc`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9_000);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'Accept': 'application/json' }, next: { revalidate: 86400 } });
    if (!r.ok) return [];
    const j = await r.json() as { observations?: Array<{ date: string; value: string }> };
    return (j.observations ?? []).map(o => ({ date: o.date, close: parseFloat(o.value) })).filter(p => isFinite(p.close));
  } catch { return []; } finally { clearTimeout(t); }
}

// IFS FPOLM_PA monthly series for one area (emerging-market policy-rate history).
async function ifsPolicySeries(cc: string): Promise<{ date: string; close: number }[]> {
  const dims = encodeURIComponent(JSON.stringify({ FREQ: ['M'], INDICATOR: ['FPOLM_PA'], REF_AREA: [cc] }));
  const j = await dbFetch(`${DB}/series/IMF/IFS?dimensions=${dims}&observations=1&limit=5&metadata=false`, 12_000);
  return docToSeries(j?.series?.docs?.[0]);
}

// One WEO subject for one country (annual, includes forecast years).
async function weoCountrySeries(iso3: string, subject: string): Promise<{ date: string; close: number }[]> {
  const dims = encodeURIComponent(JSON.stringify({ 'weo-subject': [subject], 'weo-country': [iso3] }));
  for (const ds of ['IMF/WEO:latest', 'IMF/WEO']) {
    const j = await dbFetch(`${DB}/series/${ds}?dimensions=${dims}&observations=1&limit=5&metadata=false`, 12_000);
    const s = docToSeries(j?.series?.docs?.[0]);
    if (s.length) return s;
  }
  return [];
}

// ── Buffett-style indicator: index level ÷ real GDP, indexed to its own history ──
let buffettSummaryCache: { data: Record<string, Metric>; ts: number } | null = null;

async function yahooMonthly(symbol: string): Promise<{ date: string; close: number }[]> {
  // Reuse the app's crumb-authenticated Yahoo fetch (with Stooq fallback) — a bare
  // chart request is rejected/rate-limited by Yahoo without a cookie+crumb session.
  try {
    const pts = await fetchYahooChart(symbol, new Date('1990-01-01'), new Date(), '1mo');
    return pts.filter(p => typeof p.close === 'number' && isFinite(p.close));
  } catch { return []; }
}

async function wbRealGdp(iso3: string): Promise<{ date: string; close: number }[]> {
  const u = `https://api.worldbank.org/v2/country/${encodeURIComponent(iso3)}/indicator/NY.GDP.MKTP.KD?format=json&per_page=300`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json() as [unknown, Array<{ date: string; value: number | null }>] | null;
    const rows = Array.isArray(j) ? j[1] : null;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(x => typeof x.value === 'number' && isFinite(x.value) && /^\d{4}$/.test(x.date))
      .map(x => ({ date: `${x.date}-01-01`, close: x.value as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; } finally { clearTimeout(t); }
}

// Index(t) / realGDP(t, carried forward), normalised so its own historical mean = 1.0
// (1.0 = historical norm). Returns the series + which index was used.
async function buffettSeries(iso3: string): Promise<{ series: { date: string; close: number }[]; indexName: string; indexSymbol: string } | null> {
  const idx = IMF_COUNTRY_INDEX[iso3];
  if (!idx) return null;
  const [index, gdp] = await Promise.all([yahooMonthly(idx.symbol), wbRealGdp(iso3)]);
  if (index.length < 12 || gdp.length < 2) return null;
  let gi = 0; let lastGdp: number | null = null;
  const ratios: { date: string; close: number }[] = [];
  for (const p of index) {
    while (gi < gdp.length && gdp[gi].date <= p.date) { lastGdp = gdp[gi].close; gi++; }
    if (lastGdp == null || lastGdp <= 0) continue;
    ratios.push({ date: p.date, close: p.close / lastGdp });
  }
  if (ratios.length < 12) return null;
  const mean = ratios.reduce((s, r) => s + r.close, 0) / ratios.length;
  if (!(mean > 0)) return null;
  return { series: ratios.map(r => ({ date: r.date, close: r.close / mean })), indexName: idx.name, indexSymbol: idx.symbol };
}

async function buffettSummary(): Promise<Record<string, Metric>> {
  if (buffettSummaryCache && Date.now() - buffettSummaryCache.ts < TTL) return buffettSummaryCache.data;
  const codes = IMF_SUMMARY_CODES.filter(c => IMF_COUNTRY_INDEX[c]);
  const out: Record<string, Metric> = {};
  await Promise.all(codes.map(async iso => {
    const b = await buffettSeries(iso);
    if (b && b.series.length) { const last = b.series[b.series.length - 1]; out[iso] = { value: last.close, year: last.date.slice(0, 4) }; }
  }));
  if (Object.keys(out).length) buffettSummaryCache = { data: out, ts: Date.now() };
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  // Buffett-style valuation (index ÷ real GDP) latest value per country — its own
  // endpoint so it can be fetched lazily without slowing the main summary.
  if (mode === 'buffett-summary') {
    const data = await buffettSummary();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' } });
  }

  // Diagnostics for one country's Buffett inputs (index vs real GDP).
  if (mode === 'buffett-debug') {
    const country = (url.searchParams.get('country') || 'USA').toUpperCase();
    const idx = IMF_COUNTRY_INDEX[country] ?? null;
    const [index, gdp] = await Promise.all([idx ? yahooMonthly(idx.symbol) : Promise.resolve([]), wbRealGdp(country)]);
    const b = await buffettSeries(country);
    return NextResponse.json({
      country, index: idx,
      indexPoints: index.length, indexSample: index.slice(-2),
      gdpPoints: gdp.length, gdpSample: gdp.slice(-2),
      buffettPoints: b?.series.length ?? 0, buffettLatest: b?.series.slice(-1)[0] ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Per-country series for the extra indicators (openable over time in the grid).
  if (mode === 'country') {
    const country = (url.searchParams.get('country') || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return NextResponse.json({ error: 'bad_country' }, { status: 400 });
    const cc = POLICY_CC[country];
    const fredId = FRED_OVERRIDE[country];
    const [policyRate, gdpForecast, debt, buffett] = await Promise.all([
      fredId ? fredSeries(fredId) : (cc ? ifsPolicySeries(cc) : Promise.resolve([])),
      weoCountrySeries(country, 'NGDP_RPCH'),
      weoCountrySeries(country, 'GGXWDG_NGDP'),
      buffettSeries(country),
    ]);
    return NextResponse.json({
      policyRate, gdpForecast, debt,
      buffett: buffett?.series ?? [],
      buffettIndex: buffett?.indexName ?? null,
    }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  }

  // Probe DBnomics to discover the correct policy-rate provider/dataset/series.
  // Dumps raw (truncated) bodies so the real structure is visible, not my guesses.
  if (mode === 'debug') {
    const probeUrls = [
      `${DB}/series/IMF/IFS?q=${encodeURIComponent('policy rate')}&limit=10&observations=1&metadata=false`,
      `${DB}/series/IMF/IFS?q=${encodeURIComponent('central bank')}&limit=10&observations=1&metadata=false`,
      `${DB}/series/IMF/IFS?dimensions=${encodeURIComponent(JSON.stringify({ FREQ: ['M'], INDICATOR: ['FPOLM_PA'] }))}&limit=6&observations=1&metadata=false`,
    ];
    const probes = await Promise.all(probeUrls.map(async u => {
      const r = await rawDb(u);
      if ('error' in r) return { url: u, error: r.error };
      const j = r.json as { series?: { docs?: Array<Record<string, unknown>>; num_found?: number }; message?: string } | null;
      const docs = j?.series?.docs;
      // Parse the SERIES (indicator code, dimensions, last obs) — the useful part.
      const parsed = Array.isArray(docs) ? docs.slice(0, 10).map(d => {
        const period = d.period as string[] | undefined;
        const value = d.value as unknown[] | undefined;
        return {
          code: d.series_code, name: d.series_name, dims: d.dimensions,
          last: period?.length ? [period[period.length - 1], value?.[value.length - 1]] : null,
        };
      }) : null;
      return { url: u, status: r.status, numFound: j?.series?.num_found, message: j?.message, docs: parsed };
    }));
    return NextResponse.json({ probes }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (mode !== 'summary') return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
  const data = await buildExtra();
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
}
