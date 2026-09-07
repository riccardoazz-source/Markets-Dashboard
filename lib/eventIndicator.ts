// ── What number does this event concern? ─────────────────────────────────────
//
// A calendar card says an event is coming. The obvious next question is "coming from
// WHERE" — a rate decision means nothing without the rate it is deciding on, and a CPI
// release means nothing without the last CPI print.
//
// That half is free and exact: this app already fetches every one of these series for the
// Macro tab, so the card can show today's value from the same source the chart draws,
// with no new provider and nothing to be wrong about.
//
// The OTHER half — what the number is expected to be — is not free and not exact, and the
// two must not be presented as though they were the same kind of fact. See
// /api/event-outlook: the consensus and the market-implied odds come from a live web
// search, are labelled as such, carry their sources, and are simply absent when the
// search does not produce them.

/**
 * Both kinds can have market-implied odds. They differ in WHERE those odds come from, and
 * therefore in how much weight the number carries — which is worth showing, not hiding.
 *
 * This started out as "rates have odds, statistics do not", which is wrong. It is true
 * that no deep futures market trades on the value of a CPI print the way fed funds
 * futures trade on a rate decision. But regulated event contracts (Kalshi, Polymarket)
 * list monthly CPI and payrolls outcomes, and CPI fixing swaps price the print directly —
 * those are real traded markets on a statistic's value, just thinner and less canonical
 * than the rates curve. Refusing to show them was not caution, it was an over-broad claim
 * dressed as caution.
 */
export type EventKind =
  /** A committee sets a number. Odds come from the rates curve — deep and canonical. */
  | 'rate'
  /** A statistic is published. Odds, where they exist, come from event contracts or
   *  fixing swaps: real, but thinner, so the market is named beside them. */
  | 'data';

export interface EventSubject {
  /** MACRO_INDICATORS id, or null when this app carries no series for it. */
  indicatorId: string | null;
  kind: EventKind;
  /** What the current value IS, for the card's label — "Current rate", "Last CPI". */
  currentLabel: string;
}

/**
 * Matched on the title prefix, the same way the calendar's wall-clock check identifies
 * its entries. Prefixes rather than ids because the ids are generated from the title and
 * the date, so they change every year while the titles do not.
 */
const SUBJECTS: [string, EventSubject][] = [
  ['FOMC Rate Decision',
    { indicatorId: 'DFEDTARU', kind: 'rate', currentLabel: 'Current target' }],
  ['ECB Monetary Policy',
    { indicatorId: 'ECBDFR', kind: 'rate', currentLabel: 'Current deposit rate' }],
  ['Bank of Japan',
    { indicatorId: 'IRSTCI01JPM156N', kind: 'rate', currentLabel: 'Current call rate' }],
  // No BoE series in this app's macro set, so the card gets the outlook but no "current".
  // Declared anyway: knowing it is a rate decision is what decides whether asking for
  // probabilities makes sense, and that is true whether or not we hold the series.
  ['Bank of England Rate Decision',
    { indicatorId: null, kind: 'rate', currentLabel: 'Current bank rate' }],
  ['US CPI Inflation Report',
    { indicatorId: 'CPI_YOY', kind: 'data', currentLabel: 'Last CPI (YoY)' }],
  ['US Core PCE Inflation',
    { indicatorId: 'CORE_PCE_YOY', kind: 'data', currentLabel: 'Last core PCE (YoY)' }],
  // Payrolls publish a monthly CHANGE, which this app does not carry as its own series.
  // The unemployment rate is published inside the same release and IS carried, so that is
  // what the card shows — labelled as the unemployment rate, not as "payrolls", because
  // showing one number under another's name is the whole failure to avoid.
  ['US Non-Farm Payrolls',
    { indicatorId: 'UNRATE', kind: 'data', currentLabel: 'Last unemployment rate' }],
];

/** The series and kind an event concerns, or null for one nothing is known about. */
export function eventSubject(title: string): EventSubject | null {
  const hit = SUBJECTS.find(([prefix]) => title.startsWith(prefix));
  return hit ? hit[1] : null;
}

/** Every indicator id the given events need, de-duplicated — one fetch for a whole rail. */
export function subjectIndicatorIds(titles: string[]): string[] {
  const ids = new Set<string>();
  for (const t of titles) {
    const s = eventSubject(t);
    if (s?.indicatorId) ids.add(s.indicatorId);
  }
  return [...ids];
}
