'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { FED_CHAIR_CHANGES } from '@/lib/config';
import { format, parseISO } from 'date-fns';

/**
 * Fed chair timeline on a continuous monthly axis. For each chair two markers
 * are drawn: the nomination date (red dashed) and the first FOMC meeting as
 * chair (orange). A descriptive list mirrors the EventsChart pattern.
 */
export function FedChairsChart({ height = 240 }: { height?: number }) {
  const today = new Date().toISOString().slice(0, 10);

  // Axis from the first chair's nomination → last firstMeeting/nomination (or today).
  const allDates = FED_CHAIR_CHANGES.flatMap(c => c.firstMeeting ? [c.date, c.firstMeeting] : [c.date]);
  const firstDate = allDates.reduce((m, d) => (d < m ? d : m), allDates[0]);
  const lastDate = allDates.reduce((m, d) => (d > m ? d : m), allDates[0]);
  const axisEnd = lastDate > today ? new Date(lastDate + 'T12:00:00Z') : new Date();
  const data: { date: string; v: number }[] = [];
  const d = new Date(parseInt(firstDate.slice(0, 4), 10), 0, 1);
  while (d <= axisEnd) {
    data.push({ date: format(d, 'yyyy-MM-dd'), v: 0 });
    d.setMonth(d.getMonth() + 1);
  }

  const snap = (target: string): string => {
    const tt = parseISO(target).getTime();
    let best = data[0]?.date ?? target, bestDiff = Infinity;
    for (const p of data) {
      const diff = Math.abs(parseISO(p.date).getTime() - tt);
      if (diff < bestDiff) { bestDiff = diff; best = p.date; }
    }
    return best;
  };

  const todaySnapped = snap(today);
  const fmt = (s: string) => { try { return format(parseISO(s), 'd MMM yyyy'); } catch { return s; } };
  const chairsNewestFirst = FED_CHAIR_CHANGES.slice().reverse();

  // Label only recent chairs on the chart to avoid overlap (older ones are dense).
  const labelFromYear = 1990;

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
          <Line dataKey="v" stroke="transparent" dot={false} isAnimationActive={false} />

          {/* Today marker */}
          <ReferenceLine
            x={todaySnapped}
            stroke="#6b7280"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            label={{ value: 'Today', fill: '#9ca3af', fontSize: 9, position: 'insideTopLeft' }}
          />

          {/* Nomination markers — red dashed */}
          {FED_CHAIR_CHANGES.map(c => {
            const showLabel = parseInt(c.date.slice(0, 4), 10) >= labelFromYear;
            return (
              <ReferenceLine
                key={`nom-${c.date}`}
                x={snap(c.date)}
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="5 2"
                strokeOpacity={0.9}
                label={showLabel ? {
                  value: `← ${c.name} nom.`,
                  fill: '#ef4444', fontSize: 9, position: 'insideTopLeft', fontWeight: 'bold',
                } : undefined}
              />
            );
          })}

          {/* First-meeting markers — orange */}
          {FED_CHAIR_CHANGES.filter(c => c.firstMeeting).map(c => (
            <ReferenceLine
              key={`first-${c.firstMeeting}`}
              x={snap(c.firstMeeting!)}
              stroke="#f97316"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              strokeOpacity={0.85}
              label={{
                value: `↑ ${c.name} 1st`,
                fill: '#f97316', fontSize: 9, position: 'insideTopRight', fontWeight: 'bold',
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border bg-bg-input/30 text-[10px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px]" style={{ backgroundColor: '#ef4444' }} /> Nomination
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px]" style={{ backgroundColor: '#f97316' }} /> First FOMC meeting
        </span>
      </div>

      {/* Chair list — nomination + first meeting */}
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
    </div>
  );
}
