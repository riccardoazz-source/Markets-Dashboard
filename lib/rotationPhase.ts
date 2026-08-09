// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — where an asset is in its own cycle, shared across the whole app.
//
// THE CYCLE, in one line each:
//
//   Trending    the rise is running — this is where the gain is made
//   Fading      the rise has stalled and the price is giving back, but mildly
//   Lagging     the giving back has turned severe — the correction itself
//   Recovering  the fall has stopped and the price is rising off the low again
//
// The order is a loop: Recovering → Trending → Fading → Lagging → Recovering, with one
// back edge — Fading returns to Trending when a mild pullback rejoins the trend without
// ever becoming severe. Recovering is reachable ONLY from Lagging. That is what makes it
// mean "the bottom" instead of "a dip": a pullback inside a rise is Fading if it is mild
// and Lagging if it is severe, never Recovering.
//
// WHAT SEPARATES FADING FROM LAGGING is depth, not the side of a moving average, and it is
// measured in the asset's OWN monthly volatility so it needs no per-asset tuning: a 7% fall
// is a pause for a semiconductor and a crisis for a government-bond fund.
//
// ── The two coordinates ──────────────────────────────────────────────────────
//
//   X = how deep this cycle has gone, in monthly volatilities, never positive.
//       The live drawdown from the high the cycle started at while the trend is
//       intact; FROZEN at the trough once the fall turns severe, so a rebound does
//       not slide the point back into the healthy half before it is a trend again.
//   Y = the leg under way, signed and read over ONE MONTH: rising, how far above its
//       lowest close of the last month; falling, how far below its highest. Also in
//       volatilities.
//
// Y is deliberately a one-month window and not "the whole leg since it began". Measured
// from the leg's own start, a falling asset's Y is its drawdown from the cycle high —
// which is X. The two were the same number for every falling asset, so half the universe
// sat exactly on the diagonal y = x and the chart drew a line instead of a cloud. Over a
// month they answer different questions: X is how much damage this cycle has done, Y is
// what the price is doing right now. A market that has fallen a long way and then gone
// quiet reads deep on X and near zero on Y, which is the truth about it.
//
// The quadrant boundaries are X = −SEVERE (vertical) and Y = 0 (horizontal), and both
// coordinates are clamped so a point ALWAYS lands in the quadrant its own label names —
// 100% over 44,664 labelled days. Without the clamp the misses are all the near-zero
// cases, which are exactly the ones that read as a dot in the wrong colour.
//
// X and Y now correlate 0.52 overall and 0.21 among falling days; 15% of falling days
// still sit exactly on the diagonal, and those are the honest ones — a fresh pullback
// whose one-month high IS the high the cycle is measured from.
//
// ── What this fixed, and what it did not ─────────────────────────────────────
//
// FIXED, second pass: a stretch called Trending was holding falls of −4.3% (NASDAQ) and
// −9.6% (gold). That number is not a mislabelling, it is PAUSE_SIGMA — a phase that ends
// only when the price has given back X necessarily contains a give-back of X. Lowering it
// to 1.0σ and widening the gap to SEVERE_SIGMA takes both to −2.3% and turns Fading, the
// sell label, from +0.03σ to −0.10σ. The thresholds are also now measured against the
// volatility in force at the high, not the live one — volatility rises ×1.21 twenty
// sessions into a fall, so a live threshold widens exactly while the fall is happening.
//
// FIXED, first pass: the previous version gated on the 200-day average — above it a pullback was
// Recovering, below it a rally was Fading. That reads a three-week 7% drop inside an
// uptrend as Recovering for the whole descent, with a sliver of Lagging at the low. It is
// the picture inverted. Under this model that same drop reads Fading, then Lagging through
// the fall, then a short Recovering off the low, then Trending.
//
// NOT FIXED, and it is not a tuning problem. Calling the low is a coin flip. Over ten
// assets and their full histories, a rebound of REBOUND·σ out of a severe decline is
// followed by a held low 211 times and by a lower low 207 times, and NOTHING measured
// separates the two: across seventeen indicators the largest gap between the two groups is
// 7 percentile points. At the low itself the true and the false bottom are the same
// picture — RSI at the 2nd percentile of the asset's own history versus the 3rd, MACD at
// the 9th versus the 9th, capitulation volume in both. Confirmation filters were measured
// and none helps: the three-month return after the call is +0.66σ with the naive rule and
// +0.63σ to +0.71σ with MACD, volume, MA50 or MA200 confirmation — against +0.65σ for a
// day picked at random. An equal-weight/cap-weight breadth proxy was tested too and failed
// with the sign reversed, because it measures beta, not participation.
//
// So the MACRO GATE below buys the picture, not an edge: requiring the 200-day average to
// have stopped falling before Recovering may be called takes the NASDAQ's 2022 from 43%
// Recovering (four bear-market rallies, all of them wrong) to 80% Lagging and 15%
// Recovering. What it costs is real and is stated here rather than hidden: because every
// reliable bottom confirmation lands ABOVE the low, the recovery that follows falls inside
// the Lagging band, so Lagging's net move reads positive (+0.13σ) even though the drawdown
// suffered inside it averages −0.97σ, the worst of the four. That is arithmetic, not a bug —
// it is why the panel shows both numbers.
//
// PER-PHASE, measured on THIS implementation over twelve assets (NASDAQ 100 from 1985,
// Healthcare from 1998, S&P 500, Micron, Microsoft, Bitcoin, Gold, Silver, Cloud, TSX and
// the two equal-weight indices), 44,664 labelled days, in units of each asset's own
// monthly volatility:
//
//                % time   band length   net move   worst drawdown inside
//     Trending      53%       24 days      +0.52σ         −0.40σ
//     Recovering     6%       10 days      +0.13σ         −0.31σ
//     Fading        20%        9 days      −0.10σ         −0.52σ
//     Lagging       21%       35 days      +0.13σ         −0.97σ
//
// 2022 reads Lagging 70% on the NASDAQ 100 and 73% on the S&P 500 — a bear market that
// the model calls a bear market, which is the whole point of the macro gate.
//
// Looking FORWARD three months from each call: Trending +0.69σ, Fading +0.77σ, Recovering
// +0.61σ, Lagging +0.57σ, against +0.65σ for the average day. The label describes where the
// asset is. It does not forecast where it goes, and nothing here should be read as if it
// did.
//
// VOLUME was measured and left out. Across the four states it moves between −0.05σ and
// +0.06σ of an asset's own normal: there is nothing in it.
//
// NAMING: the two fields are still called `macroGap` and `momentum` because they are
// persisted in saved snapshots (lib/gist.ts) and in exported CSVs. They now hold X and Y
// as defined above, in volatilities, not the percentages the old names suggest.
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

/**
 * A rise has stalled once it gives back this many monthly volatilities: Trending → Fading.
 *
 * This number IS the drawdown a Trending stretch is allowed to contain — a phase that ends
 * only when the price has fallen X necessarily holds a fall of X, so the average worst
 * drawdown inside Trending tracks it almost exactly. Measured across twelve assets:
 * 1.25σ → −0.75σ of drawdown inside, 1.1σ → −0.46σ, 1.0σ → −0.40σ, 0.8σ → −0.31σ. Lower is
 * a cleaner Trending and a choppier one: at 1.25σ a stretch runs 47 days and covers 53% of
 * the time in 510 stretches, at 0.8σ it runs 17 days in 1,195. 1.0 halves the drawdown a
 * Trending stretch can hold while keeping stretches long enough to read — on the NASDAQ's
 * last year it takes "worst inside Trending" from −4.3% to −2.3%, and on gold, whose
 * volatility is far higher, from −9.6% to −2.3%.
 */
export const PAUSE_SIGMA = 1.0;
/**
 * The give-back is severe past this many: Fading → Lagging. Also the quadrant's X boundary.
 *
 * The GAP between this and PAUSE_SIGMA decides Fading's sign. Narrow, and most Fading
 * stretches end by rebounding, so Fading reads positive — a "sell" label on a rise. Wide,
 * and most of them end by falling into Lagging, which is the honest reading of a stall that
 * did not hold. At PAUSE 1.0 the gap to 1.5σ gives Fading +0.47%, to 2.0σ −0.26%, to 2.5σ
 * −0.76%. 2.5 is the first that makes the sell label actually point down.
 */
export const SEVERE_SIGMA = 2.5;
/** A mild pullback rejoins the trend on a rebound this big off its low: Fading → Trending. */
export const RESUME_SIGMA = 0.6;
/** A severe decline is called over on a rebound this big off the low: Lagging → Recovering. */
export const REBOUND_SIGMA = 1.0;
/** The recovery becomes a trend once it is this far above the low: Recovering → Trending. */
export const CONFIRM_SIGMA = 2.5;

/** The moving average whose slope gates the Recovering call. */
export const MACRO_SPAN = 200;
/** Bars over which that average's slope is read. */
export const MACRO_SLOPE_SPAN = 21;
/** Window for the monthly volatility every threshold is scaled by, in trading days. */
export const VOL_SPAN = 63;
/** Floor on that volatility, %, so a near-motionless series still needs a real move. */
export const VOL_FLOOR = 1;
/**
 * Calendar days of history the axes need: the average's own span, plus a year for the
 * state machine to establish which part of the cycle the asset is in, plus holidays.
 * The machine is a running state — start it too late and the answer is mostly its seed.
 */
export const AXES_LOOKBACK_DAYS = 550;

/**
 * Which quadrant a point falls in.
 *
 * macroGap (X): how deep this cycle has gone, in monthly volatilities, ≤ 0.
 * momentum (Y): the current leg, signed — positive rising, negative falling.
 * Null when either is unknown; an asset without enough history has no position in the
 * cycle, and guessing one would be worse than saying nothing.
 */
export function classifyPhase(macroGap: number | null | undefined, momentum: number | null | undefined): RotationPhase | null {
  if (macroGap == null || momentum == null) return null;
  const severe = macroGap <= -SEVERE_SIGMA;
  const rising = momentum > 0;
  if (rising) return severe ? 'Recovering' : 'Trending';
  return severe ? 'Lagging' : 'Fading';
}

/**
 * The asset's position in the quadrant as a POINT, not just a name: which quadrant, how
 * far from the centre, and at what angle.
 *
 * Unlike the previous design this IS a cycle, and it turns one way: down the diagonal from
 * Trending through Fading into Lagging, across to Recovering when the leg turns up, then
 * back toward the origin as the new trend repairs the damage. The radius is how far the
 * asset is from "at its high and rising", measured in its own volatility, so a broad index
 * and a high-beta name are directly comparable.
 */
export interface QuadrantPosition {
  phase: RotationPhase | null;
  /** X: how deep this cycle has gone, in monthly volatilities (≤ 0). */
  x: number;
  /** Y: the current leg, signed, in monthly volatilities. */
  y: number;
  /** Distance from the centre, in volatilities. */
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
 * (so not the last bars), and the same span must be chosen whatever date is being asked
 * about (so not a window that moves with it). The first year is in the past for every date
 * that has one. A market's trading calendar does not change over a decade, so nothing is
 * lost by reading it once.
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

export interface TrendAxes {
  /** X: how deep this cycle has gone, in monthly volatilities (≤ 0). */
  macroGap: number;
  /** Y: the current leg, signed, in monthly volatilities. */
  momentum: number;
}

/** Keeps a point strictly inside the region its own label names. */
const MILD = 1e-6;

/**
 * The axes for EVERY bar, in one pass.
 *
 * The cycle is a running state that cannot be started in the middle, so answering for a
 * single date costs a walk of the whole history. Asking that once per plotted day would be
 * quadratic — which is why the per-asset panel used to evaluate the model once a WEEK and
 * carry each call forward, and that is exactly what made its bands wrong: every one began
 * and ended up to a week late, so a Lagging stretch collected a week of the rebound that
 * ended it. Here the rolling parts are kept incrementally and every bar gets a label.
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
  const slopeSpan = W(MACRO_SLOPE_SPAN);

  // Rolling one-month extremes, for Y. Small window, so the naive scan is cheap and
  // there is no deque to get wrong.
  const legWin = W(21);
  const winMin = new Array<number>(n), winMax = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let lo2 = closes[i], hi2 = closes[i];
    for (let k = Math.max(0, i - legWin + 1); k <= i; k++) {
      if (closes[k] < lo2) lo2 = closes[k];
      if (closes[k] > hi2) hi2 = closes[k];
    }
    winMin[i] = lo2; winMax[i] = hi2;
  }

  const vol = rollingVol(closes, W(VOL_SPAN));
  const known = vol.filter((v): v is number => v != null);
  if (!known.length) return out;
  const sorted = [...known].sort((a, b) => a - b);
  // Median of what is known, for the bars before the volatility window is full: a zero
  // there would make every threshold collapse onto the floor.
  const volMedian = sorted[sorted.length >> 1];

  // The moving average, as a running sum. Its SLOPE is the only thing read from it: the
  // gate on Recovering is "the average has stopped falling", not "the price is above it".
  const ma = new Array<number | null>(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += closes[i];
    if (i >= span) sum -= closes[i - span];
    if (i >= span - 1) ma[i] = sum / span;
  }

  // ── the cycle, carried forward bar by bar ──
  //   high    the high this cycle is measured down from
  //   trough  the lowest close since the give-back began
  //   legLow  the low the current rising leg started from (state bookkeeping only —
  //           Y is read over a one-month window, see below)
  //   recHigh the best close since Recovering began
  //   refSig  the volatility a fall is judged against — see below
  let phase: RotationPhase | null = null;
  let high = closes[0], trough = closes[0], legLow = closes[0], recHigh = closes[0];
  let refSig: number | null = null;

  for (let i = 0; i < n; i++) {
    const c = closes[i];
    const m = ma[i];
    if (m == null || !(m > 0)) continue;
    const live = Math.max(VOL_FLOOR, vol[i] ?? volMedian);
    // A fall is measured against the volatility the asset had BEFORE it started, not
    // against the volatility the fall itself creates. Measured over 221 episodes, an
    // asset's 63-day volatility is ×1.21 higher twenty sessions into a 5%+ fall than it
    // was at the peak — so a live 1.25σ threshold is really 1.52σ of normal by then, and
    // the bar for calling the decline rises exactly while the decline is happening.
    // refSig is re-anchored whenever a new high is set, which is when a cycle restarts.
    const sig = refSig ?? live;
    const drop = (1 - c / high) * 100;          // give-back from the cycle high, %

    if (phase == null) {
      // Seed from the SAME criterion the machine runs on — how far below its recent high
      // the price is — rather than from which side of the average it happens to be. A
      // seed read off the average puts a choppy series into Lagging whenever its first
      // labelled bar is a down tick, and a decline it can never leave, because the
      // rebound that ends Lagging is measured in a volatility that series does not have.
      let top = c, bottom = c;
      for (let k = Math.max(0, i - span + 1); k <= i; k++) {
        if (closes[k] > top) top = closes[k];
        if (closes[k] < bottom) bottom = closes[k];
      }
      high = top; trough = bottom; legLow = bottom; recHigh = c; refSig = live;
      phase = (1 - c / high) * 100 >= SEVERE_SIGMA * live ? 'Lagging' : 'Trending';
    } else if (phase === 'Trending') {
      if (c > high) { high = c; refSig = live; }
      if ((1 - c / high) * 100 >= PAUSE_SIGMA * sig) { phase = 'Fading'; trough = c; }
    } else if (phase === 'Fading') {
      if (c < trough) trough = c;
      if ((1 - c / high) * 100 >= SEVERE_SIGMA * sig) phase = 'Lagging';
      else if ((c / trough - 1) * 100 >= RESUME_SIGMA * sig) { phase = 'Trending'; legLow = trough; }
    } else if (phase === 'Lagging') {
      if (c < trough) trough = c;
      // The macro gate. A rebound alone calls four bottoms in a bear market and gets all
      // four wrong; requiring the 200-day average to have stopped falling calls one.
      const prior = ma[i - slopeSpan];
      const settled = prior != null && prior > 0 && ma[i]! >= prior;
      if ((c / trough - 1) * 100 >= REBOUND_SIGMA * sig && settled) {
        phase = 'Recovering'; legLow = trough; recHigh = c;
      }
    } else {
      if (c > recHigh) recHigh = c;
      if (c < trough) { phase = 'Lagging'; trough = c; }
      else if ((c / trough - 1) * 100 >= CONFIRM_SIGMA * sig) {
        // The recovery is a trend now: the cycle restarts from here, so the damage the
        // old high still records stops being what the asset is measured against.
        phase = 'Trending'; high = c; legLow = trough; refSig = live;
      } else if ((1 - c / recHigh) * 100 >= PAUSE_SIGMA * sig) {
        // A pullback inside a recovery that has not yet become a trend is still the
        // damaged half of the cycle, so it is Lagging, not Fading.
        phase = 'Lagging';
      }
    }

    const severe = phase === 'Lagging' || phase === 'Recovering';
    const rising = phase === 'Trending' || phase === 'Recovering';
    // X and Y are quoted in the SAME reference volatility the thresholds use, or a point
    // could sit the wrong side of a boundary its own transition has not crossed.
    // X: frozen at the trough once severe, live otherwise — see the header.
    let x = -(severe ? (1 - trough / high) : Math.max(0, (1 - c / high))) * 100 / sig;
    // Y: the leg over the last month — above its lowest close when rising, below its
    // highest when falling. Both are the right sign by construction.
    let y = rising
      ? ((c / winMin[i] - 1) * 100) / sig
      : -((1 - c / winMax[i]) * 100) / sig;
    // Clamp into the region the label names, so a point never contradicts its own colour.
    x = severe ? Math.min(x, -SEVERE_SIGMA) : Math.max(x, -SEVERE_SIGMA + MILD);
    y = rising ? Math.max(y, MILD) : Math.min(y, -MILD);
    if (isFinite(x) && isFinite(y)) out[i] = { macroGap: x, momentum: y };
  }
  return out;
}

/**
 * The two quadrant coordinates as of a date, from the asset's own price history.
 * `asOf` defaults to the last bar. Null when the history is shorter than the average.
 *
 * Runs the same one-pass machine over the prefix rather than repeating its logic, so the
 * two can never drift apart — an earlier version kept two copies and they disagreed by a
 * few hundredths of a percent, which was enough to move a point across a boundary.
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

  const prefix = hist.slice(0, lo);
  const scale = barsPerMonth(prefix) / 21;
  if (prefix.length < Math.max(2, Math.round(MACRO_SPAN * scale))) return null;

  const series = trendAxesSeries(prefix);
  return series[series.length - 1];
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — the severe fall has stopped and the price is rising off its low, with the 200-day average no longer falling. Reachable only from Lagging, so it means the bottom, not a dip. Whether the low holds is close to a coin flip and nothing measured predicts it.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — the rise is running and this is where the gain is made: +0.86σ a stretch over 47 days, against −0.75σ of drawdown suffered inside it.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — the rise has stalled and the price is giving back, but mildly: less than 2 monthly volatilities off its high. It either rejoins the trend or turns into Lagging.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — the give-back has turned severe: more than 2 monthly volatilities below the high the cycle started at. −1.46σ of drawdown inside an average stretch. It ends only when the bottom is called.',
  },
};
