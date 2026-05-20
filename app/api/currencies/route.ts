import { NextRequest, NextResponse } from 'next/server';
import { format, subDays, subMonths, subYears, subWeeks, startOfYear } from 'date-fns';

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

const ALL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CNY', 'INR', 'CAD', 'AUD'];

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
      const data = await fetchFrankfurter(`https://api.frankfurter.app/latest?from=USD&to=${targets}`);
      const rates = data.rates as Record<string, number>;

      const pairs = [
        { from: 'USD', to: 'EUR', rate: rates['EUR'] ?? null },
        { from: 'EUR', to: 'USD', rate: rates['EUR'] ? 1 / rates['EUR'] : null },
        { from: 'GBP', to: 'USD', rate: rates['GBP'] ? 1 / rates['GBP'] : null },
        { from: 'USD', to: 'JPY', rate: rates['JPY'] ?? null },
        { from: 'USD', to: 'CHF', rate: rates['CHF'] ?? null },
        { from: 'USD', to: 'CNY', rate: rates['CNY'] ?? null },
        { from: 'USD', to: 'INR', rate: rates['INR'] ?? null },
        { from: 'USD', to: 'CAD', rate: rates['CAD'] ?? null },
        { from: 'EUR', to: 'GBP', rate: (rates['GBP'] && rates['EUR']) ? rates['GBP'] / rates['EUR'] : null },
        { from: 'EUR', to: 'JPY', rate: (rates['JPY'] && rates['EUR']) ? rates['JPY'] / rates['EUR'] : null },
      ];

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

      let actualFrom = from;
      let actualTo = to;
      let invert = false;

      if (from === 'EUR' && to === 'GBP') { actualFrom = 'USD'; actualTo = 'GBP,EUR'; }
      else if (from === 'EUR' && to === 'JPY') { actualFrom = 'USD'; actualTo = 'JPY,EUR'; }
      else if (from === 'GBP') { actualFrom = 'USD'; actualTo = 'GBP'; invert = true; }
      else if (from === 'EUR') { actualFrom = 'USD'; actualTo = 'EUR'; invert = true; }

      const url = `https://api.frankfurter.app/${startDate}..${endDate}?from=${actualFrom}&to=${actualTo}`;
      const data = await fetchFrankfurter(url);

      const rates = data.rates as Record<string, Record<string, number>>;
      let points: { date: string; rate: number }[] = [];

      if (from === 'EUR' && to === 'GBP') {
        points = Object.entries(rates).map(([date, r]) => ({
          date,
          rate: r['GBP'] && r['EUR'] ? r['GBP'] / r['EUR'] : 0,
        }));
      } else if (from === 'EUR' && to === 'JPY') {
        points = Object.entries(rates).map(([date, r]) => ({
          date,
          rate: r['JPY'] && r['EUR'] ? r['JPY'] / r['EUR'] : 0,
        }));
      } else if (invert) {
        const toCcy = actualTo as string;
        points = Object.entries(rates).map(([date, r]) => ({
          date,
          rate: r[toCcy] ? 1 / r[toCcy] : 0,
        }));
      } else {
        points = Object.entries(rates).map(([date, r]) => ({
          date,
          rate: r[actualTo] ?? 0,
        }));
      }

      points.sort((a, b) => a.date.localeCompare(b.date));
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
