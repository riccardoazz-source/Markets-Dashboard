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

export function CompareChart({ assets, height = 340, logScale = false }: Props) {
  const { handlers, range, area, clear } = useChartDragSelect();

  if (!assets.length) return null;

  // Build union of all dates across price and TR series, then cap at ~500 points.
  // CoinGecko returns daily crypto data even for 3Y/5Y/10Y (1095–3650 pts).
  // Recharts with O(n²) find() on 3000+ rows can choke; 500 pts still gives
  // a smooth visual while keeping renders fast and React from interrupting.
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

  // Build a date→index map per asset for O(1) lookup instead of O(n) find
  const assetMaps = assets.map(a => ({
    prices: new Map(a.data.map(d => [d.date, d.close])),
    tr:     a.trData ? new Map(a.trData.map(d => [d.date, d.close])) : null,
  }));

  const chartData = allDates.map(date => {
    const point: Record<string, unknown> = { date };
    assets.forEach((a, idx) => {
      const v = assetMaps[idx].prices.get(date) ?? null;
      // Guard against Infinity/NaN that can crash Recharts scale computation
      point[a.symbol] = v != null && v > 0 && isFinite(v) ? v : null;

      // TR series (total return with dividends)
      if (assetMaps[idx].tr) {
        const tv = assetMaps[idx].tr!.get(date) ?? null;
        point[`${a.symbol}_tr`] = tv != null && tv > 0 && isFinite(tv) ? tv : null;
      }
    });
    return point;
  });

  // ── Dual Y-axis grouping ───────────────────────────────────────────────────
  // When assets have very different value ranges (ratio > 8x), split them:
  // lower-valued assets on the left axis, higher-valued on the right axis.
  const { axisMap, hasRightAxis } = (() => {
    if (assets.length < 2) {
      const m: Record<string, 'left' | 'right'> = {};
      assets.forEach(a => { m[a.symbol] = 'left'; });
      return { axisMap: m, hasRightAxis: false };
    }

    const assetMaxVals = assets.map(a => {
      let max = 0;
      for (const row of chartData) {
        const v = (row as Record<string, unknown>)[a.symbol];
        if (typeof v === 'number' && isFinite(v) && v > max) max = v;
      }
      return { symbol: a.symbol, max };
    }).filter(x => x.max > 0);

    const map: Record<string, 'left' | 'right'> = {};
    assets.forEach(a => { map[a.symbol] = 'left'; });

    if (assetMaxVals.length < 2) return { axisMap: map, hasRightAxis: false };

    const sorted = [...assetMaxVals].sort((a, b) => a.max - b.max);
    const minMax = sorted[0].max;
    const maxMax = sorted[sorted.length - 1].max;

    if (maxMax / minMax <= 8) return { axisMap: map, hasRightAxis: false };

    // Split at geometric mean so each group has a similar internal range
    const threshold = Math.sqrt(minMax * maxMax);
    assetMaxVals.forEach(({ symbol, max }) => {
      map[symbol] = max > threshold ? 'right' : 'left';
    });

    const hasRight = Object.values(map).some(v => v === 'right');
    return { axisMap: map, hasRightAxis: hasRight };
  })();

  const leftAssets  = assets.filter(a => (axisMap[a.symbol] ?? 'left') === 'left');
  const rightAssets = hasRightAxis ? assets.filter(a => axisMap[a.symbol] === 'right') : [];

  // Compute Y-axis props (domain + log ticks) for a group of assets
  const getAxisProps = (group: CompareAsset[]) => {
    if (!logScale) return { domain: ['auto', 'auto'] as [string | number, string | number] };
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
    const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const filtered = candidates.filter(c => c >= safeLo && c <= safeHi);
    return {
      scale: 'log' as const,
      domain: [safeLo, safeHi] as [number, number],
      allowDataOverflow: false,
      ticks: filtered.length >= 2 ? filtered : undefined,
    };
  };

  // Legend entries: one per series (including TR lines)
  const legendItems: { key: string; name: string; color: string; dashed: boolean }[] = [];
  assets.forEach(a => {
    legendItems.push({ key: a.symbol, name: a.name, color: a.color, dashed: false });
    if (a.trData) {
      legendItems.push({ key: `${a.symbol}_tr`, name: `${a.name} (Total Return)`, color: a.color, dashed: true });
    }
  });

  // Per-asset change over the drag-selected period
  const selStats = range
    ? assets.map(a => {
        const rows = chartData as { date: string; [k: string]: unknown }[];
        const lv = valueAtOrAfter(rows, range.left, a.symbol);
        const rv = valueAtOrBefore(rows, range.right, a.symbol);
        const pct = lv != null && rv != null && lv !== 0 ? (rv - lv) / Math.abs(lv) * 100 : null;
        return { symbol: a.symbol, name: a.name, color: a.color, pct };
      })
    : null;

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

      {hasRightAxis && (
        <div className="mb-1 text-[10px] text-gray-600 flex flex-wrap gap-3">
          <span className="flex items-center gap-1">
            <span className="text-gray-500">Left axis:</span>
            {leftAssets.map(a => (
              <span key={a.symbol} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: a.color }} />
                <span style={{ color: a.color }}>{a.name}</span>
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1">
            <span className="text-gray-500">Right axis:</span>
            {rightAssets.map(a => (
              <span key={a.symbol} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: a.color }} />
                <span style={{ color: a.color }}>{a.name}</span>
              </span>
            ))}
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: hasRightAxis ? 68 : 24, left: 0, bottom: 0 }}
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
            {...getAxisProps(hasRightAxis ? leftAssets : assets)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false} tickLine={false} width={60}
            tickFormatter={tickFmt}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...getAxisProps(rightAssets)}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false} tickLine={false} width={60}
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
