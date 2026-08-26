// ── The bundled calendar: official published schedules ───────────────────────
//
// Ported from the Macro Event app. These are NOT guesses: they are the regularly
// published official calendars (Fed/FOMC, ECB, BoJ, BoE) plus the top-tier US data
// releases, and the major scheduled geopolitical dates, each verified against the source
// named on its card. They almost never change, so they ship with the app and render with
// no network call at all. The rolling window filters them against the clock, so past
// entries drop off on their own.
//
// Times are stored as absolute UTC instants. Every one of them is CHECKED by `npm run
// vet` against the wall-clock time it is meant to represent in its own zone — 14:00 in
// New York for the FOMC, 14:15 in Frankfurt for the ECB, 08:30 in New York for CPI and
// payrolls. That check exists because the offsets here are written by hand and change
// mid-calendar: the October FOMC is 18:00Z and the December one 19:00Z, and a single
// wrong hour is invisible on the page.
//
// HOW TO UPDATE (roughly once a year, when the new official calendars publish):
//   • FOMC:  federalreserve.gov/monetarypolicy/fomccalendars.htm  (14:00 ET)
//   • ECB:   ecb.europa.eu (Governing Council monetary policy meetings, 14:15 CET)
//   • BoJ:   boj.or.jp (Monetary Policy Meetings)
//   • BoE:   bankofengland.co.uk (MPC dates, 12:00 London)
//   • US CPI / Jobs: bls.gov/schedule/news_release (08:30 ET)
//   • Summits and elections: add only what can be verified, with its source.
// Add the next year's dates and the rolling six-month window keeps working.

import type { CalendarEvent } from './eventCalendar';

export const CALENDAR_LAST_VERIFIED = '2026-06';
export const GEOPOLITICAL_LAST_VERIFIED = '2026-06';

const US = { region: 'US', flag: '🇺🇸' };
const EU = { region: 'Eurozone', flag: '🇪🇺' };
const JP = { region: 'Japan', flag: '🇯🇵' };
const UK = { region: 'UK', flag: '🇬🇧' };

type Meta = { region: string; flag: string };

// Current policy rates are deliberately NOT hardcoded: the Macro tab already fetches them
// live, so a card showing one would be reading a second, staler copy of a number this app
// already has.

function make(
  meta: Meta,
  title: string,
  category: CalendarEvent['category'],
  date: string,
  opts: Partial<CalendarEvent> = {},
): CalendarEvent {
  const id = `cal-${title}-${date}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
  return { id, title, category, region: meta.region, flag: meta.flag, date, timeKnown: true, ...opts };
}

// ── Central bank decisions ───────────────────────────────────────────────────
const fomc = (date: string) =>
  make(US, 'FOMC Rate Decision & Press Conference', 'central-bank', date, {
    description: 'Federal Reserve interest rate decision (press conference 30 min later).',
    source: 'federalreserve.gov',
  });
const ecb = (date: string) =>
  make(EU, 'ECB Monetary Policy Decision', 'central-bank', date, {
    description: 'ECB Governing Council rate decision, followed by a press conference.',
    source: 'ecb.europa.eu',
  });
const boe = (date: string) =>
  make(UK, 'Bank of England Rate Decision', 'central-bank', date, {
    description: 'BoE Monetary Policy Committee bank rate decision.',
    source: 'bankofengland.co.uk',
  });
const boj = (date: string) =>
  make(JP, 'Bank of Japan Monetary Policy Decision', 'central-bank', date, {
    description: 'BoJ policy rate decision; exact release time varies.',
    source: 'boj.or.jp',
    timeKnown: false,
  });

// ── US data releases ─────────────────────────────────────────────────────────
// Marked tentative: the BLS publishes the schedule ahead, but a release date can still
// shift, and saying so is better than presenting a guess as fixed.
const cpi = (date: string) =>
  make(US, 'US CPI Inflation Report', 'economic-data', date, {
    description: 'US Consumer Price Index (inflation).',
    source: 'bls.gov',
    tentative: true,
  });
const nfp = (date: string) =>
  make(US, 'US Non-Farm Payrolls (Jobs Report)', 'economic-data', date, {
    // Named explicitly: the unemployment rate is published INSIDE this release, and
    // looking for it under its own name is the obvious way to conclude it is missing.
    description: 'Monthly US employment report — payrolls, the unemployment rate and average hourly earnings.',
    source: 'bls.gov',
    tentative: true,
  });
// BEA "Personal Income and Outlays" — the release that carries the PCE price index, and
// with it core PCE, the gauge the FOMC's 2% objective is actually defined on. It lands at
// the END of the month, four weeks after the reference month, which is why a calendar
// built around the mid-month CPI can look empty on the day the Fed's own inflation number
// comes out. Titled so that searching for either name finds it.
const pce = (date: string) =>
  make(US, 'US Core PCE Inflation (Personal Income & Outlays)', 'economic-data', date, {
    description: 'BEA personal income and outlays — carries the PCE price index and core PCE, the inflation gauge the Federal Reserve targets. The quarterly GDP estimate is often released the same morning.',
    source: 'bea.gov',
    tentative: true,
  });

export const CALENDAR_EVENTS: CalendarEvent[] = [
  // FOMC 2026 — 14:00 ET (18:00Z on EDT, 19:00Z on EST)
  fomc('2026-06-17T18:00:00Z'),
  fomc('2026-07-29T18:00:00Z'),
  fomc('2026-09-16T18:00:00Z'),
  fomc('2026-10-28T18:00:00Z'),
  fomc('2026-12-09T19:00:00Z'),

  // ECB 2026 — 14:15 Frankfurt (12:15Z on CEST, 13:15Z on CET)
  ecb('2026-06-18T12:15:00Z'),
  ecb('2026-07-30T12:15:00Z'),
  ecb('2026-09-17T12:15:00Z'),
  ecb('2026-10-29T13:15:00Z'),
  ecb('2026-12-17T13:15:00Z'),

  // Bank of England 2026 — 12:00 London (11:00Z on BST, 12:00Z on GMT)
  boe('2026-06-18T11:00:00Z'),
  boe('2026-08-06T11:00:00Z'),
  boe('2026-09-17T11:00:00Z'),
  boe('2026-11-05T12:00:00Z'),
  boe('2026-12-17T12:00:00Z'),

  // Bank of Japan 2026 — around midday JST; Japan keeps no daylight saving
  boj('2026-07-31T03:00:00Z'),
  boj('2026-09-18T03:00:00Z'),
  boj('2026-10-30T03:00:00Z'),
  boj('2026-12-18T03:00:00Z'),

  // US CPI 2026 — 08:30 ET (12:30Z on EDT, 13:30Z on EST)
  cpi('2026-07-14T12:30:00Z'),
  cpi('2026-08-12T12:30:00Z'),
  cpi('2026-09-11T12:30:00Z'),
  cpi('2026-10-13T12:30:00Z'),
  cpi('2026-11-18T13:30:00Z'),
  cpi('2026-12-10T13:30:00Z'),

  // US Non-Farm Payrolls 2026 — first Friday, 08:30 ET
  nfp('2026-07-03T12:30:00Z'),
  nfp('2026-08-07T12:30:00Z'),
  nfp('2026-09-04T12:30:00Z'),
  nfp('2026-10-02T12:30:00Z'),
  nfp('2026-11-06T13:30:00Z'),
  nfp('2026-12-04T13:30:00Z'),

  // ── Core PCE / Personal Income & Outlays — 08:30 ET, last week of the month ──
  //
  // THESE DAYS ARE NOT VERIFIED against bea.gov and are the least certain entries in this
  // file. They are placed on the BEA's usual cadence — the release for month M lands in
  // the last week of month M+1 — anchored on the one date known to be right: the July 2026
  // report came out on Wednesday 26 August 2026. December and November are pulled earlier
  // in the week, as the BEA does around Thanksgiving and Christmas.
  //
  // They ship `tentative`, which the card renders, so the page never presents them as
  // fixed. Replace them with the published schedule when checking this file next:
  //   bea.gov/news/schedule
  pce('2026-09-25T12:30:00Z'),
  pce('2026-10-30T12:30:00Z'),
  pce('2026-11-25T13:30:00Z'),
  pce('2026-12-23T13:30:00Z'),
  pce('2027-01-29T13:30:00Z'),
  pce('2027-02-26T13:30:00Z'),
];

// ── Geopolitical ─────────────────────────────────────────────────────────────
// Multi-day summits have no fixed hour, so they are day-only and shown on their start
// day rather than given a time nobody published.
function geo(
  title: string, flag: string, region: string, date: string,
  description: string, source: string, opts: Partial<CalendarEvent> = {},
): CalendarEvent {
  const id = `geo-${title}-${date}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
  return { id, title, category: 'geopolitical', region, flag, date, timeKnown: false, description, source, ...opts };
}

export const GEOPOLITICAL_EVENTS: CalendarEvent[] = [
  geo("G7 Leaders' Summit (Évian)", '🇫🇷', 'Global', '2026-06-17T08:00:00Z',
    'G7 heads-of-state summit in Évian-les-Bains, France (15–17 June).', 'consilium.europa.eu'),
  geo('NATO Summit (Ankara)', '🇹🇷', 'Global', '2026-07-07T08:00:00Z',
    'NATO heads-of-state summit in Ankara, Turkey (7–8 July).', 'nato.int'),
  geo('BRICS Summit (New Delhi)', '🇮🇳', 'Global', '2026-09-12T08:00:00Z',
    "18th BRICS leaders' summit in New Delhi, India (12–13 September).", 'en.wikipedia.org'),
  geo('UN General Assembly — General Debate', '🌐', 'Global', '2026-09-22T08:00:00Z',
    'UNGA 81 high-level week opens; world leaders address the Assembly (22–28 September).', 'un.org'),
  geo('US Midterm Elections', '🇺🇸', 'US', '2026-11-03T08:00:00Z',
    'US Congressional midterms — full House and one-third of the Senate.', 'Public record'),
  geo('COP31 Climate Conference (Antalya)', '🇹🇷', 'Global', '2026-11-09T08:00:00Z',
    'UN Climate Change Conference in Antalya, Turkey (9–20 November).', 'en.wikipedia.org'),
  geo("APEC Economic Leaders' Meeting (Shenzhen)", '🇨🇳', 'Global', '2026-11-18T08:00:00Z',
    "APEC leaders' summit in Shenzhen, China (18–19 November).", 'apec.org'),
  geo("G20 Leaders' Summit (Miami)", '🇺🇸', 'Global', '2026-12-14T08:00:00Z',
    'G20 heads-of-state summit at Miami, USA (14–15 December).', 'state.gov'),
];

/**
 * Everything that ships, plus the curated one-offs this app already held (a scheduled
 * IPO, a dated election) that fall in the future. The two lists are kept separate above
 * so each stays a straight copy of its official source.
 */
export const BUNDLED_EVENTS: CalendarEvent[] = [...CALENDAR_EVENTS, ...GEOPOLITICAL_EVENTS];
