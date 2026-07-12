import { NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { scoreRotation, selectPicks, ACCEL_LIMIT, realizedMonthlyVol, upsideVolEdge, trendQualityR2, rsiWilder, macdHistogram } from '@/lib/rotationModel';
import { computeWeeklyADX } from '@/lib/adx';
import { dalioVolumeRatios, rangeExpansion, medianClose } from '@/lib/dalioModel';

export const runtime = 'edge';

// Benchmark = S&P 500 ("what if I'd just bought the index").
const SPX = '^GSPC';

type Group = 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors' | 'Stocks';
interface Meta { symbol: string; name: string; group: Group }

// Base universe is derived straight from config, so new assets are backtested
// automatically — same source the live Rotation list iterates. Any active stock
// lists are appended per-request so the backtest matches the on-screen universe.
const BASE_UNIVERSE: Meta[] = [
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

// An asset that ACTUALLY won over the period (top forward return), regardless of
// whether the model picked it. `picked`/`passedGate` tell the diagnostic story:
//   picked            → the model got it
//   !picked & passed  → the model saw it accelerating but ranked it out of top N
//   !picked & !passed → the model's gate rejected it (signal/gate miss)
interface Winner {
  symbol: string; name: string; group: Group;
  r1m: number | null; r3m: number | null; r6m: number | null; r1y: number | null;
  fwd: number;
  picked: boolean;
  passedGate: boolean;
}

interface Scenario {
  key: string; label: string; asOf: string;
  picks: Pick[];
  winners: Winner[];
  basketFwd: number | null; universeFwd: number | null; spxFwd: number | null;
  nPicks: number; nBeatSpx: number; nWinnerHits: number;
}

interface Payload { generatedAt: string; scenarios: Scenario[]; universeSize: number }

interface CacheEntry { data: Payload; ts: number }
// Keyed by the active-stocks signature so different stock selections don't
// collide on one cached result.
const cache = new Map<string, CacheEntry>();
const TTL = 10 * 60_000;

// Yahoo daily bars include volume when the ticker reports it — carried through so
// the Dalio EMS volume ratios (M31) are computable at any as-of date, no look-ahead.
type Hist = { date: string; close: number; high?: number; low?: number; volume?: number }[];

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

// Match the standard asset timeframes so the model is easy to sanity-check:
// "what would it have picked 1 month / 1 year / 5 years ago, and how did that do?"
const SCENARIOS: { key: string; label: string; days: number }[] = [
  { key: '1d', label: 'Day', days: 1 },
  { key: '1m', label: '1M',  days: 30 },
  { key: '3m', label: '3M',  days: 90 },
  { key: '6m', label: '6M',  days: 183 },
  { key: '1y', label: '1Y',  days: 365 },
  { key: '5y', label: '5Y',  days: 1825 },
];

// Run the shared RotationModel as of a past date using only data up to that date
// (no look-ahead), then measure forward return to today.
function ma200AtDate(history: Hist, dateStr: string): number | null {
  const closes = history.filter(p => p.date <= dateStr).map(p => p.close);
  if (closes.length < 200) return null;
  return closes.slice(-200).reduce((s, c) => s + c, 0) / 200;
}

// 52-week range position as of a past date (trailing 365 calendar days, no look-ahead).
function pos52wAtDate(history: Hist, dateStr: string): number | null {
  const d = new Date(dateStr); d.setDate(d.getDate() - 365);
  const cutoff = d.toISOString().slice(0, 10);
  const window = history.filter(p => p.date >= cutoff && p.date <= dateStr);
  if (window.length < 2) return null;
  let hi = -Infinity, lo = Infinity;
  for (const p of window) { if (p.close > hi) hi = p.close; if (p.close < lo) lo = p.close; }
  const cur = priceAsOf(history, dateStr);
  if (cur == null || hi <= lo) return null;
  return Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
}

// 52-week HIGH as of a past date (trailing 365 calendar days) — the Dalio C gate's
// HighDist input. Same window as pos52wAtDate, but the raw high instead of the position.
function high52wAtDate(history: Hist, dateStr: string): number | null {
  const d = new Date(dateStr); d.setDate(d.getDate() - 365);
  const cutoff = d.toISOString().slice(0, 10);
  let hi = -Infinity, n = 0;
  for (const p of history) {
    if (p.date >= cutoff && p.date <= dateStr) { n++; if (p.close > hi) hi = p.close; }
  }
  return n >= 2 ? hi : null;
}

// 20 TRADING-day return (bar-count, not calendar) from closes up to the as-of date.
function r20FromCloses(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const cur = closes[closes.length - 1];
  const past = closes[closes.length - 21];
  return past > 0 ? (cur / past - 1) * 100 : null;
}

function buildScenario(universe: Meta[], histMap: Map<string, Hist>, todayStr: string, key: string, label: string, days: number): Scenario {
  const asOfDate = subDays(new Date(), days);
  const asOf = fmt(asOfDate);
  const d1m = fmt(subDays(asOfDate, 30));
  const d3m = fmt(subDays(asOfDate, 90));
  const d6m = fmt(subDays(asOfDate, 180));
  const d1y = fmt(subDays(asOfDate, 365));

  const rows = universe.map(m => {
    const h = histMap.get(m.symbol) ?? [];
    // Realized vol from ONLY the closes up to the as-of date (no look-ahead),
    // so the blow-off guard sees the same σ it would have seen back then.
    const upToAsOf = h.filter(p => p.date <= asOf);
    const closesAsOf = upToAsOf.map(p => p.close);
    const adxState = computeWeeklyADX(upToAsOf); // weekly ADX as of this date (M26 Gemini model)
    return {
      ...m,
      r1m: retBetween(h, d1m, asOf),
      r3m: retBetween(h, d3m, asOf),
      r6m: retBetween(h, d6m, asOf),
      r1y: retBetween(h, d1y, asOf),
      price: priceAsOf(h, asOf),
      ma200: ma200AtDate(h, asOf),
      vol: realizedMonthlyVol(closesAsOf),
      volEdge: upsideVolEdge(closesAsOf),
      pos52w: pos52wAtDate(h, asOf),
      trendR2: trendQualityR2(closesAsOf),
      trendR2Long: trendQualityR2(closesAsOf, 252),
      rsi: rsiWilder(closesAsOf),
      macdHist: macdHistogram(closesAsOf),
      sma200w: null as number | null, // 200W SMA not computed in backtest (too expensive)
      volRatio: null as number | null, // 20d-vs-latest volume ratio still unused by the score
      // M31 Dalio EMS inputs — computed from the SAME as-of window (no look-ahead).
      rvol5: dalioVolumeRatios(upToAsOf.map(p => p.volume)).rvol5,
      high52w: high52wAtDate(h, asOf),
      r20: r20FromCloses(closesAsOf),
      rangeExp: rangeExpansion(closesAsOf),
      median12m: medianClose(closesAsOf),
      adx: adxState?.adx ?? null,
      adxSlope: adxState?.adxSlope ?? null,
      plusDI: adxState?.plusDI ?? null,
      minusDI: adxState?.minusDI ?? null,
      fwd: retBetween(h, asOf, todayStr),
    };
  });

  const scored = scoreRotation(rows);
  const gateMap = new Map(scored.map(s => [s.item.symbol, s.passesGate]));
  // Picks = momentum names that clear the gate (ranked by score) PLUS a few
  // reserved pre-breakout "coiled spring" slots (M7) — see selectPicks().
  const pickItems = selectPicks(scored).map(s => s.item);
  const pickedSet = new Set(pickItems.map(r => r.symbol));

  const picks: Pick[] = pickItems.map((r): Pick => ({
    symbol: r.symbol, name: r.name, group: r.group,
    r1m: r.r1m, r3m: r.r3m, r6m: r.r6m, r1y: r.r1y,
    stage: (r.r6m != null && r.r6m < 0) || (r.r1y != null && r.r1y < 0) ? 'rebound'
         : (r.r6m != null && r.r6m > 0 && r.r1y != null && r.r1y > 0) ? 'trend' : 'neutral',
    fwd: r.fwd,
  }));

  // The assets that ACTUALLY won over the period — same count as picks, so the two
  // columns are directly comparable. When the model has few picks (e.g. shock period)
  // the winners column is equally compact; when it has 15 picks, we show 15 winners.
  const winners: Winner[] = rows
    .filter((r): r is typeof r & { fwd: number } => r.fwd != null)
    .sort((a, b) => b.fwd - a.fwd)
    .slice(0, pickItems.length || ACCEL_LIMIT)
    .map((r): Winner => ({
      symbol: r.symbol, name: r.name, group: r.group,
      r1m: r.r1m, r3m: r.r3m, r6m: r.r6m, r1y: r.r1y,
      fwd: r.fwd,
      picked: pickedSet.has(r.symbol),
      passedGate: gateMap.get(r.symbol) ?? false,
    }));
  const nWinnerHits = winners.filter(w => w.picked).length;

  const pickFwds = picks.map(p => p.fwd).filter((v): v is number => v != null);
  const basketFwd = pickFwds.length ? pickFwds.reduce((a, b) => a + b, 0) / pickFwds.length : null;
  const uniFwds = rows.map(r => r.fwd).filter((v): v is number => v != null);
  const universeFwd = uniFwds.length ? uniFwds.reduce((a, b) => a + b, 0) / uniFwds.length : null;
  const spxFwd = retBetween(histMap.get(SPX) ?? [], asOf, todayStr);
  const nBeatSpx = spxFwd == null ? 0 : picks.filter(p => p.fwd != null && p.fwd > spxFwd).length;

  return { key, label, asOf, picks, winners, basketFwd, universeFwd, spxFwd, nPicks: picks.length, nBeatSpx, nWinnerHits };
}

export async function GET(req: Request) {
  // Active stock lists arrive as ?stocks=SYM1,SYM2 — append them to the universe
  // so the backtest is run on exactly what the user sees in the live table.
  const { searchParams } = new URL(req.url);
  const baseSymbols = new Set(BASE_UNIVERSE.map(m => m.symbol));
  const stockSyms = (searchParams.get('stocks') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !baseSymbols.has(s)); // never duplicate a config asset
  const uniqStocks = [...new Set(stockSyms)];

  const universe: Meta[] = [
    ...BASE_UNIVERSE,
    ...uniqStocks.map(s => ({ symbol: s, name: s, group: 'Stocks' as const })),
  ];

  const cacheKey = uniqStocks.slice().sort().join(',');
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return NextResponse.json(cached.data);

  // ~6.4 years back so the 5-years-ago scenario still has a full 1Y lookback
  // (5y point + 365d of history before it) plus a small buffer.
  const from = subDays(new Date(), 1825 + 365 + 150);
  const to = new Date();
  const symbols = universe.map(m => m.symbol);

  const results = await Promise.allSettled(
    symbols.map(s => fetchYahooChart(s, from, to, '1d').catch(() => [] as Hist))
  );
  const histMap = new Map<string, Hist>();
  symbols.forEach((s, i) => {
    histMap.set(s, results[i].status === 'fulfilled' ? results[i].value : []);
  });

  const todayStr = fmt(to);
  const scenarios = SCENARIOS.map(s => buildScenario(universe, histMap, todayStr, s.key, s.label, s.days));

  const data: Payload = { generatedAt: todayStr, scenarios, universeSize: universe.length };
  cache.set(cacheKey, { data, ts: Date.now() });
  return NextResponse.json(data);
}
