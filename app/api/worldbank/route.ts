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
const TTL = 24 * 60 * 60 * 1000;

interface Cached<T> { data: T; ts: number }
interface Place { code: string; name: string; aggregate: boolean }
type SummaryMap = Record<string, Record<string, { value: number; year: string }>>;
const seriesCache = new Map<string, Cached<{ date: string; close: number }[]>>();
let countriesCache: Cached<Place[]> | null = null;
let summaryCache: Cached<SummaryMap> | null = null;

async function wb(path: string, retries = 1): Promise<unknown | null> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}format=json&per_page=20000`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (r.ok) return await r.json();
    } catch { /* retry */ } finally { clearTimeout(timer); }
    if (attempt < retries) await new Promise(res => setTimeout(res, 350)); // brief backoff (WB rate-limits bursts)
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

// Macro-area board: one multi-country WB call per summary indicator (much cheaper
// than N×M single fetches), keeping each place's most recent non-null value.
async function summary(): Promise<SummaryMap> {
  if (summaryCache && Date.now() - summaryCache.ts < TTL) return summaryCache.data;
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
  if (Object.keys(out).length) summaryCache = { data: out, ts: Date.now() };
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

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

    const all = await mapLimit(IMF_INDICATORS, 4, i => series(country, i.code, i.scale ?? 1));
    const indicators: Record<string, { series: { date: string; close: number }[]; latest: number | null; latestYear: string | null }> = {};
    let any = false;
    IMF_INDICATORS.forEach((ind, i) => {
      const s = all[i];
      if (s.length) any = true;
      const last = s[s.length - 1];
      indicators[ind.code] = { series: s, latest: last ? last.close : null, latestYear: last ? last.date.slice(0, 4) : null };
    });
    if (!any) return NextResponse.json({ error: 'wb_unreachable' }, { status: 200 });
    return NextResponse.json({ code: country, indicators });
  }

  return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
}
