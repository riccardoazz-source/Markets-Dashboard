import { NextResponse } from 'next/server';
import { IMF_SUMMARY_CODES } from '@/lib/imfConfig';

// Edge runtime + DBnomics: the exact same network path that already powers the
// Macro section's DBnomics/FRED fetches in production (works on Vercel, unlike the
// IMF DataMapper / OECD SDMX which block datacenter IPs).
export const runtime = 'edge';
export const maxDuration = 25;

// ─────────────────────────────────────────────────────────────────────────────
// Macro World "extra" metrics that the World Bank indicator API does not carry:
//   • Central bank policy rate           — BIS  CBPOL_M (monthly, ~38 central banks)
//   • Real GDP growth forecast (next yr) — IMF WEO  NGDP_RPCH   (has forecast years)
//   • General govt gross debt, % of GDP  — IMF WEO  GGXWDG_NGDP (broad coverage)
// All via DBnomics REST JSON. Everything degrades to null on failure so the caller
// simply shows "—" — it can never break the World Bank data.
//
//   GET /api/macroworld-extra?mode=summary → { ISO3: { policyRate, gdpFcst, debt } }
// ─────────────────────────────────────────────────────────────────────────────

const DB = 'https://api.db.nomics.world/v22';
const TTL = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Metric = { value: number; year: string } | null;
type ExtraMap = Record<string, { policyRate: Metric; gdpFcst: Metric; debt: Metric }>;
interface Cached { data: ExtraMap; ts: number }
let cache: Cached | null = null;

// ISO3 → the BIS REF_AREA code for the central bank policy rate. Euro-area members
// all share the ECB rate (XM). Economies BIS doesn't cover resolve to null.
const POLICY_CC: Record<string, string> = {
  USA: 'US', EMU: 'XM', DEU: 'XM', FRA: 'XM', ITA: 'XM', ESP: 'XM', NLD: 'XM',
  JPN: 'JP', GBR: 'GB', CHE: 'CH', SWE: 'SE', CAN: 'CA', AUS: 'AU', NZL: 'NZ',
  POL: 'PL', RUS: 'RU', CHN: 'CN', IND: 'IN', IDN: 'ID', KOR: 'KR', MEX: 'MX',
  BRA: 'BR', CHL: 'CL', COL: 'CO', PER: 'PE', ZAF: 'ZA', TUR: 'TR', SAU: 'SA',
  THA: 'TH', ISR: 'IL',
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

// Central bank policy rates for every needed BIS area in one dimension query
// (same approach that works for WEO). Returns ISO3 → latest policy rate.
async function bisPolicyRates(): Promise<Record<string, Metric>> {
  const ccList = Array.from(new Set(Object.values(POLICY_CC)));
  const dims = encodeURIComponent(JSON.stringify({ REF_AREA: ccList }));
  const byCc: Record<string, DbDoc> = {};
  for (const ds of ['BIS/CBPOL_M', 'BIS/CBPOL']) {
    const j = await dbFetch(`${DB}/series/${ds}?dimensions=${dims}&observations=1&limit=200`, 10_000);
    const docs = j?.series?.docs;
    if (Array.isArray(docs) && docs.length) {
      for (const d of docs) { const ref = d.dimensions?.['REF_AREA']; if (ref && !byCc[ref]) byCc[ref] = d; }
      if (Object.keys(byCc).length) break;
    }
  }
  // Per-series fallback if the dimension query returned nothing.
  if (!Object.keys(byCc).length) {
    await Promise.all(ccList.map(async cc => {
      const code = encodeURIComponent(`M.${cc}`);
      const j = await dbFetch(`${DB}/series/BIS/CBPOL_M/${code}?observations=1`, 6_000);
      const doc = j?.series?.docs?.[0];
      if (doc?.period?.length) byCc[cc] = doc;
    }));
  }
  const out: Record<string, Metric> = {};
  for (const [iso, cc] of Object.entries(POLICY_CC)) out[iso] = byCc[cc] ? lastFinite(byCc[cc]) : null;
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

  const [growthDocs, debtDocs, policyMap] = await Promise.all([
    weoSubject('NGDP_RPCH'),
    weoSubject('GGXWDG_NGDP'),
    bisPolicyRates(),
  ]);

  const out: ExtraMap = {};
  for (const iso of IMF_SUMMARY_CODES) {
    const g = growthDocs[iso];
    // Forecast = next year's WEO value if present, else the current-year estimate.
    const gdpFcst = g ? (valueAtYear(g, nowYear + 1) ?? valueAtYear(g, nowYear) ?? lastFinite(g)) : null;
    const d = debtDocs[iso];
    const debt = d ? (valueAtYear(d, nowYear) ?? lastFinite(d)) : null;
    out[iso] = { policyRate: policyMap[iso] ?? null, gdpFcst, debt };
  }
  if (Object.values(out).some(v => v.policyRate || v.gdpFcst || v.debt)) cache = { data: out, ts: Date.now() };
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  // Probe DBnomics to discover the correct BIS policy-rate dataset/series format.
  if (mode === 'debug') {
    const probeUrls = [
      `${DB}/datasets/BIS`,
      `${DB}/series/BIS/CBPOL_M/M.US?observations=1`,
      `${DB}/series/BIS/CBPOL_D/D.US?observations=1`,
      `${DB}/series/BIS/WS_CBPOL_M/M.US?observations=1`,
      `${DB}/series/BIS/CBPOL_M?dimensions=${encodeURIComponent(JSON.stringify({ REF_AREA: ['US'] }))}&observations=1&limit=3`,
      `${DB}/search?q=central%20bank%20policy%20rate%20United%20States&limit=5`,
    ];
    const probes = await Promise.all(probeUrls.map(async u => {
      const r = await rawDb(u);
      if ('error' in r) return { url: u, error: r.error };
      const j = r.json as Record<string, unknown> | null;
      // Summarise without dumping megabytes: dataset codes, or series doc shape.
      const datasets = (j?.datasets as { docs?: Array<{ code?: string; name?: string }> } | undefined)?.docs;
      const seriesDocs = (j?.series as { docs?: Array<Record<string, unknown>> } | undefined)?.docs;
      const results = (j?.results as { docs?: Array<Record<string, unknown>> } | undefined)?.docs;
      return {
        url: u,
        status: r.status,
        topKeys: j ? Object.keys(j) : null,
        datasetCodes: Array.isArray(datasets) ? datasets.map(d => `${d.code} — ${d.name}`).slice(0, 60) : undefined,
        seriesDoc0: Array.isArray(seriesDocs) && seriesDocs[0] ? {
          series_code: seriesDocs[0].series_code, dimensions: seriesDocs[0].dimensions,
          lastPeriods: (seriesDocs[0].period as unknown[] | undefined)?.slice(-3),
          lastValues: (seriesDocs[0].value as unknown[] | undefined)?.slice(-3),
        } : undefined,
        searchHits: Array.isArray(results) ? results.map(d => `${d.provider_code}/${d.dataset_code}/${d.series_code}`).slice(0, 8) : undefined,
      };
    }));
    return NextResponse.json({ probes }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (mode !== 'summary') return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
  const data = await buildExtra();
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' } });
}
