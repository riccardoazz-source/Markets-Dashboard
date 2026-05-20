'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceArea,
} from 'recharts';
import { CompareAsset } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore } from '@/lib/useChartDragSelect';

interface Props {
  assets: CompareAsset[];
  height?: number;
  logScale?: boolean;
  normalized?: boolean;
}

function formatDate(dateStr: string, allDates: string[]) {
  try {
    const d = parseISO(dateStr);
    if (allDates.length < 2) return format(d, 'MMM d');
    const first = parseISO(allDates[0]);
    const last = parseISO(allDates[allDates.length - 1]);
    const yearSpan = (last.getTime() - first.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (yearSpan < 0.3) return format(d, 'MMM d');
    if (yearSpan < 4)   return format(d, "MMM ''yy");
    return format(d, 'yyyy');
  } catch { return dateStr; }
}

function fmtDate(d: string) {
  try { return format(parseISO(d), 'MMM d, yyyy'); } catch { return d; }
}

const tickFmt = (v: number) => {
  const n = v as number;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return n % 1000 === 0 ? `${n / 1000}k` : `${(n / 1000).toFixed(1)}k`;
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
};

type AxisGroup = 'left' | 'right' | 'right2';

const LOG_TICKS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

// Min/max of every value plotted for a group of assets (price + optional TR).
function groupRange(group: CompareAsset[]): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  group.forEach(a => {
    [...a.data, ...(a.trData ?? [])].forEach(d => {
      if (d.close > 0 && isFinite(d.close)) {
        lo = Math.min(lo, d.close);
        hi = Math.max(hi, d.close);
      }
    });
  });
  return { lo, hi };
}

// Axis that scales to its own data range, with a little padding.
function naturalDomain(group: CompareAsset[], logScale: boolean): object {
  const { lo, hi } = groupRange(group);
  if (!isFinite(lo) || !isFinite(hi) || lo <= 0 || hi <= lo) {
    return { domain: ['auto', 'auto'] as [string, string] };
  }
  if (logScale) {
    const dLo = Math.max(lo * 0.9, 0.1);
    const dHi = hi * 1.1;
    const ticks = LOG_TICKS.filter(c => c >= dLo && c <= dHi);
    return {
      scale: 'log' as const,
      domain: [dLo, dHi] as [number, number],
      allowDataOverflow: false,
      ticks: ticks.length >= 2 ? ticks : undefined,
    };
  }
  const pad = (hi - lo) * 0.08;
  return { domain: [Math.max(lo - pad, 0), hi + pad] as [number, number] };
}

// Secondary axis: scales to its own data but shifts the domain so `alignValue`
// sits at the same visual fraction `f` as the primary (left) axis — keeping the
// normalized base-100 start point at one shared height across every axis.
function alignedDomain(group: CompareAsset[], logScale: boolean, alignValue: number, f: number): object {
  const { lo, hi } = groupRange(group);
  if (!isFinite(lo) || !isFinite(hi) || lo <= 0 || hi <= lo || f <= 0 || f >= 1) {
    return naturalDomain(group, logScale);
  }
  if (logScale) {
    const lLo = Math.log(Math.max(lo * 0.9, 0.1));
    const lHi = Math.log(hi * 1.1);
    const lVal = Math.log(alignValue);
    // Smallest log-span that contains [lLo,lHi] with alignValue at fraction f.
    const span = Math.max((lVal - lLo) / f, (lHi - lVal) / (1 - f), 1e-6);
    const dLo = Math.exp(lVal - f * span);
    const dHi = Math.exp(lVal + (1 - f) * span);
    if (!isFinite(dLo) || !isFinite(dHi) || dHi <= dLo) return naturalDomain(group, logScale);
    const ticks = LOG_TICKS.filter(c => c >= dLo && c <= dHi);
    return {
      scale: 'log' as const,
      domain: [dLo, dHi] as [number, number],
      allowDataOverflow: false,
      ticks: ticks.length >= 2 ? ticks : undefined,
    };
  }
  const pad = (hi - lo) * 0.08;
  const loData = Math.max(lo - pad, 0);
  const hiData = hi + pad;
  // Smallest span that contains [loData,hiData] with alignValue at fraction f.
  const span = Math.max((alignValue - loData) / f, (hiData - alignValue) / (1 - f), 1e-6);
  const dLo = alignValue - f * span;
  const dHi = alignValue + (1 - f) * span;
  if (dLo <= 0 || !isFinite(dLo) || !isFinite(dHi) || dHi <= dLo) return naturalDomain(group, logScale);
  return { domain: [dLo, dHi] as [number, number] };
}

export function CompareChart({ assets, height = 340, logScale = false, normalized = false }: Props) {
  const { handlers, range, area, clear } = useChartDragSelect();

  if (!assets.length) return null;

  const MAX_CHART_POINTS = 500;
  const rawDates = Array.from(new Set(
    assets.flatMap(a => [
      ...a.data.map(d => d.date),
      ...(a.trData ?? []).map(d => d.date),
    ])
  )).sort();
  const step = rawDates.length > MAX_CHART_POINTS
    ? Math.ceil(rawDates.length / MAX_CHART_POINTS)
    : 1;
  const allDates = step > 1
    ? rawDates.filter((_, i) => i % step === 0 || i === rawDates.length - 1)
    : rawDates;

  const assetMaps = assets.map(a => ({
    prices: new Map(a.data.map(d => [d.date, d.close])),
    tr:     a.trData ? new Map(a.trData.map(d => [d.date, d.close])) : null,
  }));

  const chartData = allDates.map(date => {
    const point: Record<string, unknown> = { date };
    assets.forEach((a, idx) => {
      const v = assetMaps[idx].prices.get(date) ?? null;
      point[a.symbol] = v != null && v > 0 && isFinite(v) ? v : null;
      if (assetMaps[idx].tr) {
        const tv = assetMaps[idx].tr!.get(date) ?? null;
        point[`${a.symbol}_tr`] = tv != null && tv > 0 && isFinite(tv) ? tv : null;
      }
    });
    return point;
  });

  // ── Y-axis grouping ───────────────────────────────────────────────────────
  // Assets are split across up to 3 Y axes so each one is readable on its own
  // scale. Grouping is by absolute price level (latest raw close), which does
  // NOT change with the selected timeframe — so the axis layout is identical
  // for 1D, 1Y, MAX and everything in between (no axes appearing only on some
  // periods). 2 assets → left + right; 3+ → left + right + right2, split at the
  // two largest multiplicative gaps in price level.
  const { axisMap, hasRightAxis, hasRight2Axis } = (() => {
    const map: Record<string, AxisGroup> = {};
    assets.forEach(a => { map[a.symbol] = 'left'; });
    if (assets.length < 2) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    const levels = assets.map(a => {
      const series = a.rawData ?? a.data;
      let level = 0;
      for (let i = series.length - 1; i >= 0; i--) {
        const c = series[i]?.close;
        if (typeof c === 'number' && isFinite(c) && c > 0) { level = c; break; }
      }
      return { symbol: a.symbol, level };
    }).filter(x => x.level > 0);

    if (levels.length < 2) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    const sorted = [...levels].sort((a, b) => a.level - b.level);

    if (sorted.length === 2) {
      map[sorted[1].symbol] = 'right';
      return { axisMap: map, hasRightAxis: true, hasRight2Axis: false };
    }

    const gaps: { idx: number; ratio: number }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push({ idx: i, ratio: sorted[i].level / sorted[i - 1].level });
    }
    const [split1, split2] = gaps
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 2)
      .map(g => g.idx)
      .sort((a, b) => a - b);

    for (let i = split1; i < split2; i++) map[sorted[i].symbol] = 'right';
    for (let i = split2; i < sorted.length; i++) map[sorted[i].symbol] = 'right2';
    return { axisMap: map, hasRightAxis: true, hasRight2Axis: true };
  })();

  const leftAssets   = assets.filter(a => (axisMap[a.symbol] ?? 'left') === 'left');
  const rightAssets  = hasRightAxis  ? assets.filter(a => axisMap[a.symbol] === 'right')  : [];
  const right2Assets = hasRight2Axis ? assets.filter(a => axisMap[a.symbol] === 'right2') : [];

  // The left axis scales to its own data. When the series are normalized
  // (base-100), secondary axes place 100 at the same visual height as the left
  // axis so every line still starts from one shared point.
  const leftAxisProps = naturalDomain(hasRightAxis ? leftAssets : assets, logScale);

  const alignFraction = (() => {
    if (!normalized) return undefined;
    const d = (leftAxisProps as { domain?: [number, number] }).domain;
    if (!d || typeof d[0] !== 'number' || typeof d[1] !== 'number') return undefined;
    const [lo, hi] = d;
    if (lo <= 0 || hi <= lo) return undefined;
    return logScale
      ? (Math.log(100) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
      : (100 - lo) / (hi - lo);
  })();

  const rightAxisProps = hasRightAxis
    ? (alignFraction != null
        ? alignedDomain(rightAssets, logScale, 100, alignFraction)
        : naturalDomain(rightAssets, logScale))
    : null;
  const right2AxisProps = hasRight2Axis
    ? (alignFraction != null
        ? alignedDomain(right2Assets, logScale, 100, alignFraction)
        : naturalDomain(right2Assets, logScale))
    : null;

  const legendItems: { key: string; name: string; color: string; dashed: boolean }[] = [];
  assets.forEach(a => {
    legendItems.push({ key: a.symbol, name: a.name, color: a.color, dashed: false });
    if (a.trData) {
      legendItems.push({ key: `${a.symbol}_tr`, name: `${a.name} (Total Return)`, color: a.color, dashed: true });
    }
  });

  const selStats = range
    ? assets.map(a => {
        const rows = chartData as { date: string; [k: string]: unknown }[];
        const lv = valueAtOrAfter(rows, range.left, a.symbol);
        const rv = valueAtOrBefore(rows, range.right, a.symbol);
        const pct = lv != null && rv != null && lv !== 0 ? (rv - lv) / Math.abs(lv) * 100 : null;
        return { symbol: a.symbol, name: a.name, color: a.color, pct };
      })
    : null;

  const rightMargin = hasRight2Axis ? 140 : hasRightAxis ? 68 : 24;

  return (
    <div className="relative select-none">
      {range && selStats && (
        <div className="mb-2 bg-bg-input rounded-lg px-3 py-2 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">{fmtDate(range.left)} → {fmtDate(range.right)}</span>
            <button onClick={clear} className="text-gray-600 hover:text-gray-300 text-[10px]">✕ clear</button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {selStats.map(s => (
              <span key={s.symbol} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: s.color }} />
                <span className="text-gray-400">{s.name}</span>
                <span className={`font-bold tabular-nums ${s.pct == null ? 'text-gray-600' : s.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {s.pct == null ? '—' : `${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%`}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(hasRightAxis || hasRight2Axis) && (
        <div className="mb-1 text-[10px] text-gray-600 flex flex-wrap gap-3">
          <span className="flex items-center gap-1">
            <span className="text-gray-500">L:</span>
            {leftAssets.map(a => (
              <span key={a.symbol} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: a.color }} />
                <span style={{ color: a.color }}>{a.name}</span>
              </span>
            ))}
          </span>
          {hasRightAxis && (
            <span className="flex items-center gap-1">
              <span className="text-gray-500">R1:</span>
              {rightAssets.map(a => (
                <span key={a.symbol} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: a.color }} />
                  <span style={{ color: a.color }}>{a.name}</span>
                </span>
              ))}
            </span>
          )}
          {hasRight2Axis && (
            <span className="flex items-center gap-1">
              <span className="text-gray-500">R2:</span>
              {right2Assets.map(a => (
                <span key={a.symbol} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: a.color }} />
                  <span style={{ color: a.color }}>{a.name}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: rightMargin, left: 0, bottom: 0 }}
          {...handlers}
          style={{ cursor: 'crosshair' }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={d => formatDate(d as string, allDates)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false} tickLine={false} minTickGap={50}
          />
          <YAxis
            yAxisId="left"
            {...leftAxisProps}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false} tickLine={false} width={60}
            tickFormatter={tickFmt}
          />
          {hasRightAxis && rightAxisProps && (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...rightAxisProps}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false} tickLine={false} width={65}
              tickFormatter={tickFmt}
            />
          )}
          {hasRight2Axis && right2AxisProps && (
            <YAxis
              yAxisId="right2"
              orientation="right"
              {...right2AxisProps}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false} tickLine={false} width={65}
              tickFormatter={tickFmt}
            />
          )}
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
            formatter={(value: number, name: string) => {
              const item = legendItems.find(l => l.key === name);
              return [`${value?.toFixed(2)}`, item?.name ?? name];
            }}
            labelFormatter={label => {
              try { return format(parseISO(label as string), 'MMM d, yyyy'); }
              catch { return label as string; }
            }}
          />
          <Legend
            formatter={(value: string) => {
              const item = legendItems.find(l => l.key === value);
              if (!item) return <span style={{ color: '#e2e8f0', fontSize: 12 }}>{value}</span>;
              return (
                <span style={{ color: '#e2e8f0', fontSize: 12 }}>
                  {item.name}{item.dashed ? <em style={{ fontSize: 10, color: '#9ca3af' }}> (div.)</em> : ''}
                </span>
              );
            }}
          />
          {assets.map(a => (
            <Line key={a.symbol}
              yAxisId={axisMap[a.symbol] ?? 'left'}
              type={a.type === 'macro' ? 'stepAfter' : 'monotone'}
              dataKey={a.symbol}
              stroke={a.color} strokeWidth={2} dot={false}
              activeDot={{ r: 4 }} connectNulls />
          ))}
          {assets.filter(a => a.trData).map(a => (
            <Line key={`${a.symbol}_tr`}
              yAxisId={axisMap[a.symbol] ?? 'left'}
              type="monotone" dataKey={`${a.symbol}_tr`}
              stroke={a.color} strokeWidth={1.5} strokeDasharray="6 3"
              dot={false} activeDot={{ r: 3 }} connectNulls />
          ))}
          {area && (
            <ReferenceArea
              yAxisId="left"
              x1={area.left}
              x2={area.right}
              fill="#6366f1"
              fillOpacity={0.15}
              stroke="#6366f1"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {!range && (
        <p className="text-[10px] text-gray-700 text-right mt-0.5">Click &amp; drag to compare a period</p>
      )}
    </div>
  );
}
