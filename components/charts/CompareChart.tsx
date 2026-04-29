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
  } catch {
    return dateStr;
  }
}

export function CompareChart({ assets, height = 340 }: Props) {
  if (!assets.length) return null;

  const allDates = Array.from(
    new Set(assets.flatMap(a => a.data.map(d => d.date)))
  ).sort();

  const chartData = allDates.map(date => {
    const point: Record<string, unknown> = { date };
    assets.forEach(a => {
      const match = a.data.find(d => d.date === date);
      point[a.symbol] = match ? match.close : null;
    });
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={d => formatDate(d as string, allDates)}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={50}
        />
        <YAxis
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={55}
          tickFormatter={v => `${(v as number).toFixed(1)}`}
          domain={['auto', 'auto']}
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
            const asset = assets.find(a => a.symbol === name);
            return [`${value?.toFixed(2)}`, asset?.name ?? name];
          }}
          labelFormatter={label => {
            try { return format(parseISO(label as string), 'MMM d, yyyy'); }
            catch { return label as string; }
          }}
        />
        <Legend
          formatter={(value: string) => {
            const asset = assets.find(a => a.symbol === value);
            return <span style={{ color: '#e2e8f0', fontSize: 12 }}>{asset?.name ?? value}</span>;
          }}
        />
        {assets.map(a => (
          <Line
            key={a.symbol}
            type="monotone"
            dataKey={a.symbol}
            stroke={a.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
