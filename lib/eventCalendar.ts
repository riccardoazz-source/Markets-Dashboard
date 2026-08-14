// ── The forward calendar: what is scheduled over the next six months ─────────
//
// Ported from the Macro Event app. Its design decision is worth keeping and worth
// stating: the dates are BUNDLED, not fetched. Free economic-calendar APIs are paywalled
// or slow and paid ones bill per request, while these dates are published officially a
// year ahead and almost never move — so shipping them is faster, more reliable and costs
// nothing. The only dynamic part is the WINDOW: the list is computed against the clock,
// so past entries drop off and the six months roll forward on their own.
//
// An event's `date` is an ABSOLUTE INSTANT in UTC. That matters more than it looks: an
// FOMC statement lands at 2pm in New York, which is 18:00 UTC in summer and 19:00 in
// winter. Storing the wall-clock time and a zone, and resolving it per date, is the only
// way both readings come out right — a fixed UTC offset is wrong for half the year.

export type CalendarCategory = 'central-bank' | 'economic-data' | 'geopolitical' | 'personal';

export interface CalendarEvent {
  id: string;
  title: string;
  category: CalendarCategory;
  /** Short region code shown on the card — 'US', 'EU', 'Global'… */
  region: string;
  flag: string;
  /** Absolute instant, ISO 8601 in UTC. */
  date: string;
  /** False → the card says "All day" instead of a time. */
  timeKnown: boolean;
  /** The date is expected but not yet confirmed by the publisher. */
  tentative?: boolean;
  description?: string;
  /** Bare domain of the official calendar the date came from. */
  source?: string;
}

export const CALENDAR_COLORS: Record<CalendarCategory, string> = {
  'central-bank':  '#6366f1',
  'economic-data': '#22c55e',
  geopolitical:    '#f87171',
  personal:        '#ec4899',
};

export const CALENDAR_LABELS: Record<CalendarCategory, string> = {
  'central-bank':  'Central Bank',
  'economic-data': 'Economic Data',
  geopolitical:    'Geopolitical',
  personal:        'Personal',
};

/**
 * A wall-clock time in a named zone, as a UTC instant.
 *
 * Written this way rather than with a fixed offset because the offset is not fixed: 14:00
 * in New York is 18:00Z from March to November and 19:00Z the rest of the year, and an
 * FOMC calendar spans both. Intl knows the rule for every date, so nothing has to be
 * maintained here when the changeover dates move.
 */
export function zonedTimeToUtc(day: string, hour: number, minute: number, timeZone: string): string {
  // Guess the instant as if the wall clock were UTC, then measure how far that guess is
  // from the target zone and correct by exactly that much. One correction is enough
  // except within the changeover hour itself, so it is applied twice.
  let ms = Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
    // What that instant reads as on the zone's clock, expressed as a UTC instant.
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    const target = Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
    if (asUtc === target) break;
    ms += target - asUtc;
  }
  return new Date(ms).toISOString();
}

/** The six-month window, computed against the clock — see the header. */
export function upcomingEvents(events: CalendarEvent[], now: Date = new Date(), months = 6): CalendarEvent[] {
  const from = now.getTime();
  const until = new Date(now.getTime());
  until.setMonth(until.getMonth() + months);
  const to = until.getTime();
  return events
    .filter(e => {
      const t = Date.parse(e.date);
      return isFinite(t) && t >= from && t <= to;
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** Grouped by calendar day IN THE VIEWER'S ZONE, which is the day they will call it. */
export function groupByDay(events: CalendarEvent[], timeZone?: string): { day: string; events: CalendarEvent[] }[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const out: { day: string; events: CalendarEvent[] }[] = [];
  for (const e of events) {
    const day = fmt.format(new Date(e.date));
    const last = out[out.length - 1];
    if (last && last.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}

/** "in 3 weeks", "tomorrow", "in 5 months" — the countdown on each card. */
export function countdown(date: string, now: Date = new Date()): string {
  const days = Math.round((Date.parse(date) - now.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30.44)} months`;
}
