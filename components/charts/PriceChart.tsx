'use client';

import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
  LineChart, BarChart, Bar, Cell,
} from 'recharts';
import { HistoricalPoint } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore } from '@/lib/useChartDragSelect';
import { computeSMA, computeRSI, computeMACD } from '@/lib/indicators';

interface ToolsOverlay {
  avg?: boolean;
  stdDev?: boolean;
  minMax?: boolean;
  sma50?: boolean;
  sma200?: boolean;
  rsi?: boolean;
  macd?: boolean;
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
  enableDragSelect = true, toolsOverlay,
}: Props) {
  const { handlers, range, area, clear } = useChartDragSelect();

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
  const dataRange = rawMax - rawMin;
  const pad = Math.max(dataRange * 0.08, Math.abs(rawMax) * 0.02, 0.001);
  const yMin = rawMin >= 0 ? Math.max(0, rawMin - pad) : rawMin - pad;
  const yMax = rawMax + pad;

  // Tool overlay computations (level overlays on main chart)
  const toolAvg = closes.length > 0 ? closes.reduce((s, v) => s + v, 0) / closes.length : null;
  const toolVariance = toolAvg != null && closes.length > 1
    ? closes.reduce((s, v) => s + (v - toolAvg) ** 2, 0) / closes.length
    : null;
  const toolStdDev = toolVariance != null ? Math.sqrt(toolVariance) : null;

  // SMA series (extend data with sma50/sma200 columns)
  const sma50Vals  = toolsOverlay?.sma50  ? computeSMA(closes, 50)  : null;
  const sma200Vals = toolsOverlay?.sma200 ? computeSMA(closes, 200) : null;
  const chartData = (sma50Vals || sma200Vals)
    ? data.map((d, i) => ({
        ...d,
        sma50:  sma50Vals?.[i]  ?? null,
        sma200: sma200Vals?.[i] ?? null,
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
            <button onClick={clear} className="text-gray-600 hover:text-gray-300 text-[10px] ml-1">✕</button>
          </div>
        </div>
      )}

      {/* SMA legend when active */}
      {(toolsOverlay?.sma50 || toolsOverlay?.sma200) && (
        <div className="flex items-center gap-4 mb-1 px-1 flex-wrap">
          {toolsOverlay?.sma50 && (
            <span className="flex items-center gap-1 text-[10px] text-orange-400">
              <span className="inline-block w-5 border-t-2 border-orange-400" />
              SMA 50
            </span>
          )}
          {toolsOverlay?.sma200 && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400">
              <span className="inline-block w-5 border-t-2 border-purple-400" />
              SMA 200
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
              if (name === 'sma50')  return [value != null ? value.toFixed(decimals) : '—', 'SMA 50'];
              if (name === 'sma200') return [value != null ? value.toFixed(decimals) : '—', 'SMA 200'];
              return [value.toFixed(decimals), ''];
            }}
            labelFormatter={label => {
              try { return format(parseISO(label as string), 'MMM d, yyyy'); }
              catch { return label as string; }
            }}
          />

          {/* Price area */}
          <Area
            type={interpolationType}
            dataKey="close"
            stroke={resolvedColor}
            strokeWidth={isStep ? 1.5 : 2}
            fill={isStep ? 'none' : `url(#grad-${resolvedColor.replace('#', '')})`}
            dot={false}
            activeDot={{ r: 4, fill: resolvedColor }}
            baseValue={yMin}
            name="close"
          />

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

          {/* Level overlays */}
          {showAverage && averageValue && (
            <ReferenceLine
              y={averageValue}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: `Avg ${averageValue.toFixed(decimals)}`, fill: '#f59e0b', fontSize: 10, position: 'right' }}
            />
          )}
          {toolsOverlay?.avg && toolAvg != null && (
            <ReferenceLine y={toolAvg} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: `Avg ${toolAvg.toFixed(decimals)}`, fill: '#f59e0b', fontSize: 9, position: 'right' }} />
          )}
          {toolsOverlay?.stdDev && toolAvg != null && toolStdDev != null && (
            <>
              <ReferenceArea y1={toolAvg - toolStdDev} y2={toolAvg + toolStdDev} fill="#38bdf8" fillOpacity={0.05} />
              <ReferenceLine y={toolAvg + toolStdDev} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `+1σ ${(toolAvg + toolStdDev).toFixed(decimals)}`, fill: '#38bdf8', fontSize: 9, position: 'right' }} />
              <ReferenceLine y={toolAvg - toolStdDev} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `-1σ ${(toolAvg - toolStdDev).toFixed(decimals)}`, fill: '#38bdf8', fontSize: 9, position: 'right' }} />
            </>
          )}
          {toolsOverlay?.minMax && (
            <>
              <ReferenceLine y={rawMax} stroke="#a78bfa" strokeDasharray="2 4" strokeWidth={1}
                label={{ value: `H ${rawMax.toFixed(decimals)}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />
              <ReferenceLine y={rawMin} stroke="#a78bfa" strokeDasharray="2 4" strokeWidth={1}
                label={{ value: `L ${rawMin.toFixed(decimals)}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />
            </>
          )}

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
