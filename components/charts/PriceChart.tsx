'use client';

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { HistoricalPoint } from '@/lib/types';
import { format, parseISO } from 'date-fns';

interface Props {
  data: HistoricalPoint[];
  color?: string;
  showAverage?: boolean;
  averageValue?: number;
  height?: number;
  label?: string;
  isCurrency?: boolean;
}

function formatDate(dateStr: string, dataLen: number) {
  try {
    const d = parseISO(dateStr);
    return dataLen > 300 ? format(d, 'MMM yy') : dataLen > 60 ? format(d, 'MMM d') : format(d, 'MMM d');
  } catch {
    return dateStr;
  }
}

export function PriceChart({
  data, color = '#6366f1', showAverage = false, averageValue,
  height = 220, isCurrency = false,
}: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No data available
      </div>
    );
  }

  const first = data[0].close;
  const last = data[data.length - 1].close;
  const isUp = last >= first;
  const chartColor = isUp ? '#10b981' : '#ef4444';
  const resolvedColor = color === 'auto' ? chartColor : color;

  const decimals = isCurrency
    ? (last < 1 ? 4 : last < 10 ? 4 : 2)
    : last < 10 ? 2 : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${resolvedColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={resolvedColor} stopOpacity={0.25} />
            <stop offset="95%" stopColor={resolvedColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={d => formatDate(d as string, data.length)}
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
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return n.toFixed(decimals);
          }}
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
          formatter={(value: number) => [value.toFixed(decimals), 'Price']}
          labelFormatter={label => formatDate(label as string, data.length)}
        />
        {showAverage && averageValue && (
          <ReferenceLine
            y={averageValue}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{ value: `Avg ${averageValue.toFixed(decimals)}`, fill: '#f59e0b', fontSize: 10, position: 'right' }}
          />
        )}
        <Area
          type="monotone"
          dataKey="close"
          stroke={resolvedColor}
          strokeWidth={2}
          fill={`url(#grad-${resolvedColor.replace('#', '')})`}
          dot={false}
          activeDot={{ r: 4, fill: resolvedColor }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
