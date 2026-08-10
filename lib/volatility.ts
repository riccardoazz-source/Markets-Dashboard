// ── Volatility, split into the part that comes from rises and the part from falls ──
//
// One number for how much an asset moves says nothing about WHICH WAY it moves when it
// moves. An asset whose swings are mostly upward and one whose swings are mostly downward
// can carry the same headline volatility and be nothing alike to hold. So every figure
// here comes in three parts:
//
//   total  all daily moves
//   up     the part contributed by the days the price ROSE
//   down   the part contributed by the days it FELL
//
// Two things have to hold at once, and they decide the whole design:
//   each side is computed from ITS OWN days, and
//   up + down = total, exactly.
//
// Standard deviations cannot do both. The natural split is the two semi-deviations — the
// standard deviation of up days and of down days — and those combine in QUADRATURE: an
// asset at 20.7% reads 14.3% up and 14.9% down, two numbers that look like they should
// make 29 and instead make 20.7. Nobody can read that.
//
// Splitting the total by VARIANCE share fails the first requirement in a way that shows
// up the moment it matters: variance is dominated by the largest days, so one crash can
// LOWER the reported up-side even though the up days did not change.
//
// So: the total is the ordinary annualised standard deviation — the number every other
// source quotes, unchanged — and it is split by how much of the total MOVEMENT came from
// each side, Σ(up moves) against Σ(all moves). Magnitudes, not squares, so the share is
// not hijacked by a single session; each side's figure comes only from its own days; and
// the two add to the headline the way a reader expects.
//
// One consequence, stated rather than hidden: because the parts must sum to a total that a
// crash RAISES, a crash lifts both — the down side a great deal, the up side a little. The
// ratio between them is the reading that means something, and the tooltip gives it as a
// percentage.
//
// Variance is measured around zero rather than around the mean. For daily returns the mean
// is a rounding error next to the deviation, and "how far did it move" is the honest
// question for volatility anyway, not "how far did it move relative to its own drift".
//
// ANNUALISED, and annualised on the asset's OWN calendar. Crypto trades 365 days a year
// and equities about 252, so a fixed √252 would overstate an equity index against Bitcoin
// by a fifth for no reason other than the calendar. The bars-per-year are measured from
// the dates themselves.

export interface Volatility {
  /** Annualised standard deviation of daily moves, %. */
  total: number;
  /** The share of `total` contributed by up days, %. `up + down === total`. */
  up: number;
  /** The share of `total` contributed by down days, %. */
  down: number;
  /** How many daily returns went into it. */
  bars: number;
  /** First and last date covered, so the caller can say what the number describes. */
  from: string;
  to: string;
}

export type VolPoint = { date: string; close: number };

/** Bars per year in this series, from its own dates. Falls back to the equity calendar. */
function barsPerYear(points: VolPoint[]): number {
  if (points.length < 30) return 252;
  const days = (Date.parse(points[points.length - 1].date) - Date.parse(points[0].date)) / 86_400_000;
  if (!(days > 0)) return 252;
  return Math.max(200, Math.min(366, (points.length / days) * 365.25));
}

/**
 * The three figures for a price series. Null when there is not enough of it to mean
 * anything — twenty returns is already thin, and below that the number would be noise
 * dressed up as a measurement.
 */
export function computeVolatility(points: VolPoint[] | undefined | null): Volatility | null {
  if (!points || points.length < 21) return null;
  const clean = points.filter(p => p && p.close != null && isFinite(p.close) && p.close > 0);
  if (clean.length < 21) return null;

  let sumSq = 0, absUp = 0, absDown = 0, n = 0;
  for (let i = 1; i < clean.length; i++) {
    const r = Math.log(clean[i].close / clean[i - 1].close);
    if (!isFinite(r)) continue;
    sumSq += r * r;
    if (r > 0) absUp += r; else if (r < 0) absDown -= r;
    n++;
  }
  if (n < 20) return null;

  // n − 1 rather than n, to match the sample convention every other figure in the app uses.
  const scale = Math.sqrt(barsPerYear(clean) / Math.max(1, n - 1)) * 100;
  const total = Math.sqrt(sumSq) * scale;
  // Share of the total MOVEMENT that came from rising days — see the header for why this
  // is taken on magnitudes rather than on squares.
  const absAll = absUp + absDown;
  const upFrac = absAll > 0 ? absUp / absAll : 0;
  return {
    total,
    up: total * upFrac,
    down: total * (1 - upFrac),
    bars: n,
    from: clean[0].date,
    to: clean[clean.length - 1].date,
  };
}

/**
 * Buckets for the filter. Fixed thresholds rather than percentiles of whatever is on
 * screen: 14% is a quiet market and 30% is a wild one whether the list showing has three
 * rows or three hundred, and a filter whose meaning moves with the list is a filter you
 * cannot reason about.
 */
export type VolBand = 'calm' | 'normal' | 'wild';
export const VOL_BANDS: { id: VolBand; label: string; hint: string }[] = [
  { id: 'calm',   label: '< 15%',    hint: 'Annualised volatility under 15% — bonds, defensive sectors, broad developed indices in a quiet regime' },
  { id: 'normal', label: '15–30%',   hint: 'Annualised volatility between 15% and 30% — most equity indices and sectors' },
  { id: 'wild',   label: '> 30%',    hint: 'Annualised volatility above 30% — single high-beta names, crypto, commodities in a squeeze' },
];

export function volBand(total: number | null | undefined): VolBand | null {
  if (total == null || !isFinite(total)) return null;
  if (total < 15) return 'calm';
  if (total <= 30) return 'normal';
  return 'wild';
}

/** "18.2%" — one decimal is all the precision a volatility estimate deserves. */
export function fmtVol(v: number | null | undefined): string {
  return v == null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`;
}

/**
 * How much of the movement comes from up days, 0–100, where an even split reads 50 and the
 * two sides sum to 100. Just `up` as a percentage of `total`, since the split is already
 * linear by construction.
 */
export function upShare(v: Volatility | null | undefined): number | null {
  if (!v || !(v.total > 0)) return null;
  return (v.up / v.total) * 100;
}
