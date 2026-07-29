'use client';

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
  LineChart, BarChart, Bar, Cell,
} from 'recharts';
import { HistoricalPoint } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore, rangeDurationLabel } from '@/lib/useChartDragSelect';
import { spyBenchmarkSeries } from '@/lib/utils';
import { useFullHistory } from '@/lib/useFullHistory';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  computeBollingerBands, computeFibLevels, computeMomentum,
  computeTrendLine, computeSma200wDaily, computeRsiResampledDaily, computeMacdResampledDaily,
  avgCalendarDaysPerBar, computeIndicatorPeriods,
} from '@/lib/indicators';

interface ToolsOverlay {
  avg?: boolean;
  stdDev?: boolean;
  minMax?: boolean;
  sma20?: boolean;
  sma50?: boolean;
  sma200?: boolean;
  ema20?: boolean;
  ema100?: boolean;
  bollinger?: boolean;
  fib?: boolean;
  rsi?: boolean;
  rsiWeekly?: boolean;
  rsiMonthly?: boolean;
  macd?: boolean;
  macdWeekly?: boolean;
  macdMonthly?: boolean;
  momentumDaily?: boolean;
  momentumWeekly?: boolean;
  momentumMonthly?: boolean;
  spyRatio?: boolean;
  sma200w?: boolean;
  trend?: boolean;
  /** true = fit the trend on full history (shown over the visible window); false = visible period only. */
  trendFull?: boolean;
}

interface Props {
  data: HistoricalPoint[];
  /** Symbol used to fetch full daily history (for long MAs + full-history trend on short views). */
  symbol?: string;
  color?: string;
  showAverage?: boolean;
  averageValue?: number;
  height?: number;
  label?: string;
  isCurrency?: boolean;
  interpolationType?: 'monotone' | 'stepAfter';
  enableDragSelect?: boolean;
  toolsOverlay?: ToolsOverlay;
  /** Dividend-reinvested total-return series (aligned by date to `data`). Drawn as a dashed
   *  line above the price so the cumulative (dividends-included) path is always visible. */
  totalReturnData?: HistoricalPoint[];
  /** Called when the user clicks "Set as period" on the drag-select banner. */
  onSetRange?: (from: string, to: string) => void;
  /**
   * Shared recharts sync group. Every chart given the same id moves its crosshair
   * and tooltip together, so hovering the price also reads the RSI/MACD panes
   * below it — and any sibling chart outside this component (the Quadrant view's
   * model panel) that passes the same id.
   */
  syncId?: string;
  /**
   * Shaded date ranges drawn BEHIND the price — used by the Quadrant view to light
   * up the stretches the model called one particular phase, so those periods can be
   * read on the price itself and not only on the strip below.
   */
  highlightBands?: { from: string; to: string; color: string; opacity?: number }[];
  /**
   * Height of each indicator pane the tools open. A panel that stacks several of
   * them under the price (the Quadrant view) shrinks them so the whole stack still
   * fits on one screen — with five panes at the default 80px nothing is visible
   * without scrolling, and what you cannot see you cannot compare.
   */
  subChartHeight?: number;
}

function formatDate(dateStr: string, data: HistoricalPoint[]) {
  try {
    const d = parseISO(dateStr);
    if (data.length < 2) return format(d, 'MMM d');
    const first = parseISO(data[0].date);
    const last = parseISO(data[data.length - 1].date);
    const yearSpan = (last.getTime() - first.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (yearSpan < 0.3)  return format(d, 'MMM d');
    if (yearSpan < 4)    return format(d, "MMM ''yy");
    return format(d, 'yyyy');
  } catch {
    return dateStr;
  }
}

function fmtDate(d: string) {
  try { return format(parseISO(d), 'MMM d, yyyy'); } catch { return d; }
}

// Project a full-history indicator series (dates asc) onto the visible bars: for each
// visible date take the most recent full-history value at-or-before it. O(n+m).
function projectToVisible(
  fullDates: string[], fullVals: (number | null)[], visDates: string[],
): (number | null)[] {
  const out: (number | null)[] = new Array(visDates.length).fill(null);
  let j = 0;
  let lastVal: number | null = null;
  for (let i = 0; i < visDates.length; i++) {
    const vd = visDates[i];
    while (j < fullDates.length && fullDates[j] <= vd) {
      if (fullVals[j] != null) lastVal = fullVals[j];
      j++;
    }
    out[i] = lastVal;
  }
  return out;
}

// Index (into the full history) closest at-or-after each visible date — used to evaluate a
// full-history trend line at the right x for every visible bar.
function fullIndexForVisible(fullDates: string[], visDates: string[]): number[] {
  const out = new Array(visDates.length).fill(0);
  let j = 0;
  for (let i = 0; i < visDates.length; i++) {
    while (j < fullDates.length && fullDates[j] < visDates[i]) j++;
    out[i] = Math.min(j, Math.max(fullDates.length - 1, 0));
  }
  return out;
}

// Every chart in a sync group must reserve the same y-axis width, or their plot
// areas begin at different x positions and the shared crosshair drifts between
// panes even though it is pointing at the same date.
export const SYNC_AXIS_WIDTH = 60;

// ── Oscillator sub-charts ────────────────────────────────────────────────────

function RSISubChart({ data, grain, syncId, height = 80 }: { data: { date: string; rsi: number | null }[]; grain?: string; syncId?: string; height?: number }) {
  const valid = data.filter(d => d.rsi != null);
  if (valid.length === 0) {
    return <div className="text-[10px] text-gray-600 py-1">RSI: not enough data</div>;
  }
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 mb-0.5 px-1">
        <span className="text-[10px] text-indigo-400 font-semibold capitalize">RSI 14 {grain ?? 'daily'}</span>
        <span className="text-[9px] text-gray-600">
          <span className="text-red-400">▬</span> Overbought (70) &nbsp;
          <span className="text-emerald-400">▬</span> Oversold (30)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={syncId} syncMethod="value" margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
          <YAxis domain={[0, 100]} ticks={[30, 50, 70]}
            tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={SYNC_AXIS_WIDTH} />
          <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
          <ReferenceLine y={50} stroke="#6b7280" strokeDasharray="1 4" strokeOpacity={0.35} />
          <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} />
          <Line type="monotone" dataKey="rsi" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
            formatter={(v: number) => [v != null ? `${v.toFixed(1)}` : '—', 'RSI 14']}
            labelFormatter={l => { try { return format(parseISO(l as string), 'MMM d, yyyy'); } catch { return String(l); } }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MACDSubChart({ data, grain, syncId, height = 80 }: {
  data: { date: string; macd: number | null; signal: number | null; hist: number | null }[];
  grain?: string;
  syncId?: string;
  height?: number;
}) {
  const valid = data.filter(d => d.hist != null);
  if (valid.length === 0) {
    return <div className="text-[10px] text-gray-600 py-1">MACD: not enough data (need ≥34 pts)</div>;
  }
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 mb-0.5 px-1">
        <span className="text-[10px] text-blue-400 font-semibold capitalize">MACD (12, 26, 9) {grain ?? 'daily'}</span>
        <span className="text-[9px] text-gray-600">
          <span className="text-blue-400">▬</span> MACD &nbsp;
          <span className="text-orange-400">╌</span> Signal &nbsp;
          <span className="text-emerald-400">▮</span>/<span className="text-red-400">▮</span> Histogram
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} syncId={syncId} syncMethod="value" margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={SYNC_AXIS_WIDTH}
            tickFormatter={v => (v as number).toFixed(2)} />
          <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.4} />
          <Bar dataKey="hist" name="Histogram" barSize={3}>
            {data.map((entry, i) => (
              <Cell key={i} fill={(entry.hist ?? 0) >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="macd" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls={false} name="MACD" />
          <Line type="monotone" dataKey="signal" stroke="#f97316" strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} name="Signal" />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
            formatter={(v: number, name: string) => [v != null ? v.toFixed(4) : '—', name]}
            labelFormatter={l => { try { return format(parseISO(l as string), 'MMM d, yyyy'); } catch { return String(l); } }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MomentumSubChart({
  data, label, color, syncId, height = 70,
}: {
  data: { date: string; value: number | null }[];
  label: string;
  color: string;
  syncId?: string;
  height?: number;
}) {
  const valid = data.filter(d => d.value != null);
  if (valid.length === 0) {
    return <div className="text-[10px] text-gray-600 py-1">{label}: not enough data</div>;
  }
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 mb-0.5 px-1">
        <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
        <span className="text-[9px] text-gray-600">Rate of Change — % vs N periods ago</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} syncId={syncId} syncMethod="value" margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={SYNC_AXIS_WIDTH}
            tickFormatter={v => `${(v as number).toFixed(1)}%`} />
          <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.5} />
          <Bar dataKey="value" barSize={2}>
            {data.map((entry, i) => (
              <Cell key={i} fill={(entry.value ?? 0) >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.6} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} connectNulls={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
            formatter={(v: number) => [v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—', label]}
            labelFormatter={l => { try { return format(parseISO(l as string), 'MMM d, yyyy'); } catch { return String(l); } }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main PriceChart ──────────────────────────────────────────────────────────

export function PriceChart({
  data, symbol, color = '#6366f1', showAverage = false, averageValue,
  height = 220, isCurrency = false, interpolationType = 'monotone',
  enableDragSelect = true, toolsOverlay, totalReturnData, onSetRange, syncId,
  highlightBands, subChartHeight = 80,
}: Props) {
  const { handlers, range, area, clear } = useChartDragSelect();

  // Full daily history — so every moving average and the trend line can be computed on the
  // WHOLE series and drawn even when the selected window is short (a MA is a fixed number
  // today, independent of the view period).
  const wantsFullMA = !!(toolsOverlay?.sma20 || toolsOverlay?.sma50 || toolsOverlay?.sma200 ||
    toolsOverlay?.sma200w || toolsOverlay?.ema20 || toolsOverlay?.ema100);
  const wantsFullTrend = !!(toolsOverlay?.trend && toolsOverlay?.trendFull);
  const rsiGrain = toolsOverlay?.rsiMonthly ? 'monthly' : toolsOverlay?.rsiWeekly ? 'weekly' : null;
  const macdGrain = toolsOverlay?.macdMonthly ? 'monthly' : toolsOverlay?.macdWeekly ? 'weekly' : null;
  const wantsFullRsi = !!(toolsOverlay?.rsi && rsiGrain);
  const wantsFullMacd = !!(toolsOverlay?.macd && macdGrain);
  const fullHist = useFullHistory(symbol, wantsFullMA || wantsFullTrend || wantsFullRsi || wantsFullMacd);

  // vs SPY benchmark overlay — fetched here so the tool works in every section
  // that renders a PriceChart without each one wiring up its own SPY fetch.
  const spyActive = !!toolsOverlay?.spyRatio;
  const fromDate = data?.[0]?.date;
  const toDate = data && data.length > 0 ? data[data.length - 1].date : undefined;
  const [spyData, setSpyData] = useState<HistoricalPoint[]>([]);
  useEffect(() => {
    if (!spyActive || !fromDate || !toDate) { setSpyData([]); return; }
    let cancelled = false;
    fetch(`/api/historical?symbol=SPY&from=${fromDate}&to=${toDate}`)
      .then(r => r.json())
      .then((d: HistoricalPoint[]) => { if (!cancelled && Array.isArray(d)) setSpyData(d); })
      .catch(() => { if (!cancelled) setSpyData([]); });
    return () => { cancelled = true; };
  }, [spyActive, fromDate, toDate]);

  if (!data || data.length === 0 || !data[0]) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No data available
      </div>
    );
  }

  const isStep = interpolationType === 'stepAfter';
  const first = data[0].close;
  const last = data[data.length - 1].close;
  const chartColor = isStep ? '#6366f1' : (last >= first ? '#10b981' : '#ef4444');
  const resolvedColor = color === 'auto' ? chartColor : color;

  const decimals = isCurrency
    ? (last < 1 ? 4 : last < 10 ? 4 : 2)
    : last < 10 ? 2 : 0;

  const closes = data.map(d => d.close).filter((c): c is number => typeof c === 'number' && isFinite(c));
  const rawMin = closes.length > 0 ? Math.min(...closes) : 0;
  const rawMax = closes.length > 0 ? Math.max(...closes) : 1;

  const TODAY = new Date().toISOString().slice(0, 10);
  const hasFutureData = data.length > 0 && data[data.length - 1].date > TODAY;
  const hasNegative = closes.some(v => v < 0);
  const hasPositive = closes.some(v => v > 0);
  const needsZeroLine = hasNegative && hasPositive;

  // Dividend-reinvested total-return line (dashed), aligned by date to the price series.
  const trByDate = totalReturnData && totalReturnData.length
    ? new Map(totalReturnData.map(d => [d.date, d.close]))
    : null;
  const trLine = trByDate ? data.map(d => trByDate.get(d.date) ?? null) : null;
  // Colour the total-return line by the asset's direction over the window (like the Stock chart):
  // a lighter green when up, lighter red when down — not a fixed teal.
  const trColor = last >= first ? '#34d399' : '#f87171';

  // Tool overlay computations (level overlays on main chart)
  const toolAvg = closes.length > 0 ? closes.reduce((s, v) => s + v, 0) / closes.length : null;
  const toolVariance = toolAvg != null && closes.length > 1
    ? closes.reduce((s, v) => s + (v - toolAvg) ** 2, 0) / closes.length
    : null;
  const toolStdDev = toolVariance != null ? Math.sqrt(toolVariance) : null;

  // Scale all indicator periods to the visible data's real-world time granularity
  const P = computeIndicatorPeriods(avgCalendarDaysPerBar(data.map(d => d.date)));

  // Full-history context: closes/dates/periods for the WHOLE series (daily). Long MAs and the
  // full-history trend are computed here, then projected onto the visible bars.
  const visDates = data.map(d => d.date);
  const useFull = !!fullHist && fullHist.length > 2;
  const fullDates = useFull ? fullHist!.map(d => d.date) : [];
  const fullCloses = useFull ? fullHist!.map(d => d.close) : [];
  const PFull = useFull ? computeIndicatorPeriods(avgCalendarDaysPerBar(fullDates)) : P;

  // Long MA on full history (drawn on short windows too) with graceful fallback to the visible
  // window when full history hasn't loaded yet.
  const fullSMA = (period: number) => projectToVisible(fullDates, computeSMA(fullCloses, period), visDates);
  const fullEMA = (period: number) => projectToVisible(fullDates, computeEMA(fullCloses, period), visDates);

  // Moving-average / band / level series — all computed on the full history (projected onto the
  // visible bars) when it's loaded, with a graceful fallback to the visible window otherwise.
  const sma20Vals   = toolsOverlay?.sma20
    ? (useFull && PFull.sma20.ok    ? fullSMA(PFull.sma20.period)   : (P.sma20.ok   ? computeSMA(closes, P.sma20.period)   : null))
    : null;
  const sma50Vals   = toolsOverlay?.sma50
    ? (useFull && PFull.sma50.ok   ? fullSMA(PFull.sma50.period)   : (P.sma50.ok   ? computeSMA(closes, P.sma50.period)   : null))
    : null;
  const sma200Vals  = toolsOverlay?.sma200
    ? (useFull && PFull.sma200.ok  ? fullSMA(PFull.sma200.period)  : (P.sma200.ok  ? computeSMA(closes, P.sma200.period)  : null))
    : null;
  const sma200wVals = toolsOverlay?.sma200w
    ? (useFull
        ? projectToVisible(fullDates, computeSma200wDaily(fullDates, fullCloses), visDates)
        : computeSma200wDaily(data.map(d => d.date), data.map(d => d.close)))
    : null;
  const ema20Vals   = toolsOverlay?.ema20
    ? (useFull && PFull.ema20.ok    ? fullEMA(PFull.ema20.period)   : (P.ema20.ok   ? computeEMA(closes, P.ema20.period)   : null))
    : null;
  const ema100Vals  = toolsOverlay?.ema100
    ? (useFull && PFull.ema100.ok  ? fullEMA(PFull.ema100.period)  : (P.ema100.ok  ? computeEMA(closes, P.ema100.period)  : null))
    : null;
  const bands       = toolsOverlay?.bollinger && P.boll.ok  ? computeBollingerBands(closes, P.boll.period, 2) : null;
  const fibLevels   = toolsOverlay?.fib ? computeFibLevels(closes) : null;

  // Trend line (OLS linear regression of close on bar index). Fit on the full history and
  // evaluated at each visible bar's index, or fit on the visible window only — per trendFull.
  // Coloured green when rising (slope ≥ 0), red when falling.
  let trendVals: (number | null)[] | null = null;
  let trendUp = true;
  if (toolsOverlay?.trend) {
    if (toolsOverlay.trendFull && useFull) {
      const fit = computeTrendLine(fullCloses);
      if (fit) {
        const idx = fullIndexForVisible(fullDates, visDates);
        trendVals = data.map((_, i) => fit.intercept + fit.slope * idx[i]);
        trendUp = fit.slope >= 0;
      }
    } else {
      const fit = computeTrendLine(data.map(d => d.close));
      if (fit) { trendVals = data.map((_, i) => fit.intercept + fit.slope * i); trendUp = fit.slope >= 0; }
    }
  }
  const trendColor = trendUp ? '#10b981' : '#ef4444';

  // vs SPY benchmark line — rebased to the asset's first price.
  const spyLine = spyActive && spyData.length > 0
    ? spyBenchmarkSeries(data, spyData)
    : null;

  // Y-axis domain — closes drive it; Bollinger bands + SPY line can extend
  // past the close range.
  let domMin = rawMin, domMax = rawMax;
  if (bands) {
    for (const v of bands.upper) if (v != null && v > domMax) domMax = v;
    for (const v of bands.lower) if (v != null && v < domMin) domMin = v;
  }
  if (spyLine) {
    for (const v of spyLine) {
      if (v == null) continue;
      if (v > domMax) domMax = v;
      if (v < domMin) domMin = v;
    }
  }
  if (trendVals) {
    for (const v of trendVals) {
      if (v == null) continue;
      if (v > domMax) domMax = v;
      if (v < domMin) domMin = v;
    }
  }
  if (trLine) {
    for (const v of trLine) { if (v != null && v > domMax) domMax = v; }
  }
  const dataRange = domMax - domMin;
  const pad = Math.max(dataRange * 0.08, Math.abs(domMax) * 0.02, 0.001);
  const yMin = domMin >= 0 ? Math.max(0, domMin - pad) : domMin - pad;
  const yMax = domMax + pad;

  // Extend data with overlay columns (SMA/EMA lines + Bollinger band range + SPY + trend + TR)
  const hasSeriesOverlay = sma20Vals || sma50Vals || sma200Vals || sma200wVals || ema20Vals || ema100Vals || bands || spyLine || trendVals || trLine;
  const chartData = hasSeriesOverlay
    ? data.map((d, i) => ({
        ...d,
        sma20:   sma20Vals?.[i]   ?? null,
        sma50:   sma50Vals?.[i]   ?? null,
        sma200:  sma200Vals?.[i]  ?? null,
        sma200w: sma200wVals?.[i] ?? null,
        ema20:   ema20Vals?.[i]   ?? null,
        ema100:  ema100Vals?.[i]  ?? null,
        spy:    spyLine?.[i]     ?? null,
        trend:  trendVals?.[i]   ?? null,
        tr:     trLine?.[i]      ?? null,
        bbRange: bands && bands.lower[i] != null && bands.upper[i] != null
          ? [bands.lower[i] as number, bands.upper[i] as number]
          : null,
      }))
    : data;

  // RSI data for sub-chart — daily, or weekly/monthly (on resampled closes from full history).
  const rsiVals = toolsOverlay?.rsi
    ? (rsiGrain
        ? (useFull ? projectToVisible(fullDates, computeRsiResampledDaily(fullDates, fullCloses, rsiGrain, 14), visDates) : null)
        : (P.rsi.ok ? computeRSI(closes, P.rsi.period) : null))
    : null;
  const rsiData = rsiVals ? data.map((d, i) => ({ date: d.date, rsi: rsiVals[i] })) : null;

  // MACD data for sub-chart — daily, or weekly/monthly (on resampled closes from full history).
  const macdResult = toolsOverlay?.macd
    ? (macdGrain
        ? (useFull ? (() => {
            const w = computeMacdResampledDaily(fullDates, fullCloses, macdGrain);
            return {
              macd:   projectToVisible(fullDates, w.macd, visDates),
              signal: projectToVisible(fullDates, w.signal, visDates),
              hist:   projectToVisible(fullDates, w.hist, visDates),
            };
          })() : null)
        : (P.macdSlow.ok ? computeMACD(closes, P.macdFast.period, P.macdSlow.period, P.macdSig.period) : null))
    : null;
  const macdData = macdResult
    ? data.map((d, i) => ({
        date: d.date,
        macd:   macdResult.macd[i],
        signal: macdResult.signal[i],
        hist:   macdResult.hist[i],
      }))
    : null;

  // Momentum sub-charts (periods scaled to data granularity)
  const momDailyVals   = toolsOverlay?.momentumDaily   ? computeMomentum(closes, 1)                  : null;
  const momWeeklyVals  = toolsOverlay?.momentumWeekly  ? computeMomentum(closes, P.momWeek.period)  : null;
  const momMonthlyVals = toolsOverlay?.momentumMonthly ? computeMomentum(closes, P.momMonth.period) : null;
  const momDailyData   = momDailyVals   ? data.map((d, i) => ({ date: d.date, value: momDailyVals[i]   })) : null;
  const momWeeklyData  = momWeeklyVals  ? data.map((d, i) => ({ date: d.date, value: momWeeklyVals[i]  })) : null;
  const momMonthlyData = momMonthlyVals ? data.map((d, i) => ({ date: d.date, value: momMonthlyVals[i] })) : null;

  // Selection stats — period return, annualised CAGR, and (when the total-return
  // series carries dividends paid in the window) the dividend-inclusive IRR.
  let selStats: { leftVal: number; rightVal: number; pct: number; cagr: number | null; irr: number | null } | null = null;
  if (range) {
    const lv = valueAtOrAfter(data, range.left, 'close');
    const rv = valueAtOrBefore(data, range.right, 'close');
    if (lv != null && rv != null && lv !== 0) {
      const years = Math.max(0, (new Date(range.right).getTime() - new Date(range.left).getTime()) / (365.25 * 86_400_000));
      // Annualize ONLY for windows ≥ 1 year (same rule as calculateCAGR). Raising a
      // 10-day move to the power 36.5 produced absurd "+500% CAGR" readings.
      const cagr = years >= 1 && lv > 0 && rv > 0 ? (Math.pow(rv / lv, 1 / years) - 1) * 100 : null;
      // IRR ≈ CAGR of the dividend-reinvested total-return path over the same window;
      // annualized, so likewise only meaningful for ≥ 1-year windows.
      let irr: number | null = null;
      if (trByDate && years >= 1) {
        const tl = valueAtOrAfter(data.map(d => ({ date: d.date, close: trByDate.get(d.date) ?? NaN })).filter(d => isFinite(d.close)), range.left, 'close');
        const tr = valueAtOrBefore(data.map(d => ({ date: d.date, close: trByDate.get(d.date) ?? NaN })).filter(d => isFinite(d.close)), range.right, 'close');
        if (tl != null && tr != null && tl > 0 && tr > 0) {
          const trCagr = (Math.pow(tr / tl, 1 / years) - 1) * 100;
          if (cagr != null && Math.abs(trCagr - cagr) > 0.05) irr = trCagr;
        }
      }
      selStats = { leftVal: lv, rightVal: rv, pct: (rv - lv) / Math.abs(lv) * 100, cagr, irr };
    }
  }

  return (
    <div className="relative select-none">
      {range && selStats && (
        <div className="flex items-center justify-between mb-2 bg-bg-input rounded-lg px-3 py-1.5 text-xs flex-wrap gap-2">
          <span className="text-gray-400 flex items-center gap-2">
            {fmtDate(range.left)} → {fmtDate(range.right)}
            <span className="text-gray-500 border-l border-border pl-2">{rangeDurationLabel(range.left, range.right)}</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 tabular-nums">
              {selStats.leftVal.toFixed(decimals)} → {selStats.rightVal.toFixed(decimals)}
            </span>
            <div className="flex flex-col items-end leading-tight">
              <span className={`font-bold tabular-nums ${selStats.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {selStats.pct >= 0 ? '+' : ''}{selStats.pct.toFixed(2)}%
              </span>
              {(selStats.cagr != null || selStats.irr != null) && (
                <span className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                  {selStats.cagr != null && (
                    <span title="Annualised return (CAGR) over the highlighted period">
                      CAGR {selStats.cagr >= 0 ? '+' : ''}{selStats.cagr.toFixed(1)}%
                    </span>
                  )}
                  {selStats.irr != null && (
                    <span className="text-sky-400" title="Dividend-inclusive annualised return (IRR) — dividends paid in this window, reinvested">
                      {selStats.cagr != null ? ' · ' : ''}IRR {selStats.irr >= 0 ? '+' : ''}{selStats.irr.toFixed(1)}%
                    </span>
                  )}
                </span>
              )}
            </div>
            {onSetRange && (
              <button
                onClick={() => { onSetRange(range.left, range.right); clear(); }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
              >
                Set period
              </button>
            )}
            <button onClick={clear} className="text-gray-600 hover:text-gray-300 text-[10px] ml-1">✕</button>
          </div>
        </div>
      )}

      {/* Overlay legend when active */}
      {(toolsOverlay?.sma20 || toolsOverlay?.sma50 || toolsOverlay?.sma200 || toolsOverlay?.sma200w ||
        toolsOverlay?.ema20 || toolsOverlay?.ema100 || toolsOverlay?.bollinger || toolsOverlay?.fib ||
        spyLine || trendVals || trLine) && (
        <div className="flex items-center gap-3 mb-1 px-1 flex-wrap">
          {trLine && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: trColor }}>
              <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: trColor }} />
              Total Return (div. reinvested)
            </span>
          )}
          {trendVals && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: trendColor }}>
              <span className="inline-block w-5 border-t-2" style={{ borderColor: trendColor }} />
              Trend ({toolsOverlay?.trendFull ? 'full history' : 'visible'})
            </span>
          )}
          {spyLine && (
            <span className="flex items-center gap-1 text-[10px] text-slate-300">
              <span className="inline-block w-5 border-t-2 border-dashed border-slate-300" />
              vs SPY (benchmark)
            </span>
          )}
          {toolsOverlay?.sma20 && (
            <span className="flex items-center gap-1 text-[10px] text-cyan-400">
              <span className="inline-block w-5 border-t-2 border-cyan-400" />SMA 20
            </span>
          )}
          {toolsOverlay?.sma50 && (
            <span className="flex items-center gap-1 text-[10px] text-orange-400">
              <span className="inline-block w-5 border-t-2 border-orange-400" />SMA 50
            </span>
          )}
          {toolsOverlay?.sma200 && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400">
              <span className="inline-block w-5 border-t-2 border-purple-400" />SMA 200
            </span>
          )}
          {toolsOverlay?.sma200w && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-500">
              <span className="inline-block w-5 border-t-2 border-yellow-500" />SMA 200W
            </span>
          )}
          {toolsOverlay?.ema20 && (
            <span className="flex items-center gap-1 text-[10px] text-rose-400">
              <span className="inline-block w-5 border-t-2 border-rose-400" />EMA 20
            </span>
          )}
          {toolsOverlay?.ema100 && (
            <span className="flex items-center gap-1 text-[10px] text-pink-400">
              <span className="inline-block w-5 border-t-2 border-pink-400" />EMA 100
            </span>
          )}
          {toolsOverlay?.bollinger && (
            <span className="flex items-center gap-1 text-[10px] text-teal-400">
              <span className="inline-block w-5 h-2 bg-teal-400/20 border-y border-teal-400" />Bollinger 20·2σ
            </span>
          )}
          {toolsOverlay?.fib && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400">
              <span className="inline-block w-5 border-t-2 border-dashed border-yellow-400" />Fibonacci
            </span>
          )}
          {toolsOverlay?.sma50 && toolsOverlay?.sma200 && (
            <span className="text-[9px] text-gray-600">Golden Cross when SMA 50 crosses SMA 200</span>
          )}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          syncId={syncId} syncMethod="value"
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          {...(enableDragSelect ? handlers : {})}
          style={{ cursor: enableDragSelect ? 'crosshair' : 'default' }}
        >
          <defs>
            <linearGradient id={`grad-${resolvedColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={resolvedColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={resolvedColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={d => formatDate(d as string, data)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={60}
            tickFormatter={v => {
              const n = v as number;
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
              return n.toFixed(decimals);
            }}
            domain={[yMin, yMax]}
            allowDataOverflow={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1d2e',
              border: '1px solid #252840',
              borderRadius: '8px',
              color: '#e2e8f0',
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              if (name === 'sma20')   return [value != null ? value.toFixed(decimals) : '—', 'SMA 20'];
              if (name === 'sma50')   return [value != null ? value.toFixed(decimals) : '—', 'SMA 50'];
              if (name === 'sma200')  return [value != null ? value.toFixed(decimals) : '—', 'SMA 200'];
              if (name === 'sma200w') return [value != null ? value.toFixed(decimals) : '—', 'SMA 200W'];
              if (name === 'ema20')  return [value != null ? value.toFixed(decimals) : '—', 'EMA 20'];
              if (name === 'ema100') return [value != null ? value.toFixed(decimals) : '—', 'EMA 100'];
              if (name === 'spy')    return [value != null ? value.toFixed(decimals) : '—', 'vs SPY (benchmark)'];
              if (name === 'trend')  return [value != null ? value.toFixed(decimals) : '—', 'Trend'];
              if (name === 'tr')     return [value != null ? value.toFixed(decimals) : '—', 'Total Return (div. reinvested)'];
              if (name === 'bbRange') {
                const r = value as unknown as [number, number] | null;
                return [r ? `${r[0].toFixed(decimals)} – ${r[1].toFixed(decimals)}` : '—', 'Bollinger'];
              }
              return [value.toFixed(decimals), ''];
            }}
            labelFormatter={label => {
              try { return format(parseISO(label as string), 'MMM d, yyyy'); }
              catch { return label as string; }
            }}
          />

          {/* Caller-supplied period highlights — first child inside the plot area so
              they sit BEHIND every series. */}
          {highlightBands?.map((b, i) => (
            <ReferenceArea
              key={`hl-${i}-${b.from}`} x1={b.from} x2={b.to}
              fill={b.color} fillOpacity={b.opacity ?? 0.16} stroke="none"
            />
          ))}

          {/* Bollinger band (drawn under the price line) */}
          {toolsOverlay?.bollinger && (
            <Area
              type="monotone"
              dataKey="bbRange"
              stroke="#2dd4bf"
              strokeWidth={1}
              strokeOpacity={0.7}
              fill="#14b8a6"
              fillOpacity={0.08}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
              name="bbRange"
            />
          )}

          {/* Price area — when data crosses zero, anchor fill at 0 so the
              negative region fills "upward" (oscillator style) making it clearly
              visible; otherwise anchor at chart bottom (yMin). */}
          <Area
            type={interpolationType}
            dataKey="close"
            stroke={resolvedColor}
            strokeWidth={isStep ? 1.5 : 2}
            fill={isStep ? 'none' : needsZeroLine ? resolvedColor : `url(#grad-${resolvedColor.replace('#', '')})`}
            fillOpacity={isStep ? 0 : needsZeroLine ? 0.15 : 1}
            dot={false}
            activeDot={{ r: 4, fill: resolvedColor }}
            baseValue={needsZeroLine ? 0 : yMin}
            name="close"
          />

          {/* SMA 20 */}
          {toolsOverlay?.sma20 && (
            <Line type="monotone" dataKey="sma20" stroke="#22d3ee" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls={false} name="sma20" />
          )}
          {/* SMA 50 */}
          {toolsOverlay?.sma50 && (
            <Line type="monotone" dataKey="sma50" stroke="#f97316" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls={false} name="sma50" />
          )}
          {/* SMA 200 */}
          {toolsOverlay?.sma200 && (
            <Line type="monotone" dataKey="sma200" stroke="#a855f7" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls={false} name="sma200" />
          )}
          {/* SMA 200W — 200-week ≈ 1000 trading days */}
          {toolsOverlay?.sma200w && (
            <Line type="monotone" dataKey="sma200w" stroke="#d97706" strokeWidth={2}
              dot={false} activeDot={false} connectNulls={false} name="sma200w" />
          )}
          {/* EMA 20 */}
          {toolsOverlay?.ema20 && (
            <Line type="monotone" dataKey="ema20" stroke="#f472b6" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls={false} name="ema20" />
          )}
          {/* EMA 100 */}
          {toolsOverlay?.ema100 && (
            <Line type="monotone" dataKey="ema100" stroke="#ec4899" strokeWidth={1.5}
              strokeDasharray="6 3" dot={false} activeDot={false} connectNulls={false} name="ema100" />
          )}
          {/* vs SPY benchmark */}
          {spyLine && (
            <Line type="monotone" dataKey="spy" stroke="#cbd5e1" strokeWidth={1.5}
              strokeDasharray="5 3" dot={false} activeDot={false} connectNulls name="spy" />
          )}
          {/* Trend line (linear regression) — green if rising, red if falling */}
          {trendVals && (
            <Line type="linear" dataKey="trend" stroke={trendColor} strokeWidth={2}
              dot={false} activeDot={false} connectNulls name="trend" />
          )}
          {/* Total-return (dividends reinvested) — dashed line above the price, coloured by direction */}
          {trLine && (
            <Line type={interpolationType} dataKey="tr" stroke={trColor} strokeWidth={1.5}
              strokeDasharray="5 3" dot={false} activeDot={false} connectNulls name="tr" />
          )}

          {/* Level overlays */}
          {showAverage && averageValue && (
            <ReferenceLine
              y={averageValue}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: `Avg ${averageValue.toFixed(decimals)}`, fill: '#f59e0b', fontSize: 10, position: 'right' }}
            />
          )}
          {needsZeroLine && (
            <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 2" strokeWidth={1.5}
              label={{ value: '0%', fill: '#9ca3af', fontSize: 9, position: 'right' }} />
          )}
          {hasFutureData && (
            <ReferenceLine x={TODAY} stroke="#6b7280" strokeWidth={1.5} strokeDasharray="5 3"
              label={{ value: 'Today', fill: '#9ca3af', fontSize: 9, position: 'insideTopLeft' }} />
          )}
          {toolsOverlay?.avg && toolAvg != null && (
            <ReferenceLine y={toolAvg} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: `Avg ${toolAvg.toFixed(decimals)}`, fill: '#f59e0b', fontSize: 9, position: 'right' }} />
          )}
          {/* Arrays (not Fragments) — Recharts only detects reference
              components as direct children or flattened array entries. */}
          {toolsOverlay?.stdDev && toolAvg != null && toolStdDev != null && [
            <ReferenceArea key="sd-band" y1={toolAvg - toolStdDev} y2={toolAvg + toolStdDev}
              fill="#38bdf8" fillOpacity={0.05} />,
            <ReferenceLine key="sd-up" y={toolAvg + toolStdDev} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1}
              label={{ value: `+1σ ${(toolAvg + toolStdDev).toFixed(decimals)}`, fill: '#38bdf8', fontSize: 9, position: 'right' }} />,
            <ReferenceLine key="sd-dn" y={toolAvg - toolStdDev} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1}
              label={{ value: `-1σ ${(toolAvg - toolStdDev).toFixed(decimals)}`, fill: '#38bdf8', fontSize: 9, position: 'right' }} />,
          ]}
          {toolsOverlay?.minMax && [
            <ReferenceLine key="mm-h" y={rawMax} stroke="#a78bfa" strokeDasharray="2 4" strokeWidth={1}
              label={{ value: `H ${rawMax.toFixed(decimals)}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />,
            <ReferenceLine key="mm-l" y={rawMin} stroke="#a78bfa" strokeDasharray="2 4" strokeWidth={1}
              label={{ value: `L ${rawMin.toFixed(decimals)}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />,
          ]}
          {/* Fibonacci retracement levels */}
          {fibLevels && fibLevels.map(lvl => (
            <ReferenceLine key={lvl.ratio} y={lvl.value} stroke="#eab308"
              strokeDasharray="2 4" strokeWidth={1} strokeOpacity={0.75}
              label={{
                value: `${(lvl.ratio * 100).toFixed(1)}% · ${lvl.value.toFixed(decimals)}`,
                fill: '#eab308', fontSize: 9, position: 'insideLeft',
              }} />
          ))}

          {/* Drag-select highlight */}
          {enableDragSelect && area && (
            <ReferenceArea
              x1={area.left}
              x2={area.right}
              fill="#6366f1"
              fillOpacity={0.15}
              stroke="#6366f1"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Oscillator sub-charts */}
      {rsiData && <RSISubChart data={rsiData} grain={rsiGrain ?? 'daily'} syncId={syncId} height={subChartHeight} />}
      {macdData && <MACDSubChart data={macdData} grain={macdGrain ?? 'daily'} syncId={syncId} height={subChartHeight} />}
      {momDailyData   && <MomentumSubChart syncId={syncId} height={subChartHeight} data={momDailyData}   label="Momentum Daily (ROC 1)"   color="#38bdf8" />}
      {momWeeklyData  && <MomentumSubChart syncId={syncId} height={subChartHeight} data={momWeeklyData}  label="Momentum Weekly (ROC 5)"  color="#38bdf8" />}
      {momMonthlyData && <MomentumSubChart syncId={syncId} height={subChartHeight} data={momMonthlyData} label="Momentum Monthly (ROC 21)" color="#38bdf8" />}

      {enableDragSelect && data.length > 1 && !range && (
        <p className="text-[10px] text-gray-700 text-right mt-0.5" data-print-hide>Click &amp; drag to measure a period</p>
      )}
    </div>
  );
}
