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
  interpolationType?: 'monotone' | 'stepAfter';
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

export function PriceChart({
  data, color = '#6366f1', showAverage = false, averageValue,
  height = 220, isCurrency = false, interpolationType = 'monotone',
}: Props) {
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

  // Compute explicit numeric domain so the y-axis never pins to 0 when data is
  // well above it (e.g. interest rates 3-5%, CPI 300, GDP 25000).
  // AreaChart's default 'auto' lower bound anchors to 0 for positive data,
  // making variation invisible — this replaces that with a tight-range domain.
  const closes = data.map(d => d.close).filter((c): c is number => typeof c === 'number' && isFinite(c));
  const rawMin = closes.length > 0 ? Math.min(...closes) : 0;
  const rawMax = closes.length > 0 ? Math.max(...closes) : 1;
  const range = rawMax - rawMin;
  // Padding: 8% of range, at least 2% of the max value (handles flat/constant series)
  const pad = Math.max(range * 0.08, Math.abs(rawMax) * 0.02, 0.001);
  // Don't show negative space for strictly non-negative data
  const yMin = rawMin >= 0 ? Math.max(0, rawMin - pad) : rawMin - pad;
  const yMax = rawMax + pad;

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
          formatter={(value: number) => [value.toFixed(decimals), '']}
          labelFormatter={label => {
            try { return format(parseISO(label as string), 'MMM d, yyyy'); }
            catch { return label as string; }
          }}
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
          type={interpolationType}
          dataKey="close"
          stroke={resolvedColor}
          strokeWidth={isStep ? 1.5 : 2}
          fill={isStep ? 'none' : `url(#grad-${resolvedColor.replace('#', '')})`}
          dot={false}
          activeDot={{ r: 4, fill: resolvedColor }}
          baseValue={yMin}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
