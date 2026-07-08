import { NextResponse } from 'next/server';
import { IMF_INDICATORS } from '@/lib/imfConfig';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// IMF DataMapper proxy for the Macro World section. Self-contained: fetches annual
// WEO series per country, converts each to the app's {date, close} point format so
// the existing PriceChart / tools / data-table can render them unchanged, and caches
// per-indicator responses in memory (24h) so the grid load is cheap.
//
//   GET /api/imf?mode=countries                 → [{ code, name }]
//   GET /api/imf?mode=country&country=USA        → { code, name, indicators: {CODE: {series,latest,latestYear}} }
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://www.imf.org/external/datamapper/api/v1';
const TTL = 24 * 60 * 60 * 1000; // 24h — WEO updates a couple of times a year

interface Cached<T> { data: T; ts: number }
// Cache each indicator's full all-country response, and the country list.
const indicatorCache = new Map<string, Cached<Record<string, Record<string, number>>>>();
let countriesCache: Cached<{ code: string; name: string }[]> | null = null;

async function getJson(path: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

// All-country values for one indicator: { COUNTRY: { "1980": v, … } }. Cached.
async function indicatorValues(code: string): Promise<Record<string, Record<string, number>>> {
  const hit = indicatorCache.get(code);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  const json = await getJson(`/${encodeURIComponent(code)}`) as
    { values?: Record<string, Record<string, Record<string, number>>> } | null;
  const data = json?.values?.[code] ?? {};
  indicatorCache.set(code, { data, ts: Date.now() });
  return data;
}

async function countryList(): Promise<{ code: string; name: string }[]> {
  if (countriesCache && Date.now() - countriesCache.ts < TTL) return countriesCache.data;
  const json = await getJson('/countries') as { countries?: Record<string, { label?: string }> } | null;
  const map = json?.countries ?? {};
  const list = Object.entries(map)
    // Keep real ISO-3 country codes (drop the analytical aggregates like WEOWORLD).
    .filter(([code]) => /^[A-Z]{3}$/.test(code))
    .map(([code, v]) => ({ code, name: v.label ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) countriesCache = { data: list, ts: Date.now() };
  return list;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  if (mode === 'countries') {
    const list = await countryList();
    if (!list.length) return NextResponse.json({ error: 'imf_unreachable' }, { status: 200 });
    return NextResponse.json(list);
  }

  if (mode === 'country') {
    const country = (url.searchParams.get('country') || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return NextResponse.json({ error: 'bad_country' }, { status: 400 });

    const [countries, ...perInd] = await Promise.all([
      countryList(),
      ...IMF_INDICATORS.map(i => indicatorValues(i.code)),
    ]);
    const name = countries.find(c => c.code === country)?.name ?? country;

    const indicators: Record<string, { series: { date: string; close: number }[]; latest: number | null; latestYear: string | null }> = {};
    IMF_INDICATORS.forEach((ind, i) => {
      const byYear = perInd[i]?.[country] ?? {};
      const series = Object.entries(byYear)
        .filter(([y, v]) => /^\d{4}$/.test(y) && typeof v === 'number' && isFinite(v))
        .map(([y, v]) => ({ date: `${y}-01-01`, close: v }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const last = series[series.length - 1];
      indicators[ind.code] = {
        series,
        latest: last ? last.close : null,
        latestYear: last ? last.date.slice(0, 4) : null,
      };
    });

    return NextResponse.json({ code: country, name, indicators });
  }

  return NextResponse.json({ error: 'bad_mode' }, { status: 400 });
}
