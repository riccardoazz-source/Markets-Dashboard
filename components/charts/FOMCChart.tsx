'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { FOMC_MEETING_DATES, FED_CHAIR_CHANGES } from '@/lib/config';
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

  // Lists below the chart (newest first).
  const fmt = (s: string) => { try { return format(parseISO(s), 'd MMM yyyy'); } catch { return s; } };
  const chairsNewestFirst = FED_CHAIR_CHANGES.slice().reverse();
  const meetingsNewestFirst = FOMC_MEETING_DATES.slice().reverse();

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

          {/* Fed chair nomination markers — red dashed line at nomination date */}
          {FED_CHAIR_CHANGES
            .filter(c => c.date >= data[0]?.date && c.date <= data[data.length - 1]?.date)
            .map(c => (
              <ReferenceLine
                key={`chair-nom-${c.date}`}
                x={snap(c.date)}
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="5 2"
                strokeOpacity={0.9}
                label={{
                  value: `← ${c.name} nom.`,
                  fill: '#ef4444',
                  fontSize: 9,
                  position: 'insideTopLeft',
                  fontWeight: 'bold',
                }}
              />
            ))}

          {/* Fed chair first-meeting markers — orange line at first FOMC meeting */}
          {FED_CHAIR_CHANGES
            .filter(c => c.firstMeeting && c.firstMeeting >= data[0]?.date && c.firstMeeting <= data[data.length - 1]?.date)
            .map(c => (
              <ReferenceLine
                key={`chair-1st-${c.firstMeeting}`}
                x={snap(c.firstMeeting!)}
                stroke="#f97316"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.85}
                label={{
                  value: `↑ ${c.name} 1st`,
                  fill: '#f97316',
                  fontSize: 9,
                  position: 'insideTopRight',
                  fontWeight: 'bold',
                }}
              />
            ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Fed chairs list — nomination date + first meeting */}
      <div className="border-t border-border">
        <div className="px-3 py-2 bg-bg-input/50 border-b border-border flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
          <span className="text-xs font-semibold text-gray-200">Fed Chairs</span>
          <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border">
            {FED_CHAIR_CHANGES.length}
          </span>
        </div>
        <div className="divide-y divide-border max-h-56 overflow-y-auto">
          {chairsNewestFirst.map(c => (
            <div key={`chair-row-${c.date}`} className="flex items-start gap-2.5 px-3 py-2">
              <span className="inline-block w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: '#ef4444' }} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-gray-200">{c.name}</span>
                <p className="text-[11px] text-gray-500 leading-snug mt-0.5">
                  <span className="text-red-400/90 font-mono">Nominated {fmt(c.date)}</span>
                  {c.firstMeeting && (
                    <span className="text-orange-400/90 font-mono"> · 1st meeting {fmt(c.firstMeeting)}</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FOMC meeting dates list — newest first, future highlighted */}
      <div className="border-t border-border">
        <div className="px-3 py-2 bg-bg-input/50 border-b border-border flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
          <span className="text-xs font-semibold text-gray-200">FOMC Meetings</span>
          <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border">
            {FOMC_MEETING_DATES.length}
          </span>
        </div>
        <div className="divide-y divide-border max-h-56 overflow-y-auto">
          {meetingsNewestFirst.map(md => {
            const isFuture = md > today;
            return (
              <div key={`mtg-row-${md}`} className="flex items-center gap-2.5 px-3 py-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: isFuture ? '#3b82f6' : '#6b7280' }}
                />
                <span className={isFuture ? 'text-xs font-semibold text-blue-300' : 'text-xs text-gray-300'}>
                  {fmt(md)}
                </span>
                {isFuture && <span className="text-[10px] text-blue-400/70">upcoming</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
