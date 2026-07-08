import { NextResponse } from 'next/server';
import { IMF_INDICATORS } from '@/lib/imfConfig';

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
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://api.worldbank.org/v2';
const TTL = 24 * 60 * 60 * 1000;

interface Cached<T> { data: T; ts: number }
const seriesCache = new Map<string, Cached<{ date: string; close: number }[]>>();
let countriesCache: Cached<{ code: string; name: string }[]> | null = null;

async function wb(path: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${BASE}${path}${sep}format=json&per_page=20000`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

async function countryList(): Promise<{ code: string; name: string }[]> {
  if (countriesCache && Date.now() - countriesCache.ts < TTL) return countriesCache.data;
  const json = await wb('/country') as [unknown, Array<{ id: string; name: string; region?: { id?: string; value?: string } }>] | null;
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return [];
  const list = rows
    // Drop aggregates (World Bank marks them region.id === 'NA' / value 'Aggregates').
    .filter(c => c.region?.id !== 'NA' && c.region?.value !== 'Aggregates' && /^[A-Z]{3}$/.test(c.id))
    .map(c => ({ code: c.id, name: c.name }))
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
  seriesCache.set(key, { data: out, ts: Date.now() });
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  if (mode === 'countries') {
    const list = await countryList();
    if (!list.length) return NextResponse.json({ error: 'wb_unreachable' }, { status: 200 });
    return NextResponse.json(list);
  }

  if (mode === 'country') {
    const country = (url.searchParams.get('country') || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return NextResponse.json({ error: 'bad_country' }, { status: 400 });

    const all = await Promise.all(IMF_INDICATORS.map(i => series(country, i.code, i.scale ?? 1)));
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
