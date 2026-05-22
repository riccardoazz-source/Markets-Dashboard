'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceArea,
} from 'recharts';
import { HistoricalPoint } from '@/lib/types';
import { RECESSION_META } from '@/lib/config';
import { recessionIntervals } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface RecessionDataset {
  symbol: string;
  data: HistoricalPoint[];
}

// Standalone recession view — a bare time axis with shaded bands for each
// recession period. Used in the Macro detail panel and in Compare when only
// recession series are selected (nothing to draw a line against).
export function RecessionChart({
  datasets, height = 240,
}: {
  datasets: RecessionDataset[];
  height?: number;
}) {
  const allDates = datasets
    .flatMap(d => d.data.map(p => p.date))
    .filter(Boolean)
    .sort();

  if (allDates.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-600 text-sm" style={{ height }}>
        No recession data
      </div>
    );
  }

  // Continuous monthly axis from the earliest data point to today.
  const startD = parseISO(allDates[0]);
  const endD = new Date();
  const axis: { date: string; v: number }[] = [];
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  while (cur <= endD) {
    axis.push({ date: format(cur, 'yyyy-MM-dd'), v: 0 });
    cur.setMonth(cur.getMonth() + 1);
  }

  const snap = (target: string): string => {
    const tt = parseISO(target).getTime();
    let best = axis[0].date, bestDiff = Infinity;
    for (const p of axis) {
      const diff = Math.abs(parseISO(p.date).getTime() - tt);
      if (diff < bestDiff) { bestDiff = diff; best = p.date; }
    }
    return best;
  };

  const bands = datasets.flatMap(ds => {
    const meta = RECESSION_META[ds.symbol] ?? { label: ds.symbol, color: '#64748b' };
    return recessionIntervals(ds.data).map(iv => ({
      key: `${ds.symbol}-${iv.start}`,
      x1: snap(iv.start),
      x2: snap(iv.end),
      color: meta.color,
    }));
  });

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1.5 px-1">
        {datasets.map(ds => {
          const meta = RECESSION_META[ds.symbol] ?? { label: ds.symbol, color: '#64748b' };
          return (
            <span key={ds.symbol} className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="inline-block w-4 h-2.5 rounded-sm"
                style={{ backgroundColor: meta.color, opacity: 0.5 }} />
              {meta.label}
            </span>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={axis} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={v => { try { return format(parseISO(v as string), 'yyyy'); } catch { return v as string; } }}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false} tickLine={false} minTickGap={36}
          />
          <YAxis hide domain={[0, 1]} />
          <Line dataKey="v" stroke="transparent" dot={false} isAnimationActive={false} />
          {bands.map(b => (
            <ReferenceArea
              key={b.key}
              x1={b.x1}
              x2={b.x2}
              fill={b.color}
              fillOpacity={0.3}
              stroke={b.color}
              strokeOpacity={0.4}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
