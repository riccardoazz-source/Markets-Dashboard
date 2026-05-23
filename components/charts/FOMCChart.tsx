'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { FOMC_MEETING_DATES } from '@/lib/config';
import { format, parseISO } from 'date-fns';

/**
 * FOMC meeting dates shown as vertical reference lines on a continuous time axis.
 * Past meetings are rendered in gray, future (projected) meetings in blue.
 * Mirrors the same structure as HalvingChart.
 */
export function FOMCChart({ height = 240 }: { height?: number }) {
  const today = new Date().toISOString().slice(0, 10);

  // Continuous monthly axis from Jan 2000 → last FOMC date (or today, whichever is later)
  const lastDate = FOMC_MEETING_DATES[FOMC_MEETING_DATES.length - 1];
  const axisEnd = lastDate > today ? new Date(lastDate + 'T12:00:00Z') : new Date();
  const data: { date: string; v: number }[] = [];
  const d = new Date(2000, 0, 1);
  while (d <= axisEnd) {
    data.push({ date: format(d, 'yyyy-MM-dd'), v: 0 });
    d.setMonth(d.getMonth() + 1);
  }

  // Snap an FOMC date to the nearest monthly data point so the
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

  const todaySnapped = snap(today);

  // Show all dates — past in gray, future in blue.
  // Only label a selection to avoid overlap: roughly one per year.
  const labeledIdxs = new Set<number>();
  let lastLabelYear = -1;
  FOMC_MEETING_DATES.forEach((d, i) => {
    const yr = parseInt(d.slice(0, 4), 10);
    if (yr !== lastLabelYear) { labeledIdxs.add(i); lastLabelYear = yr; }
  });

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
        {/* Invisible line to populate the category axis */}
        <Line dataKey="v" stroke="transparent" dot={false} isAnimationActive={false} />

        {/* Today marker */}
        <ReferenceLine
          x={todaySnapped}
          stroke="#6b7280"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          label={{ value: 'Today', fill: '#9ca3af', fontSize: 9, position: 'insideTopLeft' }}
        />

        {/* FOMC meeting lines */}
        {FOMC_MEETING_DATES.map((md, i) => {
          const isFuture = md > today;
          const stroke = isFuture ? '#3b82f6' : '#6b7280';
          const opacity = isFuture ? 0.9 : 0.45;
          const showLabel = labeledIdxs.has(i);
          return (
            <ReferenceLine
              key={md}
              x={snap(md)}
              stroke={stroke}
              strokeWidth={isFuture ? 1.5 : 1}
              strokeOpacity={opacity}
              label={showLabel ? {
                value: `🏛 ${format(parseISO(md), "yyyy")}`,
                fill: isFuture ? '#60a5fa' : '#6b7280',
                fontSize: 9,
                position: 'insideTop',
              } : undefined}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
