'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { BTC_HALVING_DATES } from '@/lib/config';
import { format, parseISO } from 'date-fns';

// Bitcoin halvings shown as vertical reference lines on a continuous time axis.
export function HalvingChart({ height = 240 }: { height?: number }) {
  // Continuous monthly axis from Jan 2012 → current month.
  const data: { date: string; v: number }[] = [];
  const now = new Date();
  const d = new Date(2012, 0, 1);
  while (d <= now) {
    data.push({ date: format(d, 'yyyy-MM-dd'), v: 0 });
    d.setMonth(d.getMonth() + 1);
  }

  // Snap a halving date to the nearest monthly data point so the
  // ReferenceLine renders on the category X axis.
  const snap = (target: string): string => {
    const tt = parseISO(target).getTime();
    let best = data[0].date, bestDiff = Infinity;
    for (const p of data) {
      const diff = Math.abs(parseISO(p.date).getTime() - tt);
      if (diff < bestDiff) { bestDiff = diff; best = p.date; }
    }
    return best;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 26, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={v => { try { return format(parseISO(v as string), 'yyyy'); } catch { return v as string; } }}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false} tickLine={false} minTickGap={36}
        />
        <YAxis hide domain={[0, 1]} />
        <Line dataKey="v" stroke="transparent" dot={false} isAnimationActive={false} />
        {BTC_HALVING_DATES.map(hd => (
          <ReferenceLine
            key={hd}
            x={snap(hd)}
            stroke="#f59e0b"
            strokeWidth={2}
            label={{
              value: `⚡ ${format(parseISO(hd), "MMM ''yy")}`,
              fill: '#f59e0b', fontSize: 10, position: 'insideTop',
            }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
