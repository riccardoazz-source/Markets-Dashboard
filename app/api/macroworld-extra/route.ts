import { NextResponse } from 'next/server';
import { IMF_SUMMARY_CODES } from '@/lib/imfConfig';

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
// Returns ISO3 → latest policy rate.
async function imfPolicyRates(): Promise<Record<string, Metric>> {
  const areas = Array.from(new Set(Object.values(POLICY_CC)));
  const dims = encodeURIComponent(JSON.stringify({ FREQ: ['M'], INDICATOR: ['FPOLM_PA'], REF_AREA: areas }));
  const j = await dbFetch(`${DB}/series/IMF/IFS?dimensions=${dims}&observations=1&limit=300&metadata=false`, 14_000);
  const docs = j?.series?.docs ?? [];
  const byArea: Record<string, DbDoc> = {};
  for (const d of docs) { const ra = d.dimensions?.['REF_AREA']; if (ra && !byArea[ra]) byArea[ra] = d; }
  const out: Record<string, Metric> = {};
  for (const [iso, cc] of Object.entries(POLICY_CC)) out[iso] = byArea[cc] ? lastFinite(byArea[cc]) : null;
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
    imfPolicyRates(),
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
    out[iso] = { policyRate: policyMap[iso] ?? null, gdpFcstCurr, gdpFcstNext, debt };
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

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
