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

  // Build union of all dates across price and TR series
  const allDates = Array.from(new Set(
    assets.flatMap(a => [
      ...a.data.map(d => d.date),
      ...(a.trData ?? []).map(d => d.date),
    ])
  )).sort();

  const chartData = allDates.map(date => {
    const point: Record<string, unknown> = { date };
    assets.forEach(a => {
      const match = a.data.find(d => d.date === date);
      // Only include positive values when using log scale
      const v = match ? match.close : null;
      point[a.symbol] = v != null && v > 0 ? v : null;

      // TR series (total return with dividends)
      if (a.trData) {
        const trMatch = a.trData.find(d => d.date === date);
        const tv = trMatch ? trMatch.close : null;
        point[`${a.symbol}_tr`] = tv != null && tv > 0 ? tv : null;
      }
    });
    return point;
  });

  const yAxisProps = logScale
    ? { scale: 'log' as const, domain: ['auto', 'auto'] as [string | number, string | number], allowDataOverflow: false }
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
            if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return n.toFixed(1);
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
