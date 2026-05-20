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

// Compute axis props with optional alignment of a reference value to the same
// visual fraction as the primary (left) axis. When all series are normalized to
// start at 100, alignValue=100 with alignFraction derived from the left axis
// ensures 100 sits at the same vertical position on every axis.
function getAlignedAxisProps(
  group: CompareAsset[],
  logScale: boolean,
  alignValue?: number,
  alignFraction?: number,
): object {
  if (!logScale) {
    if (alignValue == null || alignFraction == null || alignFraction <= 0 || alignFraction >= 1) {
      return { domain: ['auto', 'auto'] as [string, string] };
    }
    // Linear alignment: lo = (hi * alignFraction - alignValue) / (alignFraction - 1)
    let hi = -Infinity;
    group.forEach(a => {
      [...a.data, ...(a.trData ?? [])].forEach(d => {
        if (d.close > 0 && isFinite(d.close)) hi = Math.max(hi, d.close);
      });
    });
    if (!isFinite(hi) || hi <= alignValue) return { domain: ['auto', 'auto'] as [string, string] };
    const safeHi = hi * 1.10;
    const lo = (safeHi * alignFraction - alignValue) / (alignFraction - 1);
    return { domain: [Math.max(lo * 0.95, 0), safeHi] as [number, number] };
  }

  // Log scale
  let lo = Infinity, hi = -Infinity;
  group.forEach(a => {
    [...a.data, ...(a.trData ?? [])].forEach(d => {
      if (d.close > 0 && isFinite(d.close)) {
        lo = Math.min(lo, d.close);
        hi = Math.max(hi, d.close);
      }
    });
  });
  const safeLo = isFinite(lo) && lo > 0 ? Math.max(lo * 0.85, 0.1) : 1;
  const safeHi = isFinite(hi) && hi > 0 ? hi * 1.15 : 1000;

  let finalLo = safeLo;

  // Align the reference value to the same log-fraction as the left axis
  if (alignValue != null && alignFraction != null && alignFraction > 0 && alignFraction < 1) {
    const logHi = Math.log(safeHi);
    const logVal = Math.log(alignValue);
    // alignFraction = (logVal - logLo) / (logHi - logLo)
    // → logLo = (logVal - alignFraction * logHi) / (1 - alignFraction)
    const logLo = (logVal - alignFraction * logHi) / (1 - alignFraction);
    const candidate = Math.exp(logLo);
    if (isFinite(candidate) && candidate > 0 && candidate < alignValue) {
      finalLo = candidate;
    }
  }

  const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const filtered = candidates.filter(c => c >= finalLo && c <= safeHi);
  return {
    scale: 'log' as const,
    domain: [finalLo, safeHi] as [number, number],
    allowDataOverflow: false,
    ticks: filtered.length >= 2 ? filtered : undefined,
  };
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
  // Normalized (base-100) mode always uses a single shared axis: that is the
  // whole point of normalizing, and it keeps the chart identical across every
  // timeframe. Absolute-price mode may split into up to 3 axes via gap-split:
  // sort assets by max value, find the top-2 multiplicative gaps (ratio ≥ 2.5x).
  const { axisMap, hasRightAxis, hasRight2Axis } = (() => {
    const map: Record<string, AxisGroup> = {};
    assets.forEach(a => { map[a.symbol] = 'left'; });
    if (assets.length < 2 || normalized) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    const assetMaxVals = assets.map(a => {
      let max = 0;
      for (const row of chartData) {
        const v = (row as Record<string, unknown>)[a.symbol];
        if (typeof v === 'number' && isFinite(v) && v > max) max = v;
      }
      return { symbol: a.symbol, max };
    }).filter(x => x.max > 0);

    if (assetMaxVals.length < 2) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    const sorted = [...assetMaxVals].sort((a, b) => a.max - b.max);
    const overallRatio = sorted[sorted.length - 1].max / sorted[0].max;
    if (overallRatio < 2.5) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    // Compute all consecutive multiplicative gaps
    const gaps: { idx: number; ratio: number }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push({ idx: i, ratio: sorted[i].max / sorted[i - 1].max });
    }
    // Sort gaps by ratio descending, pick up to 2 with ratio >= 2.5
    const bigGaps = gaps
      .filter(g => g.ratio >= 2.5)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 2)
      .map(g => g.idx)
      .sort((a, b) => a - b); // sort by position ascending

    if (bigGaps.length === 0) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    if (bigGaps.length === 1) {
      // One split: below gap → left, above → right
      for (let i = bigGaps[0]; i < sorted.length; i++) map[sorted[i].symbol] = 'right';
      return { axisMap: map, hasRightAxis: true, hasRight2Axis: false };
    }

    // Two splits: group 0 → left, group 1 → right, group 2 → right2
    const [split1, split2] = bigGaps;
    for (let i = split1; i < split2; i++) map[sorted[i].symbol] = 'right';
    for (let i = split2; i < sorted.length; i++) map[sorted[i].symbol] = 'right2';
    return { axisMap: map, hasRightAxis: true, hasRight2Axis: true };
  })();

  const leftAssets   = assets.filter(a => (axisMap[a.symbol] ?? 'left') === 'left');
  const rightAssets  = hasRightAxis  ? assets.filter(a => axisMap[a.symbol] === 'right')  : [];
  const right2Assets = hasRight2Axis ? assets.filter(a => axisMap[a.symbol] === 'right2') : [];

  // Compute left axis props first, then derive alignment fraction for secondary axes
  const leftAxisProps = getAlignedAxisProps(hasRightAxis ? leftAssets : assets, logScale);

  // When normalized (all start at 100), compute fraction where 100 sits on left axis
  // so we can align it on right/right2 axes too.
  const alignFraction = (() => {
    const props = leftAxisProps as { domain?: [number, number]; scale?: string };
    if (!props.domain || !Array.isArray(props.domain)) return undefined;
    const [lo, hi] = props.domain;
    if (typeof lo !== 'number' || typeof hi !== 'number' || lo <= 0 || hi <= lo) return undefined;
    if (logScale) {
      return (Math.log(100) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    }
    return (100 - lo) / (hi - lo);
  })();

  const rightAxisProps  = hasRightAxis  ? getAlignedAxisProps(rightAssets,  logScale, 100, alignFraction) : null;
  const right2AxisProps = hasRight2Axis ? getAlignedAxisProps(right2Assets, logScale, 100, alignFraction) : null;

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
