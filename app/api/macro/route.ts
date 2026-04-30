import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60_000;

function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}

async function fetchFREDCsv(
  seriesId: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const params = new URLSearchParams({ id: seriesId });
  if (fromDate) params.set('cosd', fromDate);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'MarketsDashboard/1.0', 'Accept': 'text/csv,*/*' },
    });
    if (!res.ok) return [];
    const csv = await res.text();
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
    return points;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'list';

  // Historical data for one series (used by chart + Compare)
  if (mode === 'history') {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });
    const from = req.nextUrl.searchParams.get('from') ?? undefined;
    const key = `hist:${id}:${from ?? ''}`;
    const cached = getCached(key);
    if (cached) return NextResponse.json(cached);
    try {
      const pts = await fetchFREDCsv(id, from);
      const data = pts.map(p => ({ date: p.date, close: p.value }));
      cache.set(key, { data, ts: Date.now() });
      return NextResponse.json(data);
    } catch (err) {
      console.error('macro history error', id, err);
      return NextResponse.json([], { status: 200 });
    }
  }

  // Latest values for a list of series
  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').filter(Boolean);
  if (!ids.length) return NextResponse.json([]);

  const key = `list:${[...ids].sort().join(',')}`;
  const cached = getCached(key);
  if (cached) return NextResponse.json(cached);

  // Fetch last 6 months so we always have the latest + previous observation
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  const fromStr = from.toISOString().split('T')[0];

  // Parallel fetch, up to 6 at a time
  const BATCH = 6;
  const results: { id: string; latest: { date: string; value: number } | null; prev: { date: string; value: number } | null }[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async (id) => {
      try {
        const pts = await fetchFREDCsv(id, fromStr);
        if (pts.length === 0) return { id, latest: null, prev: null };
        return {
          id,
          latest: pts[pts.length - 1],
          prev: pts.length > 1 ? pts[pts.length - 2] : null,
        };
      } catch {
        return { id, latest: null, prev: null };
      }
    }));
    results.push(...batchResults);
  }

  cache.set(key, { data: results, ts: Date.now() });
  return NextResponse.json(results);
}
