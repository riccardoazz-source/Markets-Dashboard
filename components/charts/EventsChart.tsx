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
  ipo:          'Major IPOs',
  personal:     'Personal',
};

const CATEGORY_ORDER: MarketEventCategory[] = [
  'financial', 'war', 'terrorism', 'pandemic', 'geopolitical', 'crypto', 'ipo', 'personal',
];

// Monthly axis from `startYear` → today. Each category panel builds its own axis
// anchored ~1 year before its earliest event, so a category whose events all sit
// in (say) 2013+ doesn't get a huge empty stretch back to 1980, while the IPO
// panel can still reach back to Apple's 1980 listing.
function buildAxis(startYear: number): { date: string; v: number }[] {
  const data: { date: string; v: number }[] = [];
  const d = new Date(startYear, 0, 1);
  const axisEnd = new Date();
  while (d <= axisEnd) {
    data.push({ date: format(d, 'yyyy-MM-dd'), v: 0 });
    d.setMonth(d.getMonth() + 1);
  }
  return data;
}

// Earliest sensible axis start for a set of events: 1 year before the first event,
// clamped so empty categories still render a reasonable recent window.
function axisStartYear(events: { date: string }[]): number {
  if (events.length === 0) return new Date().getFullYear() - 5;
  const earliest = events.reduce((min, e) => (e.date < min ? e.date : min), events[0].date);
  return parseInt(earliest.slice(0, 4), 10) - 1;
}

function snapTo(axis: { date: string }[], target: string): string {
  const tt = parseISO(target).getTime();
  let best = axis[0]?.date ?? target, bestDiff = Infinity;
  for (const p of axis) {
    const diff = Math.abs(parseISO(p.date).getTime() - tt);
    if (diff < bestDiff) { bestDiff = diff; best = p.date; }
  }
  return best;
}

// One self-contained panel for a single category: chart + descriptive list.
function CategoryPanel({
  cat, events, height,
}: {
  cat: MarketEventCategory;
  events: MarketEvent[];
  height: number;
}) {
  const color = MARKET_EVENT_COLORS[cat];
  const axis = buildAxis(axisStartYear(events));
  const today = new Date().toISOString().slice(0, 10);
  const todaySnapped = snapTo(axis, today);
  const sorted = events.slice().sort((a, b) => a.date.localeCompare(b.date));
  const listRows = sorted.slice().reverse(); // newest first in the list

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-input/50 border-b border-border">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold text-gray-200">{CATEGORY_LABELS[cat]}</span>
        <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border">
          {events.length}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="px-3 py-4 text-[11px] text-gray-600 italic">
          No events in this group yet — add your own from the Sources tab.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={axis} margin={{ top: 24, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={v => { try { return format(parseISO(v as string), 'yyyy'); } catch { return v as string; } }}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={false} tickLine={false} minTickGap={36}
              />
              <YAxis hide domain={[0, 1]} />
              <Line dataKey="v" stroke="transparent" dot={false} isAnimationActive={false} />

              <ReferenceLine
                x={todaySnapped}
                stroke="#6b7280"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                label={{ value: 'Today', fill: '#9ca3af', fontSize: 9, position: 'insideTopLeft' }}
              />

              {sorted.map((evt, i) => (
                <ReferenceLine
                  key={`${evt.date}-${i}`}
                  x={snapTo(axis, evt.date)}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
                  label={{
                    value: evt.label,
                    fill: color,
                    fontSize: 9,
                    position: i % 2 === 0 ? 'insideTop' : 'insideBottom',
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Event list — date, label, description */}
          <div className="border-t border-border divide-y divide-border max-h-56 overflow-y-auto">
            {listRows.map((evt, i) => (
              <div key={`row-${evt.date}-${i}`} className="flex items-start gap-2.5 px-3 py-2">
                <span className="inline-block w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: color }} />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-200">{evt.label}</span>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {format(parseISO(evt.date), 'd MMM yyyy')}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{evt.description}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function EventsChart({ height = 200, category }: { height?: number; category?: MarketEventCategory }) {
  // When `category` is provided, show only that category's panel (used by per-indicator cards).
  // When undefined, show filter chips and all non-empty categories.
  const [activeCat, setActiveCat] = useState<MarketEventCategory | 'all'>(category ?? 'all');
  // Built-in curated list + the user's custom events (from the Sources tab).
  const [allEvents, setAllEvents] = useState<MarketEvent[]>(MARKET_EVENTS);

  useEffect(() => {
    const load = () => setAllEvents(getMergedMarketEvents());
    load();
    window.addEventListener('mkt-sources-changed', load);
    return () => window.removeEventListener('mkt-sources-changed', load);
  }, []);

  const byCat = (cat: MarketEventCategory) => allEvents.filter(e => e.category === cat);

  // In "all" mode show every non-empty category panel; when a category is
  // selected, show only that one (larger), even if empty.
  const categoriesToShow = activeCat === 'all'
    ? CATEGORY_ORDER.filter(c => byCat(c).length > 0)
    : [activeCat];

  const panelHeight = activeCat === 'all' ? height : Math.round(height * 1.4);

  // When locked to a specific category, skip filter chips
  if (category) {
    return (
      <div>
        <CategoryPanel cat={category} events={byCat(category)} height={height} />
      </div>
    );
  }

  return (
    <div>
      {/* Category filter chips */}
      <div className="flex gap-1.5 flex-wrap mb-3">
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
          const count = byCat(cat).length;
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

      {/* One separate panel per category */}
      <div className="space-y-3">
        {categoriesToShow.map(cat => (
          <CategoryPanel key={cat} cat={cat} events={byCat(cat)} height={panelHeight} />
        ))}
      </div>
    </div>
  );
}
