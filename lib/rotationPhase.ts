// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// The MACRO decides which pair of states is available; the LEG decides which of the
// two you are in.
//
//   X = MACRO   — how far the price is above (+) or below (−) its own 200-day
//                 moving average, in %.
//   Y = LEG     — where the price is inside the swing it is travelling: % above the
//                 low an up-leg started from (+), or % below the high a down-leg
//                 started from (−). A leg turns only when the price reverses by
//                 0.75× the asset's own monthly volatility.
//
//   Above the average:  advancing   → Trending   (the move is running)
//                       giving back → Recovering (a dip inside an uptrend — the entry)
//   Below the average:  advancing   → Fading     (a rally inside a downtrend — the exit)
//                       giving back → Lagging    (the decline itself)
//
// WHY THE MACRO DECIDES THE PAIR. Every earlier version read the half of the cycle off
// the price's own recent behaviour — a 3-month return, a 12-month pace, a 40-day range —
// and every one of them joined trends that did not exist, because a bear-market rally
// clears any of those. The NASDAQ 100 fell a third in 2022 and the previous version still
// called it Trending on 22% of the days, at −1.4% a band. With the 200-day average as the
// gate, 2022 reads Fading 42% and Lagging 51%: rallies that fade, and a decline — which
// is what the year was, and the only two labels that were ever appropriate for it.
//
// WHAT THAT COSTS, stated plainly. Two labels change meaning:
//   • Recovering is now a DIP inside an uptrend, so it moves little while it lasts
//     (+0.3% a band). Its value is in what follows, not in itself.
//   • Fading is now a RALLY inside a downtrend, so it moves UP while it lasts (+0.8%).
//     It is a warning, not a description of a fall.
// Trending (+4.4% a band) and Lagging (−2.2%) keep meaning exactly what they say.
//
// WHAT FOLLOWS EACH CALL, over ten assets and their full history — NASDAQ 100 back to
// 1985, Healthcare to 1998 — measuring the next three months from the day each appears:
//
//     Recovering  +5.51% ± 0.87   (727 calls)   ← the best of the four
//     Trending    +4.75% ± 0.79   (854)
//     Lagging     +4.49% ± 0.68   (511)
//     Fading      +3.20% ± 0.82   (527)         ← the worst
//
// That is the order the names claim: buy the dip in an uptrend, sell the rally in a
// downtrend. But the gap between best and worst is 2.3 points against a combined error of
// 1.2 — 1.9 standard errors — and it holds on six of the ten assets, not ten. It is a
// tilt, not a rule, and nothing here should be read as more than that.
//
// WHAT IT STILL CANNOT DO. It is late: the first Trending call lands about a third of the
// way into an up-leg and captures 46% of its gain. That is inherent to a 200-day gate —
// the average has to be reclaimed before the top pair is reachable — and the alternatives
// were measured: a 50/200 crossover is later still (38% in, 41% of the gain), the
// average's slope is no earlier. The earlier signal under this reading is Recovering,
// which fires during the dip, before the trend resumes.
//
// VOLUME was measured and left out. Across the four states it moves between −0.05σ and
// +0.06σ of an asset's own normal: there is nothing in it.
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

/** The moving average that decides which pair of states an asset can be in. */
export const MACRO_SPAN = 200;
/** A leg turns when the price reverses by this multiple of its own monthly volatility. */
export const SWING_SIGMA = 0.75;
/** Floor on that reversal, %, so a near-motionless series still needs a real move. */
export const SWING_FLOOR = 2;
/** Window for the monthly volatility the threshold is scaled by, in trading days. */
export const VOL_SPAN = 63;
/** Calendar days of history the axes need: the average, plus room for holidays. */
export const AXES_LOOKBACK_DAYS = 330;

/**
 * Which quadrant a point falls in.
 *
 * macroGap: % above (+) or below (−) the asset's own 200-day moving average (X).
 * momentum: where the price is inside the leg it is travelling (Y).
 * Null when either is unknown; an asset without enough history has no position in the
 * cycle, and guessing one would be worse than saying nothing.
 */
export function classifyPhase(macroGap: number | null | undefined, momentum: number | null | undefined): RotationPhase | null {
  if (macroGap == null || momentum == null) return null;
  const above = macroGap > 0;
  // Exactly zero momentum means nothing has changed, so the leg simply continues.
  if (momentum === 0) return above ? 'Trending' : 'Lagging';
  if (above) return momentum > 0 ? 'Trending' : 'Recovering';
  return momentum > 0 ? 'Fading' : 'Lagging';
}

/**
 * The asset's position in the quadrant as a POINT, not just a name: which quadrant, how
 * far from the centre, and at what angle.
 *
 * Both axes are in % of price, so the radius is a real distance and carries the size of
 * the move: a broad index sits close to the centre, a high-beta name far from it.
 *
 * The corners are NOT a clockwise cycle, because the macro gate does not permit one.
 * Above the average an asset oscillates Trending ↔ Recovering; below it, Lagging ↔
 * Fading; and it changes pairs only when the average is crossed. That is the shape of the
 * thing, and drawing it as a wheel would be drawing a claim the data does not make.
 */
export interface QuadrantPosition {
  phase: RotationPhase | null;
  /** X in %: distance from the 200-day moving average. */
  x: number;
  /** Y in %: how far into the current leg, signed by its direction. */
  y: number;
  /** Distance from the centre, in %. */
  radius: number;
  /** 0° = due right, increasing anticlockwise. */
  angle: number;
}

export function quadrantPosition(
  macroGap: number | null | undefined,
  momentum: number | null | undefined,
): QuadrantPosition | null {
  if (macroGap == null || momentum == null) return null;
  const x = macroGap, y = momentum;
  const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { phase: classifyPhase(x, y), x, y, radius: Math.hypot(x, y), angle };
}

/** Monthly pace implied by a return over `months` — compounded, not divided. */
export function paceMonthly(r: number, months: number): number {
  const g = 1 + r / 100;
  if (g <= 0) return r / months;
  return (Math.pow(g, 1 / months) - 1) * 100;
}

// ── The axes, computed from a price history ──────────────────────────────────
// One implementation, used by the live rotation rows, the trails, the per-asset
// quadrant and the phase lab, so all four necessarily agree.

export type PricePoint = { date: string; close: number };

/**
 * Bars per month in this history. Crypto trades every day and equities ~21 days a month,
 * so a span counted in bars would mean a different amount of TIME for each. Every window
 * below is scaled by this.
 *
 * Measured on the FIRST year of the array, not the last. Two constraints meet here and
 * only this satisfies both: the answer for a past date must not depend on data after it
 * (so not the last bars), and trendAxes() and trendAxesSeries() must pick the identical
 * span for the same date or they disagree by a few hundredths of a percent (so not a
 * window that moves with the as-of date). The first year is in the past for every date
 * that has one, and it is the same window in both. A market's trading calendar does not
 * change over a decade, so nothing is lost by reading it once.
 */
function barsPerMonth(hist: PricePoint[]): number {
  const head = hist.slice(0, Math.min(hist.length, 260));
  if (head.length < 30) return 21;
  const days = (Date.parse(head[head.length - 1].date) - Date.parse(head[0].date)) / 86_400_000;
  if (!(days > 0)) return 21;
  return Math.max(15, Math.min(31, (head.length / days) * 30.44));
}

/**
 * Realized monthly volatility per bar, in %, from a rolling window of log returns.
 * Kept as running sums rather than a re-scan per bar: this is called once per plotted
 * date on a decade of history, and the naive version made that quadratic.
 */
function rollingVol(closes: number[], span: number): (number | null)[] {
  const out = new Array<number | null>(closes.length).fill(null);
  const lr = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) lr[i] = Math.log(closes[i] / closes[i - 1]);
  let sum = 0, sumSq = 0;
  for (let i = 1; i < closes.length; i++) {
    sum += lr[i]; sumSq += lr[i] * lr[i];
    if (i > span) { sum -= lr[i - span]; sumSq -= lr[i - span] * lr[i - span]; }
    const n = Math.min(i, span);
    if (n < Math.max(10, span / 3)) continue;
    const mean = sum / n;
    const varr = Math.max(0, sumSq / n - mean * mean);
    out[i] = Math.sqrt(varr) * Math.sqrt(21) * 100;
  }
  return out;
}

/**
 * Where the price sits inside the leg it is currently travelling.
 *
 * The leg turns only when the price reverses by `SWING_SIGMA` times the asset's own
 * monthly volatility, so a 4% wobble ends a leg for the TSX and does not for Bitcoin, and
 * the threshold needs no per-asset tuning. Returns % above the low an up-leg started
 * from, or % below the high a down-leg started from.
 *
 * `hi` tracks the high while an up-leg runs and becomes the top the following down-leg
 * retraces FROM; `lo` does the mirror. Neither is reset at the turn, so both legs are
 * measured from the real extreme rather than from the price at which the reversal
 * happened to be confirmed. The result is then clamped to the sign of the leg: without
 * that, a price slipping just past the point its leg began — without falling far enough
 * to end it — would report a number whose sign contradicts the leg, and the sign is what
 * decides the phase.
 */
function swingPosition(closes: number[], vol: (number | null)[], fallbackVol: number): number {
  let dir = 1, hi = closes[0], lo = closes[0], y = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const th = Math.max(SWING_FLOOR, SWING_SIGMA * (vol[i] ?? fallbackVol));
    if (dir > 0) {
      if (c > hi) hi = c;
      if ((c / hi - 1) * 100 <= -th) { dir = -1; lo = c; }
    } else {
      if (c < lo) lo = c;
      if ((c / lo - 1) * 100 >= th) { dir = 1; hi = c; }
    }
    y = dir > 0 ? Math.max(0, (c / lo - 1) * 100) : Math.min(0, (c / hi - 1) * 100);
  }
  return y;
}

export interface TrendAxes {
  /** X: % above/below the 200-day moving average. */
  macroGap: number;
  /** Y: % into the current leg, signed by its direction. */
  momentum: number;
}

/**
 * The axes for EVERY bar, in one pass.
 *
 * trendAxes() answers for a single date and costs a walk of the whole history each time,
 * because the leg is a running state that cannot be started in the middle. Asking it once
 * per plotted day would be quadratic, which is why the per-asset panel used to evaluate
 * the model once a WEEK and carry each call forward — and that is exactly what made its
 * bands wrong: every one began and ended up to a week late, so a Lagging stretch
 * collected a week of the rebound that ended it. On the NASDAQ 100 over ten years that
 * alone turned Lagging from −2.0% a band into +0.7%.
 *
 * Here the rolling parts are kept incrementally, so the whole series costs one pass and
 * the panel can label every single day. `npm run vet` pins this against trendAxes() bar
 * for bar, because the panel draws from one and the rotation table reads the other.
 */
export function trendAxesSeries(hist: PricePoint[] | undefined): (TrendAxes | null)[] {
  if (!hist || hist.length < 2) return hist ? hist.map(() => null) : [];
  const n = hist.length;
  const closes = new Array<number>(n);
  for (let i = 0; i < n; i++) closes[i] = hist[i].close;
  const out = new Array<TrendAxes | null>(n).fill(null);

  const scale = barsPerMonth(hist) / 21;
  const W = (d: number) => Math.max(2, Math.round(d * scale));
  const span = W(MACRO_SPAN);

  const vol = rollingVol(closes, W(VOL_SPAN));
  const known = vol.filter((v): v is number => v != null);
  if (!known.length) return out;
  const sorted = [...known].sort((a, b) => a - b);
  const volMedian = sorted[sorted.length >> 1];

  // The moving average, as a running sum.
  const ma = new Array<number | null>(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += closes[i];
    if (i >= span) sum -= closes[i - span];
    if (i >= span - 1) ma[i] = sum / span;
  }

  // The leg, carried forward bar by bar — the same state machine swingPosition runs.
  let dir = 1, hi = closes[0], lo = closes[0];
  for (let i = 0; i < n; i++) {
    const c = closes[i];
    const th = Math.max(SWING_FLOOR, SWING_SIGMA * (vol[i] ?? volMedian));
    if (dir > 0) {
      if (c > hi) hi = c;
      if ((c / hi - 1) * 100 <= -th) { dir = -1; lo = c; }
    } else {
      if (c < lo) lo = c;
      if ((c / lo - 1) * 100 >= th) { dir = 1; hi = c; }
    }
    const y = dir > 0 ? Math.max(0, (c / lo - 1) * 100) : Math.min(0, (c / hi - 1) * 100);
    const m = ma[i];
    if (m != null && m > 0 && isFinite(y)) out[i] = { macroGap: (c / m - 1) * 100, momentum: y };
  }
  return out;
}

/**
 * The two quadrant coordinates as of a date, from the asset's own price history.
 * `asOf` defaults to the last bar. Null when the history is shorter than the average.
 */
export function trendAxes(hist: PricePoint[] | undefined, asOf?: string | Date): TrendAxes | null {
  if (!hist || hist.length < 2) return null;
  const asOfStr = asOf == null
    ? hist[hist.length - 1].date
    : (typeof asOf === 'string' ? asOf : new Date(asOf.getTime()).toISOString().slice(0, 10));

  // Binary-search the as-of cutoff: no bar after it may be read.
  let lo = 0, hi = hist.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hist[mid].date <= asOfStr) lo = mid + 1; else hi = mid; }
  if (lo < 2) return null;
  const closes: number[] = [];
  for (let i = 0; i < lo; i++) closes.push(hist[i].close);

  const scale = barsPerMonth(hist) / 21;
  const W = (d: number) => Math.max(2, Math.round(d * scale));
  const span = W(MACRO_SPAN);
  if (closes.length < span) return null;

  const vol = rollingVol(closes, W(VOL_SPAN));
  const known = vol.filter((v): v is number => v != null);
  if (!known.length) return null;
  // Median of what is known, for the bars before the volatility window is full: a zero
  // there would turn the floor into the only threshold and cut the early legs at 2%
  // regardless of what the asset normally does.
  const sorted = [...known].sort((a, b) => a - b);
  const volMedian = sorted[sorted.length >> 1];

  let sum = 0;
  for (let i = closes.length - span; i < closes.length; i++) sum += closes[i];
  const ma = sum / span;
  if (!(ma > 0)) return null;
  const macroGap = (closes[closes.length - 1] / ma - 1) * 100;

  const momentum = swingPosition(closes, vol, volMedian);

  if (!isFinite(macroGap) || !isFinite(momentum)) return null;
  return { macroGap, momentum };
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — above its 200-day average but the leg has turned down: a dip inside an uptrend. It moves little while it lasts; what follows it is the best of the four (+5.5% over the next three months). The entry.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — above its 200-day average and still advancing: the move is running. +4.4% a stretch while it lasts.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — below its 200-day average but the leg has turned up: a rally inside a downtrend. It rises while it lasts, and what follows it is the worst of the four (+3.2%). The exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — below its 200-day average and still giving ground: the decline itself. −2.2% a stretch while it lasts.',
  },
};
