import { NextResponse } from 'next/server';
import { IMF_INDICATORS, IMF_SUMMARY_INDICATORS, IMF_SUMMARY_CODES } from '@/lib/imfConfig';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// World Bank proxy for the Macro World section. Annual indicator series per country,
// converted to the app's {date, close} point format so PriceChart / tools / data-table
// render them unchanged. Cached in memory (24h). World Bank is reliable and does not
// block datacenter IPs (the IMF DataMapper does), so this runs server-side.
//
//   GET /api/worldbank?mode=countries            → [{ code, name }]
//   GET /api/worldbank?mode=country&country=USA   → { code, indicators: {CODE:{series,latest,latestYear}} }
//   GET /api/worldbank?mode=summary               → { ISO3: { INDCODE: { value, year } } }
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://api.worldbank.org/v2';
const DB = 'https://api.db.nomics.world/v22';
const TTL = 24 * 60 * 60 * 1000;

interface Cached<T> { data: T; ts: number }
interface Place { code: string; name: string; aggregate: boolean }
type SummaryMap = Record<string, Record<string, { value: number; year: string }>>;
const seriesCache = new Map<string, Cached<{ date: string; close: number }[]>>();
let countriesCache: Cached<Place[]> | null = null;
let summaryCache: Cached<SummaryMap> | null = null;

// GLOBAL World Bank concurrency gate. On mount the page fires the country grid
// (12), the summary board (8) and the country list at once — ~21 simultaneous WB
// requests from one IP, which WB rate-limits. Cap ALL wb() calls route-wide to a
// few in flight so the burst is serialised instead of rejected.
const MAX_WB = 4;
let wbActive = 0;
const wbWaiters: Array<() => void> = [];
async function wbSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (wbActive >= MAX_WB) await new Promise<void>(r => wbWaiters.push(r));
  wbActive++;
  try { return await fn(); } finally { wbActive--; wbWaiters.shift()?.(); }
}

async function wb(path: string, retries = 1): Promise<unknown | null> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}format=json&per_page=20000`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await wbSlot(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      try {
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
        return r.ok ? await r.json() : null;
      } catch { return null; } finally { clearTimeout(timer); }
    });
    if (result != null) return result;
    if (attempt < retries) await new Promise(res => setTimeout(res, 350)); // brief backoff
  }
  return null;
}

async function countryList(): Promise<Place[]> {
  if (countriesCache && Date.now() - countriesCache.ts < TTL) return countriesCache.data;
  const json = await wb('/country') as [unknown, Array<{ id: string; name: string; region?: { id?: string; value?: string } }>] | null;
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return [];
  const list = rows
    .filter(c => /^[A-Z]{3}$/.test(c.id))
    // Keep both real countries AND aggregates (EU, Euro area, World, regions, income groups),
    // flagged so the UI can group them separately.
    .map(c => ({ code: c.id, name: c.name, aggregate: c.region?.value === 'Aggregates' || c.region?.id === 'NA' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) countriesCache = { data: list, ts: Date.now() };
  return list;
}

async function series(country: string, code: string, scale: number): Promise<{ date: string; close: number }[]> {
  const key = `${country}:${code}`;
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  const json = await wb(`/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(code)}?date=1960:2030`) as
    [unknown, Array<{ date: string; value: number | null }>] | null;
  const rows = Array.isArray(json) ? json[1] : null;
  const out = Array.isArray(rows)
    ? rows
        .filter(r => typeof r.value === 'number' && isFinite(r.value) && /^\d{4}$/.test(r.date))
        .map(r => ({ date: `${r.date}-01-01`, close: (r.value as number) / scale }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  // Cache ONLY a real WB data response ([meta, data]); never cache a failed/rate-limited
  // fetch (json === null) — otherwise a transient failure would show "—" for 24h.
  if (Array.isArray(json) && json.length >= 2) seriesCache.set(key, { data: out, ts: Date.now() });
  return out;
}

// Run async tasks with limited concurrency — World Bank rate-limits bursts, so we
// fan the per-country indicator fetches out a few at a time instead of all at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// All indicators of ONE country in a SINGLE DBnomics call (World Bank / WDI mirror).
// This avoids the 12-request direct-WB burst the browser fires per country, which WB
// rate-limits. DBnomics is reliable from this deployment (it also serves WEO/IFS).
interface DbDoc { period?: string[]; value?: (number | string | null)[]; dimensions?: Record<string, string> }
const countryCache = new Map<string, Cached<Record<string, { date: string; close: number }[]>>>();

async function dbnomicsCountry(country: string): Promise<Record<string, { date: string; close: number }[]>> {
  const hit = countryCache.get(country);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  const codes = IMF_INDICATORS.map(i => i.code);
  const scaleByCode = new Map(IMF_INDICATORS.map(i => [i.code, i.scale ?? 1]));
  const dims = encodeURIComponent(JSON.stringify({ indicator: codes, country: [country] }));
  const dbUrl = `${DB}/series/WB/WDI?dimensions=${dims}&observations=1&limit=200&metadata=false`;
  // Retry the single DBnomics call a couple of times — intermittent network blips /
  // slow responses were leaving the whole country grid empty (it then fell back to the
  // rate-limited direct-WB path, which often also failed). Small backoff between tries.
  let json: { series?: { docs?: DbDoc[] } } | null = null;
  for (let attempt = 0; attempt < 3 && !json; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const r = await fetch(dbUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (r.ok) json = await r.json();
    } catch { /* retry */ } finally { clearTimeout(timer); }
  }
  const docs = json?.series?.docs ?? [];
  const out: Record<string, { date: string; close: number }[]> = {};
  for (const d of docs) {
    const ind = d.dimensions?.indicator;
    if (!ind) continue;
    const scale = scaleByCode.get(ind) ?? 1;
    const periods = d.period ?? [];
    const values = d.value ?? [];
    const series: { date: string; close: number }[] = [];
    for (let i = 0; i < periods.length; i++) {
      const p = String(periods[i]);
      const v = values[i];
      const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
      if (/^\d{4}$/.test(p) && isFinite(num)) series.push({ date: `${p}-01-01`, close: num / scale });
    }
    series.sort((a, b) => a.date.localeCompare(b.date));
    if (series.length) out[ind] = series;
  }
  if (Object.keys(out).length) countryCache.set(country, { data: out, ts: Date.now() });
  return out;
}

// Macro-area board: one multi-country WB call per summary indicator (much cheaper
// than N×M single fetches), keeping each place's most recent non-null value.
// Direct World Bank multi-country board — cheap but often blocked on this deployment.
async function summaryFromWb(): Promise<SummaryMap> {
  const codes = IMF_SUMMARY_CODES.join(';');
  const out: SummaryMap = {};
  await Promise.all(IMF_SUMMARY_INDICATORS.map(async indCode => {
    const json = await wb(`/country/${codes}/indicator/${encodeURIComponent(indCode)}?mrv=12`) as
      [unknown, Array<{ countryiso3code?: string; date: string; value: number | null }>] | null;
    const rows = Array.isArray(json) ? json[1] : null;
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      const iso = r.countryiso3code;
      if (!iso || typeof r.value !== 'number' || !isFinite(r.value) || !/^\d{4}$/.test(r.date)) continue;
      const cur = out[iso]?.[indCode];
      if (!cur || r.date > cur.year) (out[iso] ??= {})[indCode] = { value: r.value, year: r.date };
    }
  }));
  return out;
}

// DBnomics fallback — the SAME reliable source the country grid uses. One call
// for every summary country × indicator; keeps the most recent value per cell.
async function summaryFromDbnomics(): Promise<SummaryMap> {
  const dims = encodeURIComponent(JSON.stringify({ indicator: IMF_SUMMARY_INDICATORS, country: IMF_SUMMARY_CODES }));
  const dbUrl = `${DB}/series/WB/WDI?dimensions=${dims}&limit=1000&metadata=false`;
  let json: { series?: { docs?: DbDoc[] } } | null = null;
  for (let attempt = 0; attempt < 3 && !json; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const r = await fetch(dbUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (r.ok) json = await r.json();
    } catch { /* retry */ } finally { clearTimeout(timer); }
  }
  const out: SummaryMap = {};
  for (const d of json?.series?.docs ?? []) {
    const ind = d.dimensions?.indicator, iso = d.dimensions?.country;
    if (!ind || !iso) continue;
    const periods = d.period ?? [], values = d.value ?? [];
    let best: { value: number; year: string } | null = null;
    for (let i = 0; i < periods.length; i++) {
      const p = String(periods[i]); const v = values[i];
      const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
      if (/^\d{4}$/.test(p) && isFinite(num) && (!best || p > best.year)) best = { value: num, year: p };
    }
    if (best) (out[iso] ??= {})[ind] = best;
  }
  return out;
}

async function summary(): Promise<SummaryMap> {
  if (summaryCache && Date.now() - summaryCache.ts < TTL) return summaryCache.data;
  // World Bank direct first (cheap); DBnomics fallback when it's blocked/empty.
  let out = await summaryFromWb();
  if (!Object.keys(out).length) out = await summaryFromDbnomics();
  if (Object.keys(out).length) summaryCache = { data: out, ts: Date.now() };
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  // Diagnose whether World Bank is reachable from this deployment, and whether the
  // same data is available via DBnomics (which works reliably here).
  if (mode === 'debug') {
    const probe = async (u: string) => {
      try {
        const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
        return { url: u, status: r.status, body: (await r.text()).slice(0, 500) };
      } catch (e) { return { url: u, error: String(e) }; }
    };
    const [direct, dbSearch, dbSeries] = await Promise.all([
      probe(`${BASE}/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=50&date=2015:2024`),
      probe(`https://api.db.nomics.world/v22/search?q=World%20Development%20Indicators&limit=4`),
      probe(`https://api.db.nomics.world/v22/series/WB/WDI?dimensions=${encodeURIComponent(JSON.stringify({ indicator: ['NY.GDP.MKTP.CD'], country: ['USA'] }))}&observations=1&limit=2`),
    ]);
    return NextResponse.json({ direct, dbSearch, dbSeries }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (mode === 'summary') {
    const s = await summary();
    if (!Object.keys(s).length) return NextResponse.json({ error: 'wb_unreachable' }, { status: 200 });
    return NextResponse.json(s);
  }

  if (mode === 'countries') {
    const list = await countryList();
    if (!list.length) return NextResponse.json({ error: 'wb_unreachable' }, { status: 200 });
    return NextResponse.json(list);
  }

  if (mode === 'country') {
    const country = (url.searchParams.get('country') || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return NextResponse.json({ error: 'bad_country' }, { status: 400 });

    // One DBnomics call for all indicators; fall back to direct World Bank per-series
    // (rate-limit-gated) only if DBnomics returns nothing.
    let byCode = await dbnomicsCountry(country);
    if (!Object.keys(byCode).length) {
      const all = await mapLimit(IMF_INDICATORS, 4, i => series(country, i.code, i.scale ?? 1));
      byCode = {};
      IMF_INDICATORS.forEach((ind, i) => { if (all[i].length) byCode[ind.code] = all[i]; });
    }
    const indicators: Record<string, { series: { date: string; close: number }[]; latest: number | null; latestYear: string | null }> = {};
    let any = false;
    for (const ind of IMF_INDICATORS) {
      const s = byCode[ind.code] ?? [];
      if (s.length) any = true;
      const last = s[s.length - 1];
      indicators[ind.code] = { series: s, latest: last ? last.close : null, latestYear: last ? last.date.slice(0, 4) : null };
    }
    if (!any) return NextResponse.json({ error: 'wb_unreachable' }, { status: 200 });
    return NextResponse.json({ code: country, indicators });
  }

  return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
}
