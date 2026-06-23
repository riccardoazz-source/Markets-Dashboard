import { NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { scoreRotation, ACCEL_LIMIT } from '@/lib/rotationModel';

export const runtime = 'edge';

// Benchmark = S&P 500 ("what if I'd just bought the index").
const SPX = '^GSPC';

type Group = 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors';
interface Meta { symbol: string; name: string; group: Group }

// Universe is derived straight from config, so new assets are backtested
// automatically — same source the live Rotation list iterates.
const UNIVERSE: Meta[] = [
  ...INDEXES.map(i => ({ symbol: i.symbol, name: i.name, group: 'Indexes' as const })),
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, group: 'Commodities' as const })),
  ...CRYPTO_IDS.map(e => ({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' as const })),
  ...SECTORS.map(s => ({ symbol: s.symbol, name: s.name, group: 'Sectors' as const })),
];

type Stage = 'trend' | 'rebound' | 'neutral';

interface Pick {
  symbol: string; name: string; group: Group;
  r1m: number | null; r3m: number | null; r6m: number | null; r1y: number | null;
  stage: Stage;
  fwd: number | null;
}

interface Scenario {
  key: string; label: string; asOf: string;
  picks: Pick[];
  basketFwd: number | null; universeFwd: number | null; spxFwd: number | null;
  nPicks: number; nBeatSpx: number;
}

interface Payload { generatedAt: string; scenarios: Scenario[] }

interface CacheEntry { data: Payload; ts: number }
let cache: CacheEntry | null = null;
const TTL = 10 * 60_000;

type Hist = { date: string; close: number }[];

// Last close at or before a date string (history is ascending by date).
function priceAsOf(history: Hist, dateStr: string): number | null {
  let px: number | null = null;
  for (const pt of history) {
    if (pt.date <= dateStr) px = pt.close;
    else break;
  }
  return px;
}

function retBetween(history: Hist, startStr: string, endStr: string): number | null {
  const a = priceAsOf(history, startStr);
  const b = priceAsOf(history, endStr);
  if (a == null || b == null || a === 0) return null;
  return (b / a - 1) * 100;
}

function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

const SCENARIOS: { key: string; label: string; days: number }[] = [
  { key: '24m', label: '2 years ago',  days: 730 },
  { key: '18m', label: '18 months ago', days: 547 },
  { key: '12m', label: '1 year ago',   days: 365 },
  { key: '6m',  label: '6 months ago', days: 183 },
];

// Run the shared RotationModel as of a past date using only data up to that date
// (no look-ahead), then measure forward return to today.
function ma200AtDate(history: Hist, dateStr: string): number | null {
  const closes = history.filter(p => p.date <= dateStr).map(p => p.close);
  if (closes.length < 200) return null;
  return closes.slice(-200).reduce((s, c) => s + c, 0) / 200;
}

function buildScenario(histMap: Map<string, Hist>, todayStr: string, key: string, label: string, days: number): Scenario {
  const asOfDate = subDays(new Date(), days);
  const asOf = fmt(asOfDate);
  const d1m = fmt(subDays(asOfDate, 30));
  const d3m = fmt(subDays(asOfDate, 90));
  const d6m = fmt(subDays(asOfDate, 180));
  const d1y = fmt(subDays(asOfDate, 365));

  const rows = UNIVERSE.map(m => {
    const h = histMap.get(m.symbol) ?? [];
    return {
      ...m,
      r1m: retBetween(h, d1m, asOf),
      r3m: retBetween(h, d3m, asOf),
      r6m: retBetween(h, d6m, asOf),
      r1y: retBetween(h, d1y, asOf),
      price: priceAsOf(h, asOf),
      ma200: ma200AtDate(h, asOf),
      sma200w: null as number | null, // 200W SMA not computed in backtest (too expensive)
      volRatio: null as number | null, // volume history not available in backtest
      fwd: retBetween(h, asOf, todayStr),
    };
  });

  const picks: Pick[] = scoreRotation(rows)
    .filter(s => s.passesGate)
    .sort((a, b) => b.score - a.score)
    .slice(0, ACCEL_LIMIT)
    .map(s => s.item)
    .map((r): Pick => ({
      symbol: r.symbol, name: r.name, group: r.group,
      r1m: r.r1m, r3m: r.r3m, r6m: r.r6m, r1y: r.r1y,
      stage: (r.r6m != null && r.r6m < 0) || (r.r1y != null && r.r1y < 0) ? 'rebound'
           : (r.r6m != null && r.r6m > 0 && r.r1y != null && r.r1y > 0) ? 'trend' : 'neutral',
      fwd: r.fwd,
    }));

  const pickFwds = picks.map(p => p.fwd).filter((v): v is number => v != null);
  const basketFwd = pickFwds.length ? pickFwds.reduce((a, b) => a + b, 0) / pickFwds.length : null;
  const uniFwds = rows.map(r => r.fwd).filter((v): v is number => v != null);
  const universeFwd = uniFwds.length ? uniFwds.reduce((a, b) => a + b, 0) / uniFwds.length : null;
  const spxFwd = retBetween(histMap.get(SPX) ?? [], asOf, todayStr);
  const nBeatSpx = spxFwd == null ? 0 : picks.filter(p => p.fwd != null && p.fwd > spxFwd).length;

  return { key, label, asOf, picks, basketFwd, universeFwd, spxFwd, nPicks: picks.length, nBeatSpx };
}

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) return NextResponse.json(cache.data);

  // ~38 months back so the 2-years-ago scenario still has a full 1Y lookback.
  const from = subDays(new Date(), 1170);
  const to = new Date();
  const symbols = UNIVERSE.map(m => m.symbol);

  const results = await Promise.allSettled(
    symbols.map(s => fetchYahooChart(s, from, to, '1d').catch(() => [] as Hist))
  );
  const histMap = new Map<string, Hist>();
  symbols.forEach((s, i) => {
    histMap.set(s, results[i].status === 'fulfilled' ? results[i].value : []);
  });

  const todayStr = fmt(to);
  const scenarios = SCENARIOS.map(s => buildScenario(histMap, todayStr, s.key, s.label, s.days));

  const data: Payload = { generatedAt: todayStr, scenarios };
  cache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
