'use client';

// The next six months, on the landing page.
//
// A horizontal rail rather than a vertical list: on a landing page this is context, not
// the main event, and a list long enough to hold six months of releases pushes everything
// under it off the screen. Scrolling sideways keeps the whole thing to one band.
//
// Times render in the READER'S zone, not hardcoded to Rome. The stored instant is UTC, so
// Intl converts, and it stays right on either side of a daylight-saving changeover —
// which matters here: the FOMC's 2pm in New York is an hour apart in UTC between the
// September and December meetings.
//
// Personal entries live on the shared gist beside the pins, so they follow the same
// personal code as everything else. Past ones are not deleted — the window hides them —
// because quietly destroying something the user typed when a date goes by is the wrong
// trade.

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarClock, Clock, Plus, X } from 'lucide-react';
import {
  upcomingEvents, countdown,
  CALENDAR_COLORS, CALENDAR_LABELS, type CalendarEvent,
} from '@/lib/eventCalendar';
import { BUNDLED_EVENTS } from '@/lib/eventCalendarData';
import { useCalendarEvents } from '@/lib/gist';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function EventCard({ e, now, onDelete }: { e: CalendarEvent; now: Date; onDelete?: () => void }) {
  const color = CALENDAR_COLORS[e.category];
  const d = new Date(e.date);
  const time = e.timeKnown
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    : null;
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short' }).format(d);
  return (
    <div className="relative shrink-0 w-[230px] rounded-xl border border-border bg-bg-card overflow-hidden flex">
      {/* The category as a colour bar — readable down a rail without spending a line of
          text on every card. */}
      <span className="w-1 shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0 p-2.5 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap"
            style={{ backgroundColor: `${color}1f`, color }}>
            <span>{e.flag}</span>{CALENDAR_LABELS[e.category]}
          </span>
          <span className="ml-auto text-[9px] text-gray-400 border border-border rounded-full px-1.5 py-0.5 whitespace-nowrap">
            {countdown(e.date, now)}
          </span>
        </div>
        <p className="text-[11px] font-bold text-gray-300 tabular-nums uppercase tracking-wide">{day}</p>
        <p className="text-xs font-semibold text-gray-100 leading-snug line-clamp-2">{e.title}</p>
        {e.description && <p className="text-[10px] text-gray-600 leading-snug line-clamp-2">{e.description}</p>}
        <div className="flex items-center gap-1.5 flex-wrap text-[9px] pt-0.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-gray-300 tabular-nums">
            <Clock size={9} />{time ?? 'All day'}
          </span>
          <span className="text-gray-600">{e.region}</span>
          {e.tentative && (
            <span className="px-1 py-0.5 rounded border border-amber-500/40 text-amber-400">tentative</span>
          )}
          {e.source && <span className="ml-auto text-gray-700 truncate max-w-[80px]">{e.source}</span>}
        </div>
      </div>
      {onDelete && (
        <button onClick={onDelete} title="Remove this event"
          className="absolute top-1 right-1 p-0.5 rounded text-gray-700 hover:text-red-400">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function AddCard({ onAdd, onCancel }: {
  onAdd: (e: { title: string; date: string; timeKnown: boolean }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const save = () => {
    if (!title.trim() || !day) return;
    // A time typed here is a LOCAL wall-clock time, so it is converted to the instant it
    // names before being stored — everything on this rail is an absolute instant, and a
    // personal entry that drifted with the reader's zone would be the odd one out.
    const iso = time ? new Date(`${day}T${time}`).toISOString() : `${day}T12:00:00.000Z`;
    onAdd({ title: title.trim(), date: iso, timeKnown: !!time });
    setTitle(''); setDay(''); setTime('');
  };
  return (
    <div className="shrink-0 w-[230px] rounded-xl border border-accent/40 bg-bg-card p-2.5 space-y-1.5">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Earnings call, meeting…"
        autoFocus
        className="w-full bg-white/5 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 outline-none focus:ring-1 focus:ring-accent" />
      <div className="flex gap-1.5">
        <input type="date" value={day} onChange={e => setDay(e.target.value)}
          className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-[11px] text-gray-100 outline-none focus:ring-1 focus:ring-accent" />
        <input type="time" value={time} onChange={e => setTime(e.target.value)}
          title="Leave empty for an all-day entry"
          className="w-[86px] bg-white/5 rounded px-2 py-1 text-[11px] text-gray-100 outline-none focus:ring-1 focus:ring-accent" />
      </div>
      <div className="flex gap-1.5">
        <button onClick={save} disabled={!title.trim() || !day}
          className="flex-1 px-2 py-1 rounded bg-accent text-white text-[11px] font-semibold disabled:opacity-40">
          Add
        </button>
        <button onClick={onCancel}
          className="px-2 py-1 rounded border border-border text-gray-400 text-[11px] hover:text-gray-200">
          Cancel
        </button>
      </div>
      <p className="text-[9px] text-gray-600 leading-snug">
        Saved with your personal code, so it follows you across devices. No time → all day.
      </p>
    </div>
  );
}

export function MajorEventsStrip({ months = 6 }: { months?: number }) {
  // The window depends on the clock, so it resolves after mount: rendering it on the
  // server would bake in the build machine's "now" and hydrate against a different list.
  const [now, setNow] = useState<Date | null>(null);
  const [adding, setAdding] = useState(false);
  const { events: personal, addEvent, removeEvent } = useCalendarEvents();

  useEffect(() => {
    setNow(new Date());
    // Re-read hourly so a countdown cannot sit at "in 2 days" for a week on a tab left
    // open, and so an event that has just passed drops off without a reload.
    const t = setInterval(() => setNow(new Date()), 3_600_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    if (!now) return [];
    const mine: CalendarEvent[] = personal.map(p => ({
      id: p.id, title: p.title, category: 'personal' as const,
      region: 'Mine', flag: '📌', date: p.date, timeKnown: p.timeKnown, description: p.description,
    }));
    return upcomingEvents([...BUNDLED_EVENTS, ...mine], now, months);
  }, [now, months, personal]);

  if (!now) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock size={13} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-200">What&apos;s ahead</h2>
        <span className="text-[10px] text-gray-600 hidden sm:inline">
          next {months} months · {zone()}
        </span>
        <button onClick={() => setAdding(a => !a)}
          className={clsx('ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-colors',
            adding ? 'border-accent text-accent' : 'border-border text-gray-400 hover:text-gray-200 hover:border-accent/50')}>
          <Plus size={12} /> Add
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {adding && <AddCard onAdd={e => { addEvent({ ...e }); setAdding(false); }} onCancel={() => setAdding(false)} />}
        {shown.map(e => (
          <EventCard key={e.id} e={e} now={now}
            onDelete={e.category === 'personal' ? () => removeEvent(e.id) : undefined} />
        ))}
        {!shown.length && !adding && (
          <p className="text-[11px] text-gray-600 py-3">Nothing scheduled in the next {months} months.</p>
        )}
      </div>
    </div>
  );
}
