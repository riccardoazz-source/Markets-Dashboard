// ── Where a calendar period actually starts ──────────────────────────────────
//
// A YTD figure is measured from the LAST CLOSE OF THE PREVIOUS YEAR, not from the first
// close of January. That is the convention Yahoo, Google and CoinGecko use, and it is the
// only one that makes sense: measuring from the first close of the new year silently
// throws away the first trading day's move, so on that day YTD reads 0.00% no matter what
// the market did, and for the rest of the year it is short by exactly that day.
//
// The quote figures in this app already anchor that way (see `baselineAtOrBefore` in
// lib/yahoo.ts, which was fixed for precisely this reason). The CHART windows did not:
// they asked the upstream API for everything from January 1st onward, so the series began
// at the first close after the boundary. Return and CAGR are computed from the first point
// of that series, which is why one panel could show "YTD -26.40%" from the quote and
// "Return (YTD) -27.41%" from the chart — the same period, measured from two different
// days, differing by whatever the first session of the year did.
//
// Fixing it takes two steps, because the anchor cannot be requested directly: nobody knows
// in advance which day the last session of the old year fell on. So the caller fetches a
// short LEAD_IN_DAYS run of extra history before the boundary, and then trims the series
// back to the anchor with `anchorSeries`.
//
// ROLLING windows (1M, 3M, 1Y…) are deliberately NOT handled here. Their quote-side anchor
// is "the last bar at-or-before this instant N months ago", which depends on the time of
// day the page is opened, so no date-only rule can agree with it in every case. Aligning
// those means making the quote side date-only first; this file is about the calendar
// periods, where the boundary is midnight and the disagreement is total and permanent.

/**
 * How much history to fetch BEFORE a period boundary so the last session at-or-before it
 * is certainly in the payload.
 *
 * Ten calendar days: the boundary can land on a weekend, and the New Year in particular
 * can put a market's last session up to four or five days before January 1st once the
 * holiday and the weekend line up. Ten covers every real closure with room to spare and
 * costs a handful of daily bars that are then trimmed off again.
 */
export const LEAD_IN_DAYS = 10;

/**
 * The first calendar day of the period a timeframe names, as `yyyy-mm-dd`, or null for
 * timeframes that are not calendar periods.
 *
 * Built from the local calendar fields rather than by formatting a Date, because
 * `startOfYear(now).toISOString()` is December 31st for anyone east of Greenwich — and an
 * anchor that is one day out is exactly the bug this file exists to remove.
 */
export function calendarBoundary(timeframe: string, now: Date): string | null {
  const y = now.getFullYear();
  if (timeframe === 'YTD') return `${y}-01-01`;
  if (timeframe === 'MTD') return `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return null;
}

/**
 * Trim a series so it BEGINS on the last point strictly before `boundary` — the close the
 * period is measured from.
 *
 * Strictly before, not at-or-before: for an asset that trades on January 1st (crypto) the
 * January 1st bar is inside the period being measured, and using it as the baseline would
 * discard that day's move — the very thing this is fixing.
 *
 * If nothing precedes the boundary the series is returned untouched: the asset began
 * inside the window, and its own first point is the only baseline available.
 *
 * `points` must be ascending by date, which every series in this app is.
 */
export function anchorSeries<T extends { date: string }>(points: T[], boundary: string): T[] {
  let anchor = -1;
  for (let i = 0; i < points.length; i++) {
    if (points[i].date < boundary) anchor = i;
    else break;
  }
  return anchor < 0 ? points : points.slice(anchor);
}
