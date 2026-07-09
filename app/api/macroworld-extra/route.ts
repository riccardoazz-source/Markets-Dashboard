import { NextResponse } from 'next/server';
import { IMF_SUMMARY_CODES } from '@/lib/imfConfig';

// Edge runtime + DBnomics: the exact same network path that already powers the
// Macro section's DBnomics/FRED fetches in production (works on Vercel, unlike the
// IMF DataMapper / OECD SDMX which block datacenter IPs).
export const runtime = 'edge';
export const maxDuration = 25;

// ─────────────────────────────────────────────────────────────────────────────
// Macro World "extra" metrics that the World Bank indicator API does not carry:
//   • 10Y government bond yield          — FRED  IRLTLT01{cc}M156N (OECD, monthly)
//   • Real GDP growth forecast (next yr) — IMF WEO  NGDP_RPCH   (has forecast years)
//   • General govt gross debt, % of GDP  — IMF WEO  GGXWDG_NGDP (broad coverage)
// All via DBnomics REST JSON. Everything degrades to null on failure so the caller
// simply shows "—" — it can never break the World Bank data.
//
//   GET /api/macroworld-extra?mode=summary → { ISO3: { yield10y, gdpFcst, debt } }
// ─────────────────────────────────────────────────────────────────────────────

const DB = 'https://api.db.nomics.world/v22';
const TTL = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Metric = { value: number; year: string } | null;
type ExtraMap = Record<string, { yield10y: Metric; gdpFcst: Metric; debt: Metric }>;
interface Cached { data: ExtraMap; ts: number }
let cache: Cached | null = null;

// ISO3 → the 2-letter code FRED uses in IRLTLT01{cc}M156N (OECD long-term rates).
// Only economies with an OECD long-term-rate series; the rest resolve to null.
const YIELD_CC: Record<string, string> = {
  USA: 'US', CAN: 'CA', MEX: 'MX', CHL: 'CL', COL: 'CO', DEU: 'DE', FRA: 'FR',
  GBR: 'GB', ITA: 'IT', ESP: 'ES', NLD: 'NL', CHE: 'CH', SWE: 'SE', POL: 'PL',
  JPN: 'JP', KOR: 'KR', ISR: 'IL', AUS: 'AU', NZL: 'NZ', TUR: 'TR', EMU: 'EZ',
  RUS: 'RU', ZAF: 'ZA', IND: 'IN', IDN: 'ID',
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

async function fredYield(iso3: string): Promise<Metric> {
  const cc = YIELD_CC[iso3];
  if (!cc) return null;
  const id = `IRLTLT01${cc}M156N`;
  const enc = encodeURIComponent(id);
  for (const url of [`${DB}/series/FRED/${enc}/${enc}?observations=1`, `${DB}/series/FRED/${enc}?observations=1`]) {
    const j = await dbFetch(url);
    const doc = j?.series?.docs?.[0];
    if (doc?.period?.length) { const m = lastFinite(doc); if (m) return m; }
  }
  return null;
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

  const [growthDocs, debtDocs, yields] = await Promise.all([
    weoSubject('NGDP_RPCH'),
    weoSubject('GGXWDG_NGDP'),
    Promise.all(IMF_SUMMARY_CODES.map(async c => [c, await fredYield(c)] as const)),
  ]);
  const yieldMap = Object.fromEntries(yields);

  const out: ExtraMap = {};
  for (const iso of IMF_SUMMARY_CODES) {
    const g = growthDocs[iso];
    // Forecast = next year's WEO value if present, else the current-year estimate.
    const gdpFcst = g ? (valueAtYear(g, nowYear + 1) ?? valueAtYear(g, nowYear) ?? lastFinite(g)) : null;
    const d = debtDocs[iso];
    const debt = d ? (valueAtYear(d, nowYear) ?? lastFinite(d)) : null;
    out[iso] = { yield10y: yieldMap[iso] ?? null, gdpFcst, debt };
  }
  if (Object.values(out).some(v => v.yield10y || v.gdpFcst || v.debt)) cache = { data: out, ts: Date.now() };
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('mode') !== 'summary') return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
  const data = await buildExtra();
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' } });
}
