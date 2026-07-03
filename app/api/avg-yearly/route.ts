import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { fetchStooqDaily } from '@/lib/stooq';

export const runtime = 'edge';

// Average yearly (annual) return over an asset's FULL history — the "Average" the
// Returns table shows on its Yearly tab. This is a slow-moving, once-a-year metric,
// so it is cached LONG (12h) and fetched via its own endpoint instead of riding the
// 60-second quote refresh (which would hammer Yahoo with full-history requests).
interface CacheEntry { v: number | null; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 12 * 60 * 60_000; // 12 hours

// Mean of consecutive calendar-year returns from year-END closes (last close of each
// year). Matches ReturnsTableButton's Yearly "Average" row exactly.
function avgYearly(points: { date: string; close: number }[]): number | null {
  const yearEnd = new Map<number, number>();
  for (const p of points) {
    if (!(p.close > 0)) continue;
    const y = Number(p.date.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    yearEnd.set(y, p.close); // ascending dates → last write per year = year-end
  }
  const years = [...yearEnd.keys()].sort((a, b) => a - b);
  if (years.length < 2) return null;
  const rets: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const a = yearEnd.get(years[i - 1])!, b = yearEnd.get(years[i])!;
    if (a > 0) rets.push((b / a - 1) * 100);
  }
  if (rets.length === 0) return null;
  return rets.reduce((s, v) => s + v, 0) / rets.length;
}

async function computeOne(symbol: string): Promise<number | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.ts < TTL) return hit.v;
  const from = new Date('1970-01-01');
  const to = new Date();
  let v: number | null = null;
  try {
    // Monthly bars over the full range: light payload, year-end precision is all we need.
    let pts = await fetchYahooChart(symbol, from, to, '1mo');
    if (pts.length === 0) pts = await fetchStooqDaily(symbol, from, to, 'm');
    v = avgYearly(pts);
  } catch { v = null; }
  cache.set(symbol, { v, ts: Date.now() });
  return v;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbols') ?? '';
  const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))].slice(0, 120);
  if (symbols.length === 0) return NextResponse.json({});
  const results = await Promise.all(symbols.map(async s => [s, await computeOne(s)] as const));
  return NextResponse.json(Object.fromEntries(results));
}
