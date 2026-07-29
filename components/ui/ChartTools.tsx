'use client';

import { useState, useMemo } from 'react';
import { HistoricalPoint } from '@/lib/types';
import { Calculator, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  computeBollingerBands, computeFibLevels, computeMomentum,
  computeSma200wLatest, computeRsiResampledDaily, computeMacdResampledDaily, avgCalendarDaysPerBar, computeIndicatorPeriods,
} from '@/lib/indicators';
import { useFullHistory } from '@/lib/useFullHistory';

export interface ActiveTools {
  avg: boolean;
  stdDev: boolean;
  minMax: boolean;
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  sma200w: boolean;
  ema20: boolean;
  ema100: boolean;
  bollinger: boolean;
  fib: boolean;
  rsi: boolean;
  rsiWeekly: boolean;   // RSI timeframe: weekly / monthly / (neither = daily) — mutually exclusive
  rsiMonthly: boolean;
  macd: boolean;
  macdWeekly: boolean;  // MACD timeframe: weekly / monthly / (neither = daily) — mutually exclusive
  macdMonthly: boolean;
  momentumDaily: boolean;
  momentumWeekly: boolean;
  momentumMonthly: boolean;
  volume: boolean;
  volumeWeekly: boolean;   // Volume grain: weekly / monthly / (neither = daily) — mutually exclusive
  volumeMonthly: boolean;
  spyRatio: boolean;
  trend: boolean;      // linear-regression trend line
  trendFull: boolean;  // true = fit on FULL history (shown over the visible window); false = fit on the visible period only
}

export const DEFAULT_TOOLS: ActiveTools = {
  avg: false, stdDev: false, minMax: false,
  sma20: false, sma50: false, sma200: false, sma200w: false, ema20: false, ema100: false,
  bollinger: false, fib: false,
  rsi: false, rsiWeekly: false, rsiMonthly: false,
  macd: false, macdWeekly: false, macdMonthly: false,
  momentumDaily: false, momentumWeekly: false, momentumMonthly: false,
  volume: false, volumeWeekly: false, volumeMonthly: false,
  spyRatio: false,
  trend: false, trendFull: true,
};

// Tools whose maths use the FULL price history so the value/line is the same at every view
// period and can be drawn even on a short window. ALL moving averages qualify (a moving
// average is a fixed number today, independent of the selected period), plus the full-history
// trend. When any is active the chart fetches MAX history and computes on it, projecting onto
// the visible bars.
export function needsFullHistory(t: ActiveTools): boolean {
  return t.sma20 || t.sma50 || t.sma200 || t.sma200w || t.ema20 || t.ema100 ||
    (t.trend && t.trendFull) ||
    (t.rsi && (t.rsiWeekly || t.rsiMonthly)) ||
    (t.macd && (t.macdWeekly || t.macdMonthly));
}

interface Props {
  data: HistoricalPoint[];
  activeTools: ActiveTools;
  onChange: (tools: ActiveTools) => void;
  decimals?: number;
  symbol?: string; // when provided, long MAs / full trend compute on this symbol's full history
}

function computeStats(closes: number[], avgDPB: number) {
  if (closes.length < 2) return null;
  const avg = closes.reduce((s, v) => s + v, 0) / closes.length;
  const variance = closes.reduce((s, v) => s + (v - avg) ** 2, 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0)
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  let annualVol: number | null = null;
  if (logReturns.length > 1) {
    const lrMean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const lrVar = logReturns.reduce((s, v) => s + (v - lrMean) ** 2, 0) / (logReturns.length - 1);
    // Annualize by the actual number of bars per year for this data's cadence.
    // Daily equity → 365.25/1.4 ≈ 261, crypto → 365, monthly → 12, quarterly → 4.
    const barsPerYear = 365.25 / avgDPB;
    annualVol = Math.sqrt(lrVar * barsPerYear) * 100;
  }

  let maxDrawdown = 0, peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = peak > 0 ? (peak - c) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return { avg, stdDev, min, max, annualVol, maxDrawdown };
}

/** Last non-null value from an array. */
const last = <T,>(arr: (T | null)[]): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
};

export function ChartTools({ data, activeTools, onChange, decimals = 2, symbol }: Props) {
  const [open, setOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const closes = useMemo(
    () => data.map(d => d.close).filter((c): c is number => typeof c === 'number' && isFinite(c)),
    [data],
  );
  const n = closes.length;

  // Whether this ticker reports volume at all. Coverage varies and is not worth
  // predicting by asset class — plenty of index symbols do publish it — so the chip
  // is offered wherever the series is actually there, and only there.
  const hasVolume = useMemo(() => data.some(d => d.volume != null && d.volume > 0), [data]);

  // Full history so EVERY moving average can be enabled and computed regardless of the view
  // period (a MA is a fixed number today, independent of the window). Fetched as soon as the
  // Tools panel is opened — so the chips reflect the full dataset and stay enable-able even on
  // a 1-day view — and whenever a full-history tool is already active.
  const fullHist = useFullHistory(symbol, open || needsFullHistory(activeTools));
  const longCloses = useMemo(
    () => (fullHist ? fullHist.map(d => d.close).filter((c): c is number => typeof c === 'number' && isFinite(c)) : closes),
    [fullHist, closes],
  );
  const nL = longCloses.length;

  // Scale all indicator periods to the data's real-world time granularity.
  // Equity: ~1.4 cal days/bar. Crypto: ~1.0 (trades 7d/wk). Monthly FRED: ~30.
  const avgDPB = useMemo(() => avgCalendarDaysPerBar(data.map(d => d.date)), [data]);
  const stats = useMemo(() => computeStats(closes, avgDPB), [closes, avgDPB]);
  const P = useMemo(() => computeIndicatorPeriods(avgDPB), [avgDPB]);

  // Long MAs are computed on the FULL history, so their periods MUST be scaled to the full
  // history's own granularity — NOT the visible window's. Otherwise a short view (few bars →
  // a different avg-days-per-bar estimate) would rescale the period and the SMA/EMA value would
  // change with the selected period, which is wrong: a moving average is a fixed number today.
  const PL = useMemo(
    () => (fullHist ? computeIndicatorPeriods(avgCalendarDaysPerBar(fullHist.map(d => d.date))) : P),
    [fullHist, P],
  );

  // Pre-compute all indicator current values once per data change
  const iv = useMemo(() => {
    if (closes.length === 0) return null;
    const sma50arr   = PL.sma50.ok && nL >= PL.sma50.period   ? computeSMA(longCloses, PL.sma50.period)   : null;
    const sma200arr  = PL.sma200.ok && nL >= PL.sma200.period  ? computeSMA(longCloses, PL.sma200.period)  : null;
    // 200-week SMA uses the TradingView weekly-close method, on the raw (aligned) daily series.
    const sma200wVal = fullHist
      ? computeSma200wLatest(fullHist.map(d => d.date), fullHist.map(d => d.close))
      : computeSma200wLatest(data.map(d => d.date), data.map(d => d.close));
    const sma50val   = sma50arr  ? last(sma50arr)  : null;
    const sma200val  = sma200arr ? last(sma200arr) : null;
    const bbands     = P.boll.ok && n >= P.boll.period ? computeBollingerBands(closes, P.boll.period, 2) : null;
    const macdGrain  = activeTools.macdMonthly ? 'monthly' : activeTools.macdWeekly ? 'weekly' : null;
    const macdOut    = macdGrain
      ? (fullHist ? computeMacdResampledDaily(fullHist.map(d => d.date), fullHist.map(d => d.close), macdGrain) : null)
      : (P.macdSlow.ok && n >= (P.macdSlow.period + P.macdSig.period)
          ? computeMACD(closes, P.macdFast.period, P.macdSlow.period, P.macdSig.period) : null);
    const rsiGrainV  = activeTools.rsiMonthly ? 'monthly' : activeTools.rsiWeekly ? 'weekly' : null;
    return {
      sma20:   PL.sma20.ok && nL >= PL.sma20.period   ? last(computeSMA(longCloses, PL.sma20.period))   : null,
      ema20:   PL.ema20.ok && nL >= PL.ema20.period   ? last(computeEMA(longCloses, PL.ema20.period))   : null,
      ema100:  PL.ema100.ok && nL >= PL.ema100.period  ? last(computeEMA(longCloses, PL.ema100.period))  : null,
      sma50:   sma50val,
      sma200:  sma200val,
      sma200w: sma200wVal,
      cross:   sma50val != null && sma200val != null
                 ? (sma50val > sma200val ? 'golden' : 'death') as 'golden' | 'death'
                 : null,
      bbUpper: bbands ? last(bbands.upper) : null,
      bbLower: bbands ? last(bbands.lower) : null,
      rsi:    rsiGrainV
                ? (fullHist ? last(computeRsiResampledDaily(fullHist.map(d => d.date), fullHist.map(d => d.close), rsiGrainV, 14)) : null)
                : (P.rsi.ok && n >= P.rsi.period ? last(computeRSI(closes, P.rsi.period)) : null),
      macd:   macdOut ? last(macdOut.macd)   : null,
      signal: macdOut ? last(macdOut.signal) : null,
      hist:   macdOut ? last(macdOut.hist)   : null,
      fibs:   n >= 2  ? computeFibLevels(closes) : null,
      momentumDaily:   n >= 2            ? last(computeMomentum(closes, 1))              : null,
      momentumWeekly:  n >= P.momWeek.period  ? last(computeMomentum(closes, P.momWeek.period))  : null,
      momentumMonthly: n >= P.momMonth.period ? last(computeMomentum(closes, P.momMonth.period)) : null,
    };
  }, [closes, longCloses, n, nL, P, PL, fullHist, data,
      activeTools.rsiWeekly, activeTools.rsiMonthly, activeTools.macdWeekly, activeTools.macdMonthly]);

  const toggle = (key: keyof ActiveTools) =>
    onChange({ ...activeTools, [key]: !activeTools[key] });

  // trendFull / rsiWeekly / macdWeekly are modifiers of the Trend / RSI / MACD tools, not tools
  // of their own — exclude them so the badge doesn't count a tool that isn't active.
  const MODIFIER_KEYS: (keyof ActiveTools)[] = ['trendFull', 'rsiWeekly', 'rsiMonthly', 'macdWeekly', 'macdMonthly'];
  const activeCount = (Object.keys(activeTools) as (keyof ActiveTools)[])
    .filter(k => !MODIFIER_KEYS.includes(k) && activeTools[k]).length;
  const showResults = activeCount > 0 && stats != null && iv != null;

  // Momentum is a single chip with a Daily/Weekly/Monthly selector — the three flags stay
  // mutually exclusive under the hood.
  const momActive = activeTools.momentumDaily || activeTools.momentumWeekly || activeTools.momentumMonthly;
  const momPeriod: 'daily' | 'weekly' | 'monthly' =
    activeTools.momentumWeekly ? 'weekly' : activeTools.momentumMonthly ? 'monthly' : 'daily';
  const setMom = (p: 'daily' | 'weekly' | 'monthly' | null) =>
    onChange({ ...activeTools, momentumDaily: p === 'daily', momentumWeekly: p === 'weekly', momentumMonthly: p === 'monthly' });
  const nextMom = () => setMom(momPeriod === 'daily' ? 'weekly' : momPeriod === 'weekly' ? 'monthly' : 'daily');

  // RSI / MACD share a daily→weekly→monthly selector (weekly & monthly flags are mutually exclusive).
  type Grain3 = 'daily' | 'weekly' | 'monthly';
  const nextGrain = (g: Grain3): Grain3 => (g === 'daily' ? 'weekly' : g === 'weekly' ? 'monthly' : 'daily');
  const rsiGrain: Grain3 = activeTools.rsiMonthly ? 'monthly' : activeTools.rsiWeekly ? 'weekly' : 'daily';
  const cycleRsi = () => { const g = nextGrain(rsiGrain); onChange({ ...activeTools, rsiWeekly: g === 'weekly', rsiMonthly: g === 'monthly' }); };
  const macdGrain: Grain3 = activeTools.macdMonthly ? 'monthly' : activeTools.macdWeekly ? 'weekly' : 'daily';
  const cycleMacd = () => { const g = nextGrain(macdGrain); onChange({ ...activeTools, macdWeekly: g === 'weekly', macdMonthly: g === 'monthly' }); };
  const volGrain: Grain3 = activeTools.volumeMonthly ? 'monthly' : activeTools.volumeWeekly ? 'weekly' : 'daily';
  const cycleVol = () => { const g = nextGrain(volGrain); onChange({ ...activeTools, volumeWeekly: g === 'weekly', volumeMonthly: g === 'monthly' }); };

  return (
    <div className="border border-border rounded-xl overflow-hidden" data-print-hide>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-input text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Calculator size={13} />
          Tools
          {activeCount > 0 && (
            <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-[10px] text-gray-600">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="px-3 py-2 space-y-2 bg-bg-card">
          {!stats ? (
            <p className="text-xs text-gray-600 italic">No data available.</p>
          ) : (
            <>
              {/* ── Compact chip toggles ────────────────────────────────── */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <ToolChip active={activeTools.spyRatio} onToggle={() => toggle('spyRatio')} label="vs SPY" color="slate" />
                <Divider />
                <ToolChip active={activeTools.avg}     onToggle={() => toggle('avg')}     label="Avg"      color="amber"  />
                <ToolChip active={activeTools.stdDev}  onToggle={() => toggle('stdDev')}  label="Std Dev"  color="sky"    />
                <ToolChip active={activeTools.minMax}  onToggle={() => toggle('minMax')}  label="Min/Max"  color="violet" />
                <Divider />
                <ToolChip active={activeTools.sma20}   onToggle={() => toggle('sma20')}   label="SMA 20"   color="cyan"   disabled={!PL.sma20.ok   || nL < PL.sma20.period}   />
                <ToolChip active={activeTools.ema20}   onToggle={() => toggle('ema20')}   label="EMA 20"   color="rose"   disabled={!PL.ema20.ok   || nL < PL.ema20.period}   />
                <ToolChip active={activeTools.ema100}  onToggle={() => toggle('ema100')}  label="EMA 100"  color="rose"   disabled={!PL.ema100.ok  || nL < PL.ema100.period}  />
                <ToolChip active={activeTools.sma50}   onToggle={() => toggle('sma50')}   label="SMA 50"   color="orange" disabled={!PL.sma50.ok   || nL < PL.sma50.period}   />
                <ToolChip active={activeTools.sma200}  onToggle={() => toggle('sma200')}  label="SMA 200"  color="purple" disabled={!PL.sma200.ok  || nL < PL.sma200.period}  />
                <ToolChip active={activeTools.sma200w} onToggle={() => toggle('sma200w')} label="SMA 200W" color="yellow" disabled={!PL.sma200w.ok || nL < PL.sma200w.period} title={!PL.sma200w.ok || nL < PL.sma200w.period ? 'Needs ~4y of data (not enough price history for this asset)' : undefined} />
                <Divider />
                <ToolChip active={activeTools.trend}  onToggle={() => toggle('trend')}  label="Trend" color="green" disabled={n < 2} />
                {activeTools.trend && (
                  <button
                    onClick={() => onChange({ ...activeTools, trendFull: !activeTools.trendFull })}
                    className="text-[10px] px-2 py-0.5 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                    title="Fit the trend line on the full price history, or only on the visible period"
                  >
                    {activeTools.trendFull ? 'full history' : 'visible period'}
                  </button>
                )}
                <Divider />
                <ToolChip active={activeTools.bollinger} onToggle={() => toggle('bollinger')} label="Bollinger" color="teal"   disabled={!P.boll.ok || n < P.boll.period} />
                <ToolChip active={activeTools.fib}       onToggle={() => toggle('fib')}       label="Fibonacci" color="yellow" disabled={n < 2} />
                <Divider />
                <ToolChip active={activeTools.rsi}  onToggle={() => toggle('rsi')}  label="RSI 14" color="indigo" disabled={n < 2} />
                {activeTools.rsi && (
                  <button
                    onClick={cycleRsi}
                    className="text-[10px] px-2 py-0.5 rounded-md border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition-colors capitalize"
                    title="Compute RSI 14 on daily / weekly / monthly closes"
                  >
                    {rsiGrain}
                  </button>
                )}
                <ToolChip active={activeTools.macd} onToggle={() => toggle('macd')} label="MACD"   color="green"  disabled={n < 2} />
                {activeTools.macd && (
                  <button
                    onClick={cycleMacd}
                    className="text-[10px] px-2 py-0.5 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors capitalize"
                    title="Compute MACD on daily / weekly / monthly closes"
                  >
                    {macdGrain}
                  </button>
                )}
                <Divider />
                <ToolChip
                  active={activeTools.volume} onToggle={() => toggle('volume')} label="Volume" color="slate"
                  disabled={!hasVolume}
                  title={hasVolume
                    ? 'Traded volume, green when the close was up over the period'
                    : 'This ticker reports no volume'}
                />
                {activeTools.volume && (
                  <button
                    onClick={cycleVol}
                    className="text-[10px] px-2 py-0.5 rounded-md border border-slate-500/40 text-slate-300 hover:bg-slate-500/10 transition-colors capitalize"
                    title="Total volume per day / week / month"
                  >
                    {volGrain}
                  </button>
                )}
                <Divider />
                <ToolChip active={momActive} onToggle={() => setMom(momActive ? null : 'daily')} label="Momentum" color="sky" disabled={n < 2} />
                {momActive && (
                  <button
                    onClick={nextMom}
                    className="text-[10px] px-2 py-0.5 rounded-md border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 transition-colors capitalize"
                    title="Choose the momentum look-back: daily / weekly / monthly"
                  >
                    {momPeriod}
                  </button>
                )}
              </div>

              {/* ── Results strip — visible when any tool is active ──────── */}
              {showResults && (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5 border-t border-border/40">

                  {activeTools.avg && (
                    <Res label="Mean" value={stats.avg.toFixed(decimals)} color="text-amber-400" />
                  )}
                  {activeTools.stdDev && (
                    <>
                      <Res label="+1σ" value={(stats.avg + stats.stdDev).toFixed(decimals)} color="text-sky-400" />
                      <Res label="−1σ" value={(stats.avg - stats.stdDev).toFixed(decimals)} color="text-sky-400" />
                    </>
                  )}
                  {activeTools.minMax && (
                    <>
                      <Res label="High" value={stats.max.toFixed(decimals)} color="text-violet-400" />
                      <Res label="Low"  value={stats.min.toFixed(decimals)} color="text-violet-400" />
                    </>
                  )}

                  {activeTools.sma20 && iv.sma20 != null && (
                    <Res label="SMA 20" value={iv.sma20.toFixed(decimals)} color="text-cyan-400" />
                  )}
                  {activeTools.ema20 && iv.ema20 != null && (
                    <Res label="EMA 20" value={iv.ema20.toFixed(decimals)} color="text-rose-400" />
                  )}
                  {activeTools.ema100 && iv.ema100 != null && (
                    <Res label="EMA 100" value={iv.ema100.toFixed(decimals)} color="text-pink-400" />
                  )}
                  {activeTools.sma50 && iv.sma50 != null && (
                    <Res label="SMA 50" value={iv.sma50.toFixed(decimals)} color="text-orange-400" />
                  )}
                  {activeTools.sma200 && iv.sma200 != null && (
                    <Res label="SMA 200" value={iv.sma200.toFixed(decimals)} color="text-purple-400" />
                  )}
                  {activeTools.sma200w && iv.sma200w != null && (
                    <Res label="SMA 200W" value={iv.sma200w.toFixed(decimals)} color="text-yellow-400" />
                  )}

                  {/* Golden / Death Cross badge */}
                  {activeTools.sma50 && activeTools.sma200 && iv.cross && (
                    <div className={clsx(
                      'self-end px-2 py-0.5 rounded-full text-[10px] font-bold border',
                      iv.cross === 'golden'
                        ? 'bg-yellow-400/15 text-yellow-400 border-yellow-400/40'
                        : 'bg-red-400/15 text-red-400 border-red-400/40',
                    )}>
                      {iv.cross === 'golden' ? '✦ Golden Cross' : '✦ Death Cross'}
                    </div>
                  )}

                  {activeTools.bollinger && iv.bbUpper != null && iv.bbLower != null && (
                    <>
                      <Res label="BB ↑" value={iv.bbUpper.toFixed(decimals)} color="text-teal-400" />
                      <Res label="BB ↓" value={iv.bbLower.toFixed(decimals)} color="text-teal-400" />
                    </>
                  )}

                  {activeTools.fib && iv.fibs && iv.fibs.length > 0 && (
                    <>
                      {iv.fibs
                        .filter(f => [0.236, 0.382, 0.5, 0.618, 0.786].includes(f.ratio))
                        .map(f => (
                          <Res
                            key={f.ratio}
                            label={`Fib ${(f.ratio * 100).toFixed(1)}%`}
                            value={f.value.toFixed(decimals)}
                            color="text-yellow-400"
                          />
                        ))}
                    </>
                  )}

                  {activeTools.rsi && iv.rsi != null && (
                    <Res
                      label={`RSI 14 ${rsiGrain === 'monthly' ? 'M' : rsiGrain === 'weekly' ? 'W' : 'D'}${iv.rsi > 70 ? ' · Overbought' : iv.rsi < 30 ? ' · Oversold' : ''}`}
                      value={iv.rsi.toFixed(1)}
                      color={iv.rsi > 70 ? 'text-red-400' : iv.rsi < 30 ? 'text-emerald-400' : 'text-indigo-400'}
                    />
                  )}

                  {activeTools.macd && iv.macd != null && iv.signal != null && iv.hist != null && (
                    <>
                      <Res label={`MACD ${macdGrain === 'monthly' ? 'M' : macdGrain === 'weekly' ? 'W' : 'D'}`} value={iv.macd.toFixed(decimals)} color="text-emerald-400" />
                      <Res label="Signal" value={iv.signal.toFixed(decimals)} color="text-emerald-400" />
                      <Res
                        label="Histogram"
                        value={(iv.hist >= 0 ? '+' : '') + iv.hist.toFixed(decimals)}
                        color={iv.hist >= 0 ? 'text-emerald-400' : 'text-red-400'}
                      />
                    </>
                  )}

                  {activeTools.momentumDaily && iv.momentumDaily != null && (
                    <Res
                      label="Mom. 1D"
                      value={(iv.momentumDaily >= 0 ? '+' : '') + iv.momentumDaily.toFixed(2) + '%'}
                      color={iv.momentumDaily >= 0 ? 'text-sky-400' : 'text-red-400'}
                    />
                  )}
                  {activeTools.momentumWeekly && iv.momentumWeekly != null && (
                    <Res
                      label="Mom. 1W"
                      value={(iv.momentumWeekly >= 0 ? '+' : '') + iv.momentumWeekly.toFixed(2) + '%'}
                      color={iv.momentumWeekly >= 0 ? 'text-sky-400' : 'text-red-400'}
                    />
                  )}
                  {activeTools.momentumMonthly && iv.momentumMonthly != null && (
                    <Res
                      label="Mom. 1M"
                      value={(iv.momentumMonthly >= 0 ? '+' : '') + iv.momentumMonthly.toFixed(2) + '%'}
                      color={iv.momentumMonthly >= 0 ? 'text-sky-400' : 'text-red-400'}
                    />
                  )}

                  {activeTools.spyRatio && (
                    <div className="min-w-0 self-end">
                      <p className="text-[10px] text-slate-400/80 whitespace-nowrap">
                        vs SPY · benchmark line drawn on the chart
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Statistics — collapsed by default ───────────────────── */}
              <div>
                <button
                  onClick={() => setStatsOpen(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <ChevronDown
                    size={10}
                    className={clsx('transition-transform duration-150', statsOpen && 'rotate-180')}
                  />
                  Statistics
                </button>
                {statsOpen && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1.5 mt-1.5 pt-1.5 border-t border-border/30">
                    <MiniStat label="Mean"     value={stats.avg.toFixed(decimals)} />
                    <MiniStat label="Std Dev"  value={stats.stdDev.toFixed(decimals)} />
                    <MiniStat label="Low"      value={stats.min.toFixed(decimals)} />
                    <MiniStat label="High"     value={stats.max.toFixed(decimals)} />
                    {stats.annualVol != null && (
                      <MiniStat label="Ann. Vol" value={`${stats.annualVol.toFixed(1)}%`} />
                    )}
                    <MiniStat label="Max DD" value={`-${(stats.maxDrawdown * 100).toFixed(1)}%`} color="text-down-text" />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Divider() {
  return <span className="w-px h-4 bg-border/50 mx-0.5 self-center shrink-0" />;
}

const COLOR_MAP = {
  amber:  { border: 'border-amber-400/60',  bg: 'bg-amber-400/10',  text: 'text-amber-400'  },
  sky:    { border: 'border-sky-400/60',    bg: 'bg-sky-400/10',    text: 'text-sky-400'    },
  violet: { border: 'border-violet-400/60', bg: 'bg-violet-400/10', text: 'text-violet-400' },
  orange: { border: 'border-orange-400/60', bg: 'bg-orange-400/10', text: 'text-orange-400' },
  purple: { border: 'border-purple-400/60', bg: 'bg-purple-400/10', text: 'text-purple-400' },
  indigo: { border: 'border-indigo-400/60', bg: 'bg-indigo-400/10', text: 'text-indigo-400' },
  green:  { border: 'border-emerald-400/60',bg: 'bg-emerald-400/10',text: 'text-emerald-400'},
  cyan:   { border: 'border-cyan-400/60',   bg: 'bg-cyan-400/10',   text: 'text-cyan-400'   },
  rose:   { border: 'border-rose-400/60',   bg: 'bg-rose-400/10',   text: 'text-rose-400'   },
  teal:   { border: 'border-teal-400/60',   bg: 'bg-teal-400/10',   text: 'text-teal-400'   },
  yellow: { border: 'border-yellow-400/60', bg: 'bg-yellow-400/10', text: 'text-yellow-400' },
  slate:  { border: 'border-slate-300/60',  bg: 'bg-slate-300/10',  text: 'text-slate-300'  },
} as const;

type ColorKey = keyof typeof COLOR_MAP;

function ToolChip({
  active, onToggle, label, color, disabled = false, title,
}: {
  active: boolean; onToggle: () => void;
  label: string; color: ColorKey; disabled?: boolean; title?: string;
}) {
  const c = COLOR_MAP[color];
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      title={title}
      className={clsx(
        'px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-all whitespace-nowrap',
        disabled
          ? 'border-dashed border-border text-gray-500 opacity-70 cursor-not-allowed'
          : active
            ? `${c.bg} ${c.border} ${c.text}`
            : 'border-border text-gray-500 hover:text-gray-300 hover:border-border-light',
      )}
    >
      {label}
    </button>
  );
}

/** Result value shown below the chip row when a tool is active. */
function Res({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-gray-600 whitespace-nowrap">{label}</p>
      <p className={clsx('text-xs font-mono font-semibold tabular-nums', color)}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-600">{label}</p>
      <p className={clsx('text-xs font-mono font-semibold tabular-nums', color ?? 'text-gray-300')}>{value}</p>
    </div>
  );
}
