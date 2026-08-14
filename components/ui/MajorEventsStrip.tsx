'use client';

// The next six months, on the landing page.
//
// Same shape as the Macro Event app it is ported from: grouped by day, soonest first,
// a live countdown on every card, times in the viewer's own zone. Past entries drop off
// on their own because the window is computed against the clock rather than stored.
//
// Times are shown in the READER'S zone, not hardcoded to Rome. The stored instant is
// UTC, so Intl does the conversion and it stays right in any zone and on either side of
// a daylight-saving changeover — which matters here, because the FOMC's 2pm in New York
// is an hour apart in UTC between the September and December meetings.

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarClock, Clock } from 'lucide-react';
import {
  upcomingEvents, groupByDay, countdown,
  CALENDAR_COLORS, CALENDAR_LABELS, type CalendarEvent,
} from '@/lib/eventCalendar';
import { BUNDLED_EVENTS } from '@/lib/eventCalendarData';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function EventCard({ e, now }: { e: CalendarEvent; now: Date }) {
  const color = CALENDAR_COLORS[e.category];
  const time = e.timeKnown
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(e.date))
    : null;
  return (
    <div className="rounded-xl border border-border bg-bg-card overflow-hidden flex">
      {/* The category as a colour bar rather than a second badge — it reads at a glance
          down a list without spending a line of text on every card. */}
      <span className="w-1 shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0 p-2.5 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: `${color}1f`, color }}>
            <span>{e.flag}</span>{CALENDAR_LABELS[e.category]}
          </span>
          <span className="ml-auto text-[10px] text-gray-400 border border-border rounded-full px-2 py-0.5 whitespace-nowrap">
            {countdown(e.date, now)}
          </span>
        </div>
        <p className="text-sm font-semibold text-gray-100 leading-snug">{e.title}</p>
        {e.description && <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{e.description}</p>}
        <div className="flex items-center gap-2 flex-wrap text-[10px]">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-gray-300 tabular-nums">
            <Clock size={10} />{time ?? 'All day'}
          </span>
          <span className="text-gray-600">{e.region}</span>
          {e.tentative && (
            <span className="px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-400">tentative</span>
          )}
          {e.source && <span className="ml-auto text-gray-700">{e.source}</span>}
        </div>
      </div>
    </div>
  );
}

export function MajorEventsStrip({ months = 6, max = 8 }: { months?: number; max?: number }) {
  // The window depends on the clock, so it is resolved after mount: rendering it on the
  // server would bake in the build machine's "now" and hydrate against a different list.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // Re-read hourly so a countdown cannot sit at "in 2 days" for a week on a tab left
    // open, and so an event that has just passed drops off without a reload.
    const t = setInterval(() => setNow(new Date()), 3_600_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => {
    if (!now) return [];
    const list = upcomingEvents(BUNDLED_EVENTS, now, months).slice(0, max);
    return groupByDay(list, zone());
  }, [now, months, max]);

  if (!now || !days.length) return null;

  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      .format(new Date(`${d}T12:00:00Z`)).toUpperCase();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock size={13} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-200">What&apos;s ahead</h2>
        <span className="text-[10px] text-gray-600">next {months} months · times in {zone()}</span>
      </div>

      <div className="space-y-3">
        {days.map(({ day, events }) => (
          <div key={day} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-wider text-gray-500">{dayLabel(day)}</span>
              <span className="flex-1 h-px bg-border" />
            </div>
            <div className={clsx('grid gap-2', events.length > 1 && 'md:grid-cols-2')}>
              {events.map(e => <EventCard key={e.id} e={e} now={now} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
