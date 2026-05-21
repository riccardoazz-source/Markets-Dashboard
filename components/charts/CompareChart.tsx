'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceArea, ReferenceLine,
} from 'recharts';
import { CompareAsset } from '@/lib/types';
import { BTC_HALVING_DATES } from '@/lib/config';
import { format, parseISO } from 'date-fns';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore } from '@/lib/useChartDragSelect';

interface Props {
  assets: CompareAsset[];
  height?: number;
  logScale?: boolean;
  percentMode?: boolean;
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

const pctTickFmt = (v: number) => {
  const n = v as number;
  const sign = n > 0 ? '+' : '';
  if (Math.abs(n) >= 1000) return `${sign}${Math.round(n / 100) / 10}k%`;
  return `${sign}${n.toFixed(0)}%`;
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

// Each Y axis scales independently to the data drawn on it. Lines on the same
// axis are comparable to each other; lines on different axes are each readable
// on their own scale (that is the point of having several axes).
function axisProps(group: CompareAsset[], logScale: boolean): object {
  if (!logScale) return { domain: ['auto', 'auto'] as [string, string] };
  const { lo, hi } = groupRange(group);
  if (!isFinite(lo) || !isFinite(hi) || lo <= 0 || hi <= lo) {
    return { domain: ['auto', 'auto'] as [string, string] };
  }
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

export function CompareChart({ assets, height = 340, logScale = false, percentMode = false }: Props) {
  const { handlers, range, area, clear } = useChartDragSelect();

  if (!assets.length) return null;

  // BTC_HALVING is displayed as vertical reference lines, not as a data series.
  const halvingAsset = assets.find(a => a.symbol === 'BTC_HALVING');
  const nonHalvingAssets = assets.filter(a => a.symbol !== 'BTC_HALVING');

  const MAX_CHART_POINTS = 500;
  const rawDates = Array.from(new Set(
    nonHalvingAssets.flatMap(a => [
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

  const assetMaps = nonHalvingAssets.map(a => ({
    prices: new Map(a.data.map(d => [d.date, d.close])),
    tr:     a.trData ? new Map(a.trData.map(d => [d.date, d.close])) : null,
  }));

  const chartData = allDates.map(date => {
    const point: Record<string, unknown> = { date };
    nonHalvingAssets.forEach((a, idx) => {
      const v = assetMaps[idx].prices.get(date) ?? null;
      // In % change mode values can be 0 (start) or negative (loss from start)
      point[a.symbol] = v != null && isFinite(v) && (percentMode || v > 0) ? v : null;
      if (assetMaps[idx].tr) {
        const tv = assetMaps[idx].tr!.get(date) ?? null;
        point[`${a.symbol}_tr`] = tv != null && isFinite(tv) && (percentMode || tv > 0) ? tv : null;
      }
    });
    return point;
  });

  // Halving dates visible in the current range, snapped to the nearest category
  // value so the ReferenceLine actually renders on the (categorical) X axis.
  const visibleHalvingDates = halvingAsset && allDates.length > 0
    ? BTC_HALVING_DATES
        .filter(d => d >= allDates[0] && d <= allDates[allDates.length - 1])
        .map(d => {
          const tt = parseISO(d).getTime();
          let best = allDates[0], bestDiff = Infinity;
          for (const a of allDates) {
            const diff = Math.abs(parseISO(a).getTime() - tt);
            if (diff < bestDiff) { bestDiff = diff; best = a; }
          }
          return best;
        })
    : [];

  // ── Y-axis grouping ───────────────────────────────────────────────────────
  // In % change mode (Google Finance style): single shared axis — all series
  // start at 0% so they are directly comparable on the same scale.
  // In absolute price mode: up to 3 Y axes, grouped by price magnitude so
  // each asset is readable on its own scale regardless of timeframe.
  const { axisMap, hasRightAxis, hasRight2Axis } = (() => {
    const map: Record<string, AxisGroup> = {};
    nonHalvingAssets.forEach(a => { map[a.symbol] = 'left'; });

    // Percent mode → single axis
    if (percentMode) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    if (nonHalvingAssets.length < 2) return { axisMap: map, hasRightAxis: false, hasRight2Axis: false };

    const levels = nonHalvingAssets.map(a => {
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

  const leftAssets   = nonHalvingAssets.filter(a => (axisMap[a.symbol] ?? 'left') === 'left');
  const rightAssets  = hasRightAxis  ? nonHalvingAssets.filter(a => axisMap[a.symbol] === 'right')  : [];
  const right2Assets = hasRight2Axis ? nonHalvingAssets.filter(a => axisMap[a.symbol] === 'right2') : [];

  // Every axis scales independently to the data drawn on it, so each asset is
  // readable on its own scale regardless of how differently the others moved.
  const leftAxisProps   = axisProps(hasRightAxis ? leftAssets : assets, logScale);
  const rightAxisProps  = hasRightAxis  ? axisProps(rightAssets,  logScale) : null;
  const right2AxisProps = hasRight2Axis ? axisProps(right2Assets, logScale) : null;

  const legendItems: { key: string; name: string; color: string; dashed: boolean }[] = [];
  nonHalvingAssets.forEach(a => {
    legendItems.push({ key: a.symbol, name: a.name, color: a.color, dashed: false });
    if (a.trData) {
      legendItems.push({ key: `${a.symbol}_tr`, name: `${a.name} (Total Return)`, color: a.color, dashed: true });
    }
  });
  if (halvingAsset) {
    legendItems.push({ key: 'BTC_HALVING', name: 'Bitcoin Halvings', color: '#f59e0b', dashed: true });
  }

  const selStats = range
    ? nonHalvingAssets.map(a => {
        const rows = chartData as { date: string; [k: string]: unknown }[];
        const lv = valueAtOrAfter(rows, range.left, a.symbol);
        const rv = valueAtOrBefore(rows, range.right, a.symbol);
        let pct: number | null = null;
        if (lv != null && rv != null) {
          if (percentMode) {
            // lv/rv are % change from common start → convert to actual sub-period return
            pct = ((1 + rv / 100) / (1 + lv / 100) - 1) * 100;
          } else {
            pct = lv !== 0 ? (rv - lv) / Math.abs(lv) * 100 : null;
          }
        }
        return { symbol: a.symbol, name: a.name, color: a.color, pct };
      })
    : null;

  const rightMargin = hasRight2Axis ? 140 : hasRightAxis ? 68 : percentMode ? 16 : 24;

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

      {!percentMode && (hasRightAxis || hasRight2Axis) && (
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
            {...(percentMode ? { domain: ['auto', 'auto'] } : leftAxisProps)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false} tickLine={false} width={percentMode ? 52 : 60}
            tickFormatter={percentMode ? pctTickFmt : tickFmt}
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
              const label = item?.name ?? name;
              if (percentMode) {
                const v = value as number;
                return [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, label];
              }
              return [`${value?.toFixed(2)}`, label];
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
          {percentMode && (
            <ReferenceLine yAxisId="left" y={0} stroke="#374151" strokeDasharray="4 2" strokeWidth={1} />
          )}
          {nonHalvingAssets.map(a => (
            <Line key={a.symbol}
              yAxisId={axisMap[a.symbol] ?? 'left'}
              type={a.type === 'macro' ? 'stepAfter' : 'monotone'}
              dataKey={a.symbol}
              stroke={a.color} strokeWidth={2} dot={false}
              activeDot={{ r: 4 }} connectNulls />
          ))}
          {nonHalvingAssets.filter(a => a.trData).map(a => (
            <Line key={`${a.symbol}_tr`}
              yAxisId={axisMap[a.symbol] ?? 'left'}
              type="monotone" dataKey={`${a.symbol}_tr`}
              stroke={a.color} strokeWidth={1.5} strokeDasharray="6 3"
              dot={false} activeDot={{ r: 3 }} connectNulls />
          ))}
          {visibleHalvingDates.map(d => (
            <ReferenceLine
              key={d}
              yAxisId="left"
              x={d}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              label={{ value: '⚡', fill: '#f59e0b', fontSize: 12, position: 'top' }}
            />
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
