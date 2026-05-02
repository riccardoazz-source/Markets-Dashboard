'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { CompareAsset } from '@/lib/types';
import { format, parseISO } from 'date-fns';

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

export function CompareChart({ assets, height = 340, logScale = false }: Props) {
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

  // For log scale: scan data range for explicit domain + nice tick values.
  // Using 'auto' domain with log scale can crash Recharts/D3 when no valid
  // positive values exist (D3 log scale cannot handle 0 or negative domain).
  const { logTicks, logDomain } = (() => {
    if (!logScale) return { logTicks: undefined, logDomain: ['auto', 'auto'] as [string | number, string | number] };
    let lo = Infinity, hi = -Infinity;
    assets.forEach(a => {
      [...a.data, ...(a.trData ?? [])].forEach(d => {
        if (d.close > 0 && isFinite(d.close)) {
          lo = Math.min(lo, d.close);
          hi = Math.max(hi, d.close);
        }
      });
    });
    // Fall back to a safe range so D3 log scale never receives 0 / NaN domain
    const safeLo = isFinite(lo) && lo > 0 ? Math.max(lo * 0.85, 0.1) : 1;
    const safeHi = isFinite(hi) && hi > 0 ? hi * 1.15 : 1000;
    const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const filtered = candidates.filter(c => c >= safeLo && c <= safeHi);
    return {
      logTicks: filtered.length >= 2 ? filtered : undefined,
      logDomain: [safeLo, safeHi] as [number, number],
    };
  })();

  const yAxisProps = logScale
    ? { scale: 'log' as const, domain: logDomain, allowDataOverflow: false, ticks: logTicks }
    : { domain: ['auto', 'auto'] as [string | number, string | number] };

  // Legend entries: one per series (including TR lines)
  const legendItems: { key: string; name: string; color: string; dashed: boolean }[] = [];
  assets.forEach(a => {
    legendItems.push({ key: a.symbol, name: a.name, color: a.color, dashed: false });
    if (a.trData) {
      legendItems.push({ key: `${a.symbol}_tr`, name: `${a.name} (Total Return)`, color: a.color, dashed: true });
    }
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={d => formatDate(d as string, allDates)}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false} tickLine={false} minTickGap={50}
        />
        <YAxis
          {...yAxisProps}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false} tickLine={false} width={60}
          tickFormatter={v => {
            const n = v as number;
            if (n >= 10000) return `${Math.round(n / 1000)}k`;
            if (n >= 1000) return n % 1000 === 0 ? `${n / 1000}k` : `${(n / 1000).toFixed(1)}k`;
            return Number.isInteger(n) ? `${n}` : n.toFixed(1);
          }}
        />
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
          <Line key={a.symbol} type="monotone" dataKey={a.symbol}
            stroke={a.color} strokeWidth={2} dot={false}
            activeDot={{ r: 4 }} connectNulls />
        ))}
        {assets.filter(a => a.trData).map(a => (
          <Line key={`${a.symbol}_tr`} type="monotone" dataKey={`${a.symbol}_tr`}
            stroke={a.color} strokeWidth={1.5} strokeDasharray="6 3"
            dot={false} activeDot={{ r: 3 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
