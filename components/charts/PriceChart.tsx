'use client';

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
  LineChart, BarChart, Bar, Cell,
} from 'recharts';
import { HistoricalPoint } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore } from '@/lib/useChartDragSelect';
import { spyBenchmarkSeries } from '@/lib/utils';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  computeBollingerBands, computeFibLevels,
} from '@/lib/indicators';

interface ToolsOverlay {
  avg?: boolean;
  stdDev?: boolean;
  minMax?: boolean;
  sma20?: boolean;
  sma50?: boolean;
  sma200?: boolean;
  ema20?: boolean;
  bollinger?: boolean;
  fib?: boolean;
  rsi?: boolean;
  macd?: boolean;
  spyRatio?: boolean;
}

interface Props {
  data: HistoricalPoint[];
  color?: string;
  showAverage?: boolean;
  averageValue?: number;
  height?: number;
  label?: string;
  isCurrency?: boolean;
  interpolationType?: 'monotone' | 'stepAfter';
  enableDragSelect?: boolean;
  toolsOverlay?: ToolsOverlay;
  /** Called when the user clicks "Set as period" on the drag-select banner. */
  onSetRange?: (from: string, to: string) => void;
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

// ── Oscillator sub-charts ────────────────────────────────────────────────────

function RSISubChart({ data }: { data: { date: string; rsi: number | null }[] }) {
  const valid = data.filter(d => d.rsi != null);
  if (valid.length === 0) {
    return <div className="text-[10px] text-gray-600 py-1">RSI: not enough data</div>;
  }
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 mb-0.5 px-1">
        <span className="text-[10px] text-indigo-400 font-semibold">RSI 14</span>
        <span className="text-[9px] text-gray-600">
          <span className="text-red-400">▬</span> Overbought (70) &nbsp;
          <span className="text-emerald-400">▬</span> Oversold (30)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
          <YAxis domain={[0, 100]} ticks={[30, 50, 70]}
            tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
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

function MACDSubChart({ data }: {
  data: { date: string; macd: number | null; signal: number | null; hist: number | null }[];
}) {
  const valid = data.filter(d => d.hist != null);
  if (valid.length === 0) {
    return <div className="text-[10px] text-gray-600 py-1">MACD: not enough data (need ≥34 pts)</div>;
  }
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 mb-0.5 px-1">
        <span className="text-[10px] text-blue-400 font-semibold">MACD (12, 26, 9)</span>
        <span className="text-[9px] text-gray-600">
          <span className="text-blue-400">▬</span> MACD &nbsp;
          <span className="text-orange-400">╌</span> Signal &nbsp;
          <span className="text-emerald-400">▮</span>/<span className="text-red-400">▮</span> Histogram
        </span>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <ComposedChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={36}
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

// ── Main PriceChart ──────────────────────────────────────────────────────────

export function PriceChart({
  data, color = '#6366f1', showAverage = false, averageValue,
  height = 220, isCurrency = false, interpolationType = 'monotone',
  enableDragSelect = true, toolsOverlay, onSetRange,
}: Props) {
  const { handlers, range, area, clear } = useChartDragSelect();

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

  // Tool overlay computations (level overlays on main chart)
  const toolAvg = closes.length > 0 ? closes.reduce((s, v) => s + v, 0) / closes.length : null;
  const toolVariance = toolAvg != null && closes.length > 1
    ? closes.reduce((s, v) => s + (v - toolAvg) ** 2, 0) / closes.length
    : null;
  const toolStdDev = toolVariance != null ? Math.sqrt(toolVariance) : null;

  // Moving-average / band / level series
  const sma20Vals  = toolsOverlay?.sma20  ? computeSMA(closes, 20)  : null;
  const sma50Vals  = toolsOverlay?.sma50  ? computeSMA(closes, 50)  : null;
  const sma200Vals = toolsOverlay?.sma200 ? computeSMA(closes, 200) : null;
  const ema20Vals  = toolsOverlay?.ema20  ? computeEMA(closes, 20)  : null;
  const bands      = toolsOverlay?.bollinger ? computeBollingerBands(closes, 20, 2) : null;
  const fibLevels  = toolsOverlay?.fib ? computeFibLevels(closes) : null;

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
  const dataRange = domMax - domMin;
  const pad = Math.max(dataRange * 0.08, Math.abs(domMax) * 0.02, 0.001);
  const yMin = domMin >= 0 ? Math.max(0, domMin - pad) : domMin - pad;
  const yMax = domMax + pad;

  // Extend data with overlay columns (SMA/EMA lines + Bollinger band range + SPY)
  const hasSeriesOverlay = sma20Vals || sma50Vals || sma200Vals || ema20Vals || bands || spyLine;
  const chartData = hasSeriesOverlay
    ? data.map((d, i) => ({
        ...d,
        sma20:  sma20Vals?.[i]  ?? null,
        sma50:  sma50Vals?.[i]  ?? null,
        sma200: sma200Vals?.[i] ?? null,
        ema20:  ema20Vals?.[i]  ?? null,
        spy:    spyLine?.[i]    ?? null,
        bbRange: bands && bands.lower[i] != null && bands.upper[i] != null
          ? [bands.lower[i] as number, bands.upper[i] as number]
          : null,
      }))
    : data;

  // RSI data for sub-chart
  const rsiVals = toolsOverlay?.rsi ? computeRSI(closes) : null;
  const rsiData = rsiVals ? data.map((d, i) => ({ date: d.date, rsi: rsiVals[i] })) : null;

  // MACD data for sub-chart
  const macdResult = toolsOverlay?.macd ? computeMACD(closes) : null;
  const macdData = macdResult
    ? data.map((d, i) => ({
        date: d.date,
        macd:   macdResult.macd[i],
        signal: macdResult.signal[i],
        hist:   macdResult.hist[i],
      }))
    : null;

  // Selection stats
  let selStats: { leftVal: number; rightVal: number; pct: number } | null = null;
  if (range) {
    const lv = valueAtOrAfter(data, range.left, 'close');
    const rv = valueAtOrBefore(data, range.right, 'close');
    if (lv != null && rv != null && lv !== 0) {
      selStats = { leftVal: lv, rightVal: rv, pct: (rv - lv) / Math.abs(lv) * 100 };
    }
  }

  return (
    <div className="relative select-none">
      {range && selStats && (
        <div className="flex items-center justify-between mb-2 bg-bg-input rounded-lg px-3 py-1.5 text-xs flex-wrap gap-2">
          <span className="text-gray-400">{fmtDate(range.left)} → {fmtDate(range.right)}</span>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 tabular-nums">
              {selStats.leftVal.toFixed(decimals)} → {selStats.rightVal.toFixed(decimals)}
            </span>
            <span className={`font-bold tabular-nums ${selStats.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {selStats.pct >= 0 ? '+' : ''}{selStats.pct.toFixed(2)}%
            </span>
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
      {(toolsOverlay?.sma20 || toolsOverlay?.sma50 || toolsOverlay?.sma200 ||
        toolsOverlay?.ema20 || toolsOverlay?.bollinger || toolsOverlay?.fib ||
        spyLine) && (
        <div className="flex items-center gap-3 mb-1 px-1 flex-wrap">
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
          {toolsOverlay?.ema20 && (
            <span className="flex items-center gap-1 text-[10px] text-rose-400">
              <span className="inline-block w-5 border-t-2 border-rose-400" />EMA 20
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
              if (name === 'sma20')  return [value != null ? value.toFixed(decimals) : '—', 'SMA 20'];
              if (name === 'sma50')  return [value != null ? value.toFixed(decimals) : '—', 'SMA 50'];
              if (name === 'sma200') return [value != null ? value.toFixed(decimals) : '—', 'SMA 200'];
              if (name === 'ema20')  return [value != null ? value.toFixed(decimals) : '—', 'EMA 20'];
              if (name === 'spy')    return [value != null ? value.toFixed(decimals) : '—', 'vs SPY (benchmark)'];
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
          {/* EMA 20 */}
          {toolsOverlay?.ema20 && (
            <Line type="monotone" dataKey="ema20" stroke="#f472b6" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls={false} name="ema20" />
          )}
          {/* vs SPY benchmark */}
          {spyLine && (
            <Line type="monotone" dataKey="spy" stroke="#cbd5e1" strokeWidth={1.5}
              strokeDasharray="5 3" dot={false} activeDot={false} connectNulls name="spy" />
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
      {rsiData && <RSISubChart data={rsiData} />}
      {macdData && <MACDSubChart data={macdData} />}

      {enableDragSelect && data.length > 1 && !range && (
        <p className="text-[10px] text-gray-700 text-right mt-0.5">Click &amp; drag to measure a period</p>
      )}
    </div>
  );
}
