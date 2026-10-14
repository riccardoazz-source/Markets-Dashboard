// ── When the hand-typed calendar and the live feed disagree ──────────────────
//
// The app carries two calendars. One is bundled: a list of release dates typed into
// eventCalendarData.ts, which renders with no network call and is therefore what the page
// shows first. The other is a live economic calendar, refreshed on a schedule.
//
// The bundled list goes wrong in exactly one way, quietly: a date drifts by a day. The
// October 2026 CPI was stored as the 13th and released on the 14th, so the card expired on
// the morning of CPI day and the page showed nothing at all on the one day it mattered.
// The hour was right. Only the day was out — which is invisible until the day arrives.
//
// Nothing could catch that, because the live feed was never wired in. This module is the
// join: when both calendars describe the same release, the LIVE DATE WINS and the bundled
// entry keeps everything else.
//
// Why keep the bundled entry at all, rather than just showing the live row? Because the
// bundled entry is what the rest of the app recognises. Its title is what `eventSubject`
// matches to decide which series to show as "now" and whether to offer forecasts and odds;
// its description is written for a reader. The feed's wording ("Inflation Rate YoY") is a
// data label, and a release is often split across several of them — four rows for one CPI
// print. Folding the feed's date into the bundled card gives the corrected timing without
// turning one card into four, and without breaking anything downstream that reads titles.

export interface DatedEvent {
  id: string;
  title: string;
  /** Absolute instant, ISO 8601. */
  date: string;
  region?: string;
  currency?: string;
}

/**
 * Which release a title is about, or null when it cannot be told.
 *
 * Deliberately coarse and deliberately incomplete. A wrong match would hide a real event
 * behind another one's date, which is worse than the drift this exists to fix — so
 * anything unrecognised returns null and is left alone rather than guessed at.
 */
export function subjectKey(title: string): string | null {
  const t = (title ?? '').toLowerCase();
  // Order matters: "core pce price index" contains neither "cpi" nor "inflation rate", but
  // "core inflation rate" must not be read as PCE, so PCE is tested on its own words.
  if (/\bpce\b|personal income (and|&) outlays/.test(t)) return 'PCE';
  if (/non.?farm payroll|\bnfp\b|jobs report/.test(t)) return 'NFP';
  if (/\bfomc\b|fed interest rate decision|federal funds rate decision/.test(t)) return 'FOMC';
  if (/\becb\b|deposit facility rate/.test(t)) return 'ECB';
  if (/bank of england|\bboe\b/.test(t)) return 'BOE';
  if (/bank of japan|\bboj\b/.test(t)) return 'BOJ';
  // CPI last: the broadest pattern, so everything with a narrower identity is already out.
  if (/\bcpi\b|inflation rate|consumer price/.test(t)) return 'CPI';
  return null;
}

/** Which economy a row belongs to, from whichever of region or currency is present. */
export function regionKey(ev: DatedEvent): string | null {
  const r = (ev.region ?? '').trim().toLowerCase();
  if (r) {
    if (r === 'us' || r.includes('united states')) return 'US';
    if (r === 'eurozone' || r === 'eu' || r.includes('euro')) return 'EU';
    if (r === 'uk' || r.includes('united kingdom') || r.includes('britain')) return 'UK';
    if (r === 'japan' || r === 'jp') return 'JP';
  }
  const c = (ev.currency ?? '').trim().toUpperCase();
  return ({ USD: 'US', EUR: 'EU', GBP: 'UK', JPY: 'JP' } as Record<string, string>)[c] ?? null;
}

/**
 * The identity two calendars have to agree on before one may move the other's date:
 * same economy, same release, same month. The month is what makes this safe — a feed row
 * for November's CPI must never be allowed to move October's card.
 */
export function releaseKey(ev: DatedEvent): string | null {
  const subject = subjectKey(ev.title);
  const region = regionKey(ev);
  if (!subject || !region) return null;
  const month = ev.date.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? `${region}|${subject}|${month}` : null;
}

export interface Reconciled<T extends DatedEvent> {
  events: T[];
  /** One entry per card whose date the live feed moved — shown on the card, not swallowed. */
  corrections: { title: string; from: string; to: string }[];
}

/**
 * Merge a live calendar into the bundled one.
 *
 * - A bundled event matched by the feed keeps its identity and takes the feed's date.
 * - A feed row that matched something is dropped, its date having been folded in.
 * - A feed row that matched nothing is kept as its own event: it is something the bundled
 *   list does not know about, which is the other half of what a live feed is for.
 * - Anything without a resolvable key passes through untouched. Silence beats a guess.
 */
export function reconcileCalendars<T extends DatedEvent>(
  bundled: T[], live: T[],
): Reconciled<T> {
  const liveByKey = new Map<string, T[]>();
  for (const ev of live) {
    const k = releaseKey(ev);
    if (!k) continue;
    (liveByKey.get(k) ?? liveByKey.set(k, []).get(k)!).push(ev);
  }

  const corrections: Reconciled<T>['corrections'] = [];
  const consumed = new Set<string>();

  const events = bundled.map(ev => {
    const k = releaseKey(ev);
    if (!k) return ev;
    const matches = liveByKey.get(k);
    if (!matches || matches.length === 0) return ev;
    consumed.add(k);
    // A release split across several feed rows carries one instant; the earliest is that
    // instant. Taking the latest would drift onto a revision published hours later.
    const when = matches.map(m => m.date).sort()[0];
    if (!when || sameDay(when, ev.date)) return ev;
    corrections.push({ title: ev.title, from: ev.date, to: when });
    // `tentative` is cleared: the date is no longer this file's guess, it came from a
    // calendar that is refreshed. `dateCorrected` is what the card renders. Cast because
    // the two flags are not on the caller's own event type — they are what this merge
    // adds, and the caller reads them off the result.
    return { ...ev, date: when, tentative: false, dateCorrected: true, bundledDate: ev.date } as unknown as T;
  });

  const extras = live.filter(ev => {
    const k = releaseKey(ev);
    return !k || !consumed.has(k);
  });

  return { events: [...events, ...extras], corrections };
}

/** Same calendar day in UTC. Comparing instants would call 08:30 and 08:31 a correction. */
function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}
