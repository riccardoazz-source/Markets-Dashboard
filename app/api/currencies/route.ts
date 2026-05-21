import { NextRequest, NextResponse } from 'next/server';
import { format, subDays, subMonths, subYears, subWeeks, startOfYear } from 'date-fns';
import { CURRENCY_GROUPS, CURRENCY_META } from '@/lib/config';

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 60_000;

function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}
function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

function getStartDate(timeframe: string): string {
  const now = new Date();
  switch (timeframe) {
    case '1D':  return format(subDays(now, 4), 'yyyy-MM-dd');
    case '1W':  return format(subWeeks(now, 1), 'yyyy-MM-dd');
    case '1M':  return format(subMonths(now, 1), 'yyyy-MM-dd');
    case '3M':  return format(subMonths(now, 3), 'yyyy-MM-dd');
    case '6M':  return format(subMonths(now, 6), 'yyyy-MM-dd');
    case 'YTD': return format(startOfYear(now), 'yyyy-MM-dd');
    case '1Y':  return format(subYears(now, 1), 'yyyy-MM-dd');
    case '3Y':  return format(subYears(now, 3), 'yyyy-MM-dd');
    case '5Y':  return format(subYears(now, 5), 'yyyy-MM-dd');
    case '10Y': return format(subYears(now, 10), 'yyyy-MM-dd');
    case 'MAX': return '1999-01-04'; // Frankfurter starts from the euro's launch
    default:    return format(subYears(now, 1), 'yyyy-MM-dd');
  }
}

async function fetchFrankfurter(url: string) {
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`Frankfurter: ${res.status}`);
  return res.json();
}

// Every currency referenced by any group (USD always included as the API base).
const ALL_CURRENCIES = Array.from(
  new Set(['USD', ...Object.keys(CURRENCY_META), ...CURRENCY_GROUPS.flatMap(g => [g.base, g.quote])]),
);

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'latest';
  const from = req.nextUrl.searchParams.get('from') ?? 'USD';
  const to = req.nextUrl.searchParams.get('to') ?? 'EUR';
  const timeframe = req.nextUrl.searchParams.get('timeframe') ?? '1Y';

  if (mode === 'latest') {
    const key = 'latest';
    const cached = getCached(key);
    if (cached) return NextResponse.json(cached);

    try {
      const targets = ALL_CURRENCIES.filter(c => c !== 'USD').join(',');
      // One time-series call (start of year → today) covers the latest rate,
      // the previous trading day (daily change) and the YTD baseline.
      const now = new Date();
      const ytdStart = `${now.getFullYear()}-01-01`;
      const today = format(now, 'yyyy-MM-dd');
      const data = await fetchFrankfurter(
        `https://api.frankfurter.app/${ytdStart}..${today}?from=USD&to=${targets}`,
      );
      const series = data.rates as Record<string, Record<string, number>>;
      const dates = Object.keys(series).sort();
      if (dates.length === 0) throw new Error('empty timeseries');

      const latestDay = series[dates[dates.length - 1]];
      const prevDay   = series[dates[dates.length - 2]] ?? latestDay;
      const ytdDay    = series[dates[0]];

      const now2 = new Date();
      const monthStartStr = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-01`;
      const mtdDate = dates.find(d => d >= monthStartStr);
      const mtdDay = mtdDate ? series[mtdDate] : null;

      // usdRate(X) = units of X per 1 USD. Cross rate A→B = usdRate(B)/usdRate(A).
      const usdRate = (day: Record<string, number>, c: string): number | null =>
        c === 'USD' ? 1 : (day?.[c] ?? null);
      const cross = (day: Record<string, number>, f: string, t: string): number | null => {
        const rf = usdRate(day, f), rt = usdRate(day, t);
        return rf && rt ? rt / rf : null;
      };
      const pct = (cur: number | null, base: number | null): number | null =>
        cur != null && base != null && base !== 0 ? (cur / base - 1) * 100 : null;

      const pairs = CURRENCY_GROUPS.flatMap(g =>
        [[g.base, g.quote], [g.quote, g.base]].map(([f, t]) => {
          const rate = cross(latestDay, f, t);
          return {
            from: f, to: t, rate,
            change1d: pct(rate, cross(prevDay, f, t)),
            ytd:      pct(rate, cross(ytdDay, f, t)),
            mtd:      mtdDay ? pct(rate, cross(mtdDay, f, t)) : null,
          };
        }),
      );

      setCached(key, pairs);
      return NextResponse.json(pairs);
    } catch (err) {
      console.error('currencies latest error', err);
      return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
    }
  }

  if (mode === 'historical') {
    const fromDateParam = req.nextUrl.searchParams.get('fromDate');
    const toDateParam   = req.nextUrl.searchParams.get('toDate');
    const isCustom = !!(fromDateParam && toDateParam);
    const key = isCustom
      ? `hist:${from}:${to}:${fromDateParam}:${toDateParam}`
      : `hist:${from}:${to}:${timeframe}`;
    const cached = getCached(key);
    if (cached) return NextResponse.json(cached);

    try {
      const startDate = isCustom ? fromDateParam! : getStartDate(timeframe);
      const endDate   = isCustom ? toDateParam!   : format(new Date(), 'yyyy-MM-dd');

      // Frankfurter rebases to any supported currency, so the pair can be
      // requested directly — no USD routing / manual inversion needed.
      const url = `https://api.frankfurter.app/${startDate}..${endDate}?from=${from}&to=${to}`;
      const data = await fetchFrankfurter(url);

      const rates = data.rates as Record<string, Record<string, number>>;
      const points = Object.entries(rates)
        .map(([date, r]) => ({ date, rate: r[to] ?? 0 }))
        .filter(p => p.rate > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      const avg = points.reduce((s, p) => s + p.rate, 0) / (points.length || 1);
      const result = { points, average: avg };

      setCached(key, result);
      return NextResponse.json(result);
    } catch (err) {
      console.error('currencies historical error', err);
      return NextResponse.json({ error: 'Failed to fetch historical rates' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
}
