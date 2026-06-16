'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { FOMC_MEETING_DATES, FOMC_DOT_PLOT_SET } from '@/lib/config';
import { format, parseISO } from 'date-fns';

/**
 * FOMC meeting dates shown as vertical reference lines on a continuous time axis.
 * Past meetings are rendered in gray, future (projected) meetings in blue.
 * Meetings that publish a Summary of Economic Projections (the "dot plot") are
 * highlighted in violet.
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

  // Show all dates — past in gray, future in blue, dot-plot in violet.
  // Only label a selection to avoid overlap: roughly one per year.
  const labeledIdxs = new Set<number>();
  let lastLabelYear = -1;
  FOMC_MEETING_DATES.forEach((d, i) => {
    const yr = parseInt(d.slice(0, 4), 10);
    if (yr !== lastLabelYear) { labeledIdxs.add(i); lastLabelYear = yr; }
  });

  const fmt = (s: string) => { try { return format(parseISO(s), 'd MMM yyyy'); } catch { return s; } };
  const meetingsNewestFirst = FOMC_MEETING_DATES.slice().reverse();
  const dotPlotCount = FOMC_MEETING_DATES.filter(d => FOMC_DOT_PLOT_SET.has(d)).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
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

          {/* FOMC meeting lines — dot-plot meetings in violet, others gray/blue */}
          {FOMC_MEETING_DATES.map((md, i) => {
            const isFuture = md > today;
            const isDotPlot = FOMC_DOT_PLOT_SET.has(md);
            const stroke = isDotPlot ? '#a855f7' : isFuture ? '#3b82f6' : '#6b7280';
            const opacity = isDotPlot ? 0.9 : isFuture ? 0.9 : 0.4;
            const showLabel = labeledIdxs.has(i);
            return (
              <ReferenceLine
                key={md}
                x={snap(md)}
                stroke={stroke}
                strokeWidth={isDotPlot ? 1.75 : isFuture ? 1.5 : 1}
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

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border bg-bg-input/30 text-[10px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px]" style={{ backgroundColor: '#a855f7' }} /> Dot Plot (SEP)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px]" style={{ backgroundColor: '#6b7280' }} /> Regular meeting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px]" style={{ backgroundColor: '#3b82f6' }} /> Upcoming
        </span>
      </div>

      {/* FOMC meeting dates list — newest first, dot-plot + future highlighted */}
      <div className="border-t border-border">
        <div className="px-3 py-2 bg-bg-input/50 border-b border-border flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
          <span className="text-xs font-semibold text-gray-200">FOMC Meetings</span>
          <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border">
            {FOMC_MEETING_DATES.length}
          </span>
          <span className="text-[10px] text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/30">
            {dotPlotCount} dot plot
          </span>
        </div>
        <div className="divide-y divide-border max-h-56 overflow-y-auto">
          {meetingsNewestFirst.map(md => {
            const isFuture = md > today;
            const isDotPlot = FOMC_DOT_PLOT_SET.has(md);
            return (
              <div key={`mtg-row-${md}`} className="flex items-center gap-2.5 px-3 py-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: isDotPlot ? '#a855f7' : isFuture ? '#3b82f6' : '#6b7280' }}
                />
                <span className={isFuture ? 'text-xs font-semibold text-blue-300' : 'text-xs text-gray-300'}>
                  {fmt(md)}
                </span>
                {isDotPlot && (
                  <span className="text-[10px] text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/30">
                    dot plot
                  </span>
                )}
                {isFuture && <span className="text-[10px] text-blue-400/70">upcoming</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
