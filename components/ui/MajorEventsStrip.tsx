'use client';

// Major events, on the landing page — what is coming and what just happened.
//
// Reads getMergedMarketEvents(), the SAME list the Events chart and the Compare overlay
// draw from, so an event added by hand in Sources appears here too and nothing has to be
// kept in step. The colours are MARKET_EVENT_COLORS, shared for the same reason.
//
// Ordering is by DISTANCE FROM TODAY, not by date: the next thing due and the thing that
// just happened both matter on a landing page, and a plain chronological list buries
// whichever side of today has fewer entries. Upcoming ones come first because they are
// the ones that can still be acted on.

import { useMemo, useState, useEffect } from 'react';
import clsx from 'clsx';
import { CalendarClock, ExternalLink } from 'lucide-react';
import { MARKET_EVENT_COLORS, type MarketEventCategory } from '@/lib/config';
import { getMergedMarketEvents, notifySourcesChanged, type MarketEvent } from '@/lib/userSources';

/** Whole days between two dates, positive when `date` is in the future. */
function daysFromToday(date: string, todayMs: number): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - todayMs) / 86_400_000);
}

function whenLabel(days: number): string {
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit =
    n < 31 ? `${n} day${n === 1 ? '' : 's'}` :
    n < 365 ? `${Math.round(n / 30.44)} month${Math.round(n / 30.44) === 1 ? '' : 's'}` :
    `${(n / 365.25).toFixed(n < 730 ? 1 : 0)} year${n < 730 ? '' : 's'}`;
  return days > 0 ? `in ${unit}` : `${unit} ago`;
}

export function MajorEventsStrip({ upcoming = 3, recent = 5 }: { upcoming?: number; recent?: number }) {
  // The merged list reads localStorage, so it can only be built after mount — rendering
  // it during SSR would hydrate with a different list the moment a custom event exists.
  const [events, setEvents] = useState<MarketEvent[] | null>(null);
  useEffect(() => {
    const read = () => setEvents(getMergedMarketEvents());
    read();
    window.addEventListener('mkt-sources-changed', read);
    return () => window.removeEventListener('mkt-sources-changed', read);
  }, []);

  const shown = useMemo(() => {
    if (!events) return [];
    // Midnight UTC today, so every card's "in N days" is stable through the session
    // instead of shifting by one as the clock passes a boundary mid-render.
    const today = new Date();
    const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const withDays = events.map(e => ({ ...e, days: daysFromToday(e.date, todayMs) }));
    const ahead = withDays.filter(e => e.days >= 0).sort((a, b) => a.days - b.days).slice(0, upcoming);
    const behind = withDays.filter(e => e.days < 0).sort((a, b) => b.days - a.days).slice(0, recent);
    return [...ahead, ...behind];
  }, [events, upcoming, recent]);

  if (!events) return null;          // pre-mount: nothing rather than a flash of the wrong list
  if (!shown.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock size={13} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-200">Major events</h2>
        <span className="text-[10px] text-gray-600">what is coming, and what just happened</span>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {shown.map(e => {
          const color = MARKET_EVENT_COLORS[e.category as MarketEventCategory] ?? '#6b7280';
          const future = e.days >= 0;
          return (
            <div
              key={`${e.date}-${e.label}`}
              title={e.description}
              className={clsx(
                'shrink-0 w-[190px] rounded-xl border bg-bg-card p-2.5 space-y-1',
                // The ones still ahead are the ones that can be acted on, so they carry
                // their category's colour on the border; past ones sit back.
                future ? 'border-transparent' : 'border-border',
              )}
              style={future ? { borderColor: `${color}66` } : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[9px] uppercase tracking-wider text-gray-500 leading-none">{e.category}</span>
                {future && (
                  <span className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                    style={{ backgroundColor: `${color}22`, color }}>
                    ahead
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-gray-100 leading-snug line-clamp-2">{e.label}</p>
              <p className="text-[10px] text-gray-500 tabular-nums">
                {e.date} · <span className={future ? 'text-gray-300' : ''}>{whenLabel(e.days)}</span>
              </p>
              <p className="text-[10px] text-gray-600 leading-snug line-clamp-2">{e.description}</p>
              {e.source && (
                <a href={e.source} target="_blank" rel="noopener noreferrer"
                  onClick={ev => ev.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[9px] text-gray-600 hover:text-accent">
                  source <ExternalLink size={9} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Re-exported so a caller that adds an event can refresh every mounted strip.
export { notifySourcesChanged };
