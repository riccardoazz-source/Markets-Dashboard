'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { MARKET_EVENTS, MARKET_EVENT_COLORS, MarketEventCategory } from '@/lib/config';
import { format, parseISO } from 'date-fns';

const CATEGORY_LABELS: Record<MarketEventCategory, string> = {
  financial:    'Financial Crisis',
  war:          'War / Conflict',
  terrorism:    'Terrorism',
  pandemic:     'Pandemic',
  geopolitical: 'Geopolitical',
  crypto:       'Crypto',
};

export function EventsChart({ height = 300 }: { height?: number }) {
  const today = new Date().toISOString().slice(0, 10);

  // Monthly axis from Jan 2000 → today
  const data: { date: string; v: number }[] = [];
  const d = new Date(2000, 0, 1);
  const axisEnd = new Date();
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

  // Stagger labels: alternate insideTop and insideBottom to reduce overlap
  const positions = ['insideTop', 'insideBottom'] as const;

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 28, right: 14, left: 0, bottom: 0 }}>
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

          {MARKET_EVENTS.map((evt, i) => {
            const color = MARKET_EVENT_COLORS[evt.category];
            const pos = positions[i % 2];
            return (
              <ReferenceLine
                key={`${evt.date}-${i}`}
                x={snap(evt.date)}
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={0.85}
                label={{
                  value: evt.label,
                  fill: color,
                  fontSize: 8,
                  position: pos,
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-2">
        {(Object.entries(CATEGORY_LABELS) as [MarketEventCategory, string][]).map(([cat, label]) => (
          <div key={cat} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-0.5 rounded-full"
              style={{ backgroundColor: MARKET_EVENT_COLORS[cat] }}
            />
            <span className="text-[10px] text-gray-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
