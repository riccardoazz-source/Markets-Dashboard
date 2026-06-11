'use client';

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { MARKET_EVENTS, MARKET_EVENT_COLORS, MarketEventCategory, MarketEvent } from '@/lib/config';
import { getMergedMarketEvents } from '@/lib/userSources';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

const CATEGORY_LABELS: Record<MarketEventCategory, string> = {
  financial:    'Financial Crisis',
  war:          'War / Conflict',
  terrorism:    'Terrorism',
  pandemic:     'Pandemic',
  geopolitical: 'Geopolitical',
  crypto:       'Crypto',
  personal:     'Personal',
};

const CATEGORY_ORDER: MarketEventCategory[] = [
  'financial', 'war', 'terrorism', 'pandemic', 'geopolitical', 'crypto', 'personal',
];

export function EventsChart({ height = 300 }: { height?: number }) {
  const [activeCat, setActiveCat] = useState<MarketEventCategory | 'all'>('all');
  // Built-in curated list + the user's custom events (from the Sources tab).
  const [allEvents, setAllEvents] = useState<MarketEvent[]>(MARKET_EVENTS);

  useEffect(() => {
    const load = () => setAllEvents(getMergedMarketEvents());
    load();
    window.addEventListener('mkt-sources-changed', load);
    return () => window.removeEventListener('mkt-sources-changed', load);
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  // Events for the selected category, sorted newest-first for the list.
  const visibleEvents = (activeCat === 'all'
    ? allEvents
    : allEvents.filter(e => e.category === activeCat)
  ).slice().sort((a, b) => b.date.localeCompare(a.date));

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

  // Inline labels only when a single category is selected (few enough lines to read).
  const showLabels = activeCat !== 'all' && visibleEvents.length <= 16;
  const positions = ['insideTop', 'insideBottom'] as const;

  return (
    <div>
      {/* Category filter chips */}
      <div className="flex gap-1.5 flex-wrap mb-2">
        <button
          onClick={() => setActiveCat('all')}
          className={clsx(
            'px-2.5 py-1 text-[11px] font-semibold rounded-full transition-all',
            activeCat === 'all'
              ? 'bg-accent text-white'
              : 'text-gray-400 border border-border hover:text-gray-200 hover:border-border-light'
          )}
        >
          All ({allEvents.length})
        </button>
        {CATEGORY_ORDER.map(cat => {
          const count = allEvents.filter(e => e.category === cat).length;
          const isActive = activeCat === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={clsx(
                'px-2.5 py-1 text-[11px] font-semibold rounded-full transition-all border flex items-center gap-1.5',
                isActive
                  ? 'text-white border-transparent'
                  : 'text-gray-400 border-border hover:text-gray-200 hover:border-border-light'
              )}
              style={isActive ? { backgroundColor: MARKET_EVENT_COLORS[cat] } : undefined}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: MARKET_EVENT_COLORS[cat] }}
              />
              {CATEGORY_LABELS[cat]} ({count})
            </button>
          );
        })}
      </div>

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

          {visibleEvents.map((evt, i) => {
            const color = MARKET_EVENT_COLORS[evt.category];
            return (
              <ReferenceLine
                key={`${evt.date}-${i}`}
                x={snap(evt.date)}
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={0.85}
                label={showLabels ? {
                  value: evt.label,
                  fill: color,
                  fontSize: 9,
                  position: positions[i % 2],
                } : undefined}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      {/* Event list — date, label and description so each line is identifiable */}
      <div className="mt-3 border border-border rounded-lg divide-y divide-border max-h-72 overflow-y-auto">
        {visibleEvents.map((evt, i) => (
          <div key={`row-${evt.date}-${i}`} className="flex items-start gap-2.5 px-3 py-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0"
              style={{ backgroundColor: MARKET_EVENT_COLORS[evt.category] }}
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-200">{evt.label}</span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {format(parseISO(evt.date), 'd MMM yyyy')}
                </span>
                <span className="text-[10px] text-gray-600">{CATEGORY_LABELS[evt.category]}</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{evt.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
