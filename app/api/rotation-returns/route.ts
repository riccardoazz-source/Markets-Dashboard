import { NextResponse } from 'next/server';
import { fetchYahooChart } from '@/lib/yahoo';
import { subDays } from 'date-fns';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { realizedMonthlyVol, upsideVolEdge, trendQualityR2, rsiWilder, macdHistogram } from '@/lib/rotationModel';
import { computeWeeklyADX } from '@/lib/adx';
import { dalioVolumeRatios, rangeExpansion, medianClose } from '@/lib/dalioModel';

export const runtime = 'edge';

interface RollingReturn {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  ma200: number | null;
  vol: number | null;    // realized monthly volatility (%) — feeds the blow-off guard
  volEdge: number | null; // net upside volatility (%/month) — VQ signal (M6)
  volRatio: number | null;
  high52w: number | null;
  low52w: number | null;
  pos52w: number | null; // 0–100 position of the latest close within the 52W range
  trendR2: number | null; // 0–1 smoothness of the trailing ~6mo uptrend (LEAD signal)
  trendR2Long: number | null; // 0–1 ~12mo trend persistence (CYC signal)
  rsi: number | null;     // Wilder 14-day RSI (M8 overheat guard)
  macdHist: number | null; // MACD histogram as % of price (M8 acceleration confirmation)
  lastClose: number | null; // most recent daily close — use for regime gate (not intraday)
  adx: number | null;      // weekly ADX (M26 Gemini model)
  adxSlope: number | null; // weekly ADX slope (M26)
  plusDI: number | null;   // weekly +DI (M26)
  minusDI: number | null;  // weekly −DI (M26)
  // ── Dalio early-momentum inputs (volume vs its own baseline) ──
  rvol5: number | null;    // 5-day SMA of (ADV5 / ADV60) — smoothed short-window volume ratio
  rvol20: number | null;   // ADV20 / ADV60 — raw medium-window volume ratio
  r20: number | null;      // 20 TRADING-day price return (%) — Dalio's primary momentum filter
  rangeExp: number | null; // range-expansion proxy 0–1 (volume-blind flow substitute, M31 v2)
  median12m: number | null;// 12-month median close (commodity overheat brake, M31 v3)
}

interface CacheEntry { data: RollingReturn[]; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 5 * 60_000;

function rolling(history: { date: string; close: number }[], daysAgo: number): number | null {
  if (history.length < 2) return null;
  const current = history[history.length - 1].close;
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const targetStr = d.toISOString().slice(0, 10);
  let past: number | null = null;
  for (const pt of history) {
    if (pt.date <= targetStr) past = pt.close;
    else break;
  }
  if (!past || past === 0) return null;
  return (current / past - 1) * 100;
}

// 200-day simple moving average: average of the last 200 daily closes.
// 470-day fetch ≈ 325 trading days — enough for this MA and the 252-day CYC R².
function ma200d(history: { date: string; close: number }[]): number | null {
  if (history.length < 200) return null;
  const last200 = history.slice(-200);
  return last200.reduce((s, pt) => s + pt.close, 0) / 200;
}

// Ratio of latest-day volume to the average of the prior 20 trading days.
// Null when fewer than 10 days have valid volume (e.g. index tickers with no volume data).
function volRatio20(history: { date: string; close: number; volume?: number }[]): number | null {
  if (history.length < 21) return null;
  const latest = history[history.length - 1].volume;
  if (latest == null || latest <= 0) return null;
  const prior = history.slice(-21, -1).map(p => p.volume).filter((v): v is number => v != null && v > 0);
  if (prior.length < 10) return null;
  const avg = prior.reduce((s, v) => s + v, 0) / prior.length;
  return avg > 0 ? latest / avg : null;
}

// 52-week high/low and the latest close's position within that range.
// Window = trailing 365 calendar days (the 375-day fetch leaves a small buffer).
//   pos = (close − low) / (high − low) × 100  →  0% at the low, 100% at the high.
function range52w(history: { date: string; close: number }[]): { high52w: number | null; low52w: number | null; pos52w: number | null } {
  if (history.length < 2) return { high52w: null, low52w: null, pos52w: null };
  const d = new Date();
  d.setDate(d.getDate() - 365);
  const cutoff = d.toISOString().slice(0, 10);
  const window = history.filter(p => p.date >= cutoff);
  if (window.length < 2) return { high52w: null, low52w: null, pos52w: null };
  let hi = -Infinity, lo = Infinity;
  for (const p of window) {
    if (p.close > hi) hi = p.close;
    if (p.close < lo) lo = p.close;
  }
  const current = history[history.length - 1].close;
  const pos = hi > lo ? Math.max(0, Math.min(100, ((current - lo) / (hi - lo)) * 100)) : null;
  return { high52w: hi, low52w: lo, pos52w: pos };
}

// 20 TRADING-day return (Dalio's momentum filter) — bar-count based, not calendar.
function r20Trading(history: { close: number }[]): number | null {
  if (history.length < 21) return null;
  const cur = history[history.length - 1].close;
  const past = history[history.length - 21].close;
  return past > 0 ? (cur / past - 1) * 100 : null;
}

function buildRow(symbol: string, history: { date: string; close: number; volume?: number; high?: number; low?: number }[]): RollingReturn {
  const dalio = dalioVolumeRatios(history.map(p => p.volume));
  const r = range52w(history);
  const adxState = computeWeeklyADX(history); // live weekly ADX (M26 Gemini model)
  return {
    symbol,
    r1m: rolling(history, 30),
    r3m: rolling(history, 90),
    r6m: rolling(history, 180),
    r1y: rolling(history, 365),
    ma200: ma200d(history),
    vol: realizedMonthlyVol(history.map(p => p.close)),
    volEdge: upsideVolEdge(history.map(p => p.close)),
    volRatio: volRatio20(history),
    high52w: r.high52w,
    low52w: r.low52w,
    pos52w: r.pos52w,
    trendR2: trendQualityR2(history.map(p => p.close)),
    trendR2Long: trendQualityR2(history.map(p => p.close), 252),
    rsi: rsiWilder(history.map(p => p.close)),
    macdHist: macdHistogram(history.map(p => p.close)),
    lastClose: history.length > 0 ? history[history.length - 1].close : null,
    adx: adxState?.adx ?? null,
    adxSlope: adxState?.adxSlope ?? null,
    plusDI: adxState?.plusDI ?? null,
    minusDI: adxState?.minusDI ?? null,
    rvol5: dalio.rvol5,
    rvol20: dalio.rvol20,
    r20: r20Trading(history),
    rangeExp: rangeExpansion(history.map(p => p.close)),
    median12m: medianClose(history.map(p => p.close)),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const extra = searchParams.get('extra');

  if (extra) {
    const syms = Array.from(new Set(extra.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 60);
    if (syms.length === 0) return NextResponse.json([]);
    const key = 'extra:' + [...syms].sort().join(',');
    const cachedExtra = cache.get(key);
    if (cachedExtra && Date.now() - cachedExtra.ts < TTL) {
      return NextResponse.json(cachedExtra.data);
    }
    const from = subDays(new Date(), 470);
    const to = new Date();
    const results = await Promise.allSettled(
      syms.map(sym => fetchYahooChart(sym, from, to, '1d').catch(() => []))
    );
    const data: RollingReturn[] = syms.map((symbol, i) => {
      const history = results[i].status === 'fulfilled' ? results[i].value : [];
      return buildRow(symbol, history);
    });
    cache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  }

  const cached = cache.get('all');
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json(cached.data);
  }

  const allSymbols = [
    ...INDEXES.map(i => i.symbol),
    ...COMMODITIES.map(c => c.symbol),
    ...CRYPTO_IDS.map(e => CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`),
    ...SECTORS.map(s => s.symbol),
  ];

  const from = subDays(new Date(), 470);
  const to = new Date();

  const results = await Promise.allSettled(
    allSymbols.map(sym => fetchYahooChart(sym, from, to, '1d').catch(() => []))
  );

  const data: RollingReturn[] = allSymbols.map((symbol, i) => {
    const history = results[i].status === 'fulfilled' ? results[i].value : [];
    return buildRow(symbol, history);
  });

  cache.set('all', { data, ts: Date.now() });
  return NextResponse.json(data);
}
