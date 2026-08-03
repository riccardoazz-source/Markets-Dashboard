// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// The four areas are defined the way the chart is read:
//
//   X = RANGE POSITION — how far the price is from the MIDDLE of its own 40-day
//                   range, in %, averaged over three weeks, less a penalty when the
//                   market is more agitated than that asset's own normal.
//                   Above zero = in the upper half of its range, below = the lower.
//   Y = SWING     — where the price is inside the leg it is currently travelling:
//                   % ABOVE the low the up-leg started from (+), or % BELOW the high
//                   the down-leg started from (−). The leg only turns when the price
//                   reverses by 0.75× the asset's own monthly volatility, so the sign
//                   of Y changes at real turns and each coloured band is a LEG.
//
//   Recovering (top-left)    : below its trend but momentum has turned up — the entry, BUY
//   Trending   (top-right)   : above its trend and still gaining — hold
//   Fading     (bottom-right): above its trend but momentum has turned down — the exit, SELL
//   Lagging    (bottom-left) : below its trend and still losing — wait for Recovering
//
// WHY Y IS A SWING AND NOT A MOMENTUM OSCILLATOR. Three definitions were measured on ten
// years of daily history for eight assets — Micron, Gold, S&P 500, Microsoft, Bitcoin,
// Silver, a cloud-sector ETF and the TSX — by the only test that matters to someone
// reading the strip: what the price did, on average, DURING each coloured band.
//
//                            Recovering  Trending  Fading  Lagging
//   3M return + acceleration      +1.1%     +1.8%   +1.5%    +0.6%
//   12M pace + its change         +1.3%     +2.1%   +1.2%    +0.7%
//   trend gap + MACD histogram    +1.4%     +2.9%   +0.8%    −0.6%
//   trend gap + SWING             +1.5%     +7.0%   −0.2%    −1.7%
//
// Only the last one has the signs the four names claim: the rise concentrated in
// Trending, Fading and Lagging actually negative. The reason the others could not get
// there is structural, not a matter of tuning. Those Y axes are momentum oscillators,
// and momentum changes sign every two or three weeks, so each band captured a FRAGMENT
// of a move — the median band moved 0.0%. No average over fragments can ever show "the
// bulk of the correction", because no band ever contains a whole correction.
//
// A swing axis cuts the price where the price itself turns, so a band IS a leg. Measured
// against the same eight assets: Trending takes 46% of all the upside while carrying only
// 33% of the downside; Fading and Lagging carry 24% and 28% of the downside on 16% and 20%
// of the time. After a Recovering the next call is Trending 56% of the time (was 50%),
// after a Fading it is Lagging 42% (was 37%).
//
// WHY 0.75 SIGMA. The reversal threshold trades the quality of the AVERAGES against the
// quality of the TRANSITIONS, and the two peak at different places. At 0.5σ the averages
// are strongest but half the Recovering calls fall straight back to Lagging, because
// small bounces fail. At 1σ the transitions are strongest but Lagging turns positive at
// the median, because a threshold that large keeps the label on through the rebound.
// 0.75σ is the only setting that beats the previous model on every one of those six
// numbers at once, and it sits mid-curve rather than on a peak.
//
// WHY THE MIDDLE OF A RANGE, AND NOT A MOVING AVERAGE. X used to be the gap to a 40-day
// EMA. The variable was chosen by profiling what actually HAPPENS inside each state —
// not what the levels are — on ten assets, NASDAQ 100 back to 1985 and Healthcare to
// 1998, against the swing ground truth. How much more likely an event is inside a state
// than on an average day:
//
//                                      Recovering  Trending  Fading  Lagging
//   new 20-day low                           0.70      0.04    0.85     3.23
//   new 52-week high                         0.72      2.10    0.56     0.00
//   MACD line crosses above zero             1.73      1.01    0.58     0.20
//   MACD crosses below its signal            0.56      0.85    1.74     1.28
//   MACD histogram tops out                  0.76      0.90    1.64     0.96
//   RSI crosses above 30                     1.50      0.25    0.56     1.88
//
// New highs against new lows is the sharpest separation in the whole study — 1.84 vs
// 0.04 in Trending, 0.01 vs 3.23 in Lagging, ratios of 40:1 and 80:1 — and the distance
// from the middle of a range is exactly that, measured continuously and in % of price so
// the radius still means the size of the move. Swapping it in moved every magnitude by
// less than one standard error (Recovering +1.4→+1.0 ±0.2, Lagging −1.6→−1.3 ±0.3) and
// moved the rotation far outside it: Recovering→Trending 57%→65% and Fading→Lagging
// 43%→57%, on ~570 bands, which is 3.8 and 6.7 standard errors.
//
// The volatility term comes from the same profile, and it is the only thing there the
// price axes cannot see: Recovering happens in disorder (21-day volatility +0.19σ above
// the asset's own normal) and Trending in calm (−0.28σ). Volume, which one would expect
// to matter, does not: across the four states it ranges from −0.05σ to +0.06σ. It was
// measured and left out.
//
// WHAT THE SEARCH ALSO SHOWED// WHAT THE SEARCH ALSO SHOWED, because it constrains what this model can promise:
//   • Which HALF of the cycle an asset is in — up-leg or down-leg — is readable from the
//     data: 69% recall on Trending, 54% on Lagging, 47% balanced against the swing truth
//     where a coin toss scores 25%.
//   • WHEN the leg will turn is not. At the moment it happens, Trending and Fading are
//     statistically the same picture (median RSI 60.5 vs 48.6, distance from a 100-day
//     trend +5.8% vs +1.7%), and no combination of the indicators tested recognises the
//     two turn zones better than ~40%. Recovering and Fading are therefore honest
//     warnings, not forecasts. Measured live on 84 assets over 20 years the forward return
//     is nearly identical in all four (+3.2% to +4.3% at three months): this model says
//     where an asset IS, not what it will do next.
//   • The price paid for describing the present correctly is speed: a label lasts ~18 days
//     against the ~29 days of a real turn zone, so the strip changes colour more often
//     than the 12-month version did (71 days). That is the trade, and it is deliberate:
//     the alternative was labels that stayed put while being wrong.
//
// AMPLITUDE. Distance from the centre is in % of price and is dominated by Y, which IS
// the size of the leg the asset is travelling — so it keeps meaning the size of the move,
// more directly than any earlier version: Bitcoin orbits at 23.7%, Micron 17.5%, Microsoft
// 9.9%, the S&P 500 7.1%, the TSX 6.0%. Measured on the real swings, one full cycle
// moves the S&P 500 about +14% up then −10% down over ~72 days, Micron +52%/−25% over
// ~130 days, Bitcoin +66%/−35% over ~114 days. A broad index orbits close in, a high-beta
// name orbits wide, and nothing here depends on any other asset: an asset's own history is
// the whole input, so adding a thousand tickers changes neither the answer nor its price.
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

/** The range the price is placed inside, in trading days. */
export const RANGE_SPAN = 40;
/** That position is averaged over this many trading days before use. */
export const RANGE_SMOOTH = 15;
/**
 * How much an unusually agitated market pushes X down, as a multiple of the range's own
 * half-width. Recovering happens in disorder (21-day volatility +0.19σ above the asset's
 * own normal) and Trending in calm (−0.28σ); this is the only place that fact is used.
 */
export const CALM_WEIGHT = 1;
/** The two windows whose ratio says whether the market is more agitated than usual. */
export const VOL_FAST = 21;
/** A leg turns when the price reverses by this multiple of its own monthly volatility. */
export const SWING_SIGMA = 0.75;
/** Floor on that reversal, %, so a near-motionless series still needs a real move. */
export const SWING_FLOOR = 2;
/** Window for the monthly volatility the threshold is scaled by, in trading days. */
export const VOL_SPAN = 63;
/** Calendar days of history the axes need, with room for the EMAs to converge. */
export const AXES_LOOKBACK_DAYS = 300;

/**
 * Which quadrant a point falls in.
 *
 * rangePos: % above (+) or below (−) the middle of the asset's own 40-day range (X).
 * momentum: where the price is inside the leg it is travelling — % above the low an
 * up-leg started from (+), or % below the high a down-leg started from (−) (Y).
 * Null when either is unknown; an asset without enough history has no position in the
 * cycle, and guessing one would be worse than saying nothing.
 */
export function classifyPhase(rangePos: number | null | undefined, momentum: number | null | undefined): RotationPhase | null {
  if (rangePos == null || momentum == null) return null;
  const up = rangePos > 0;
  // Exactly zero momentum means nothing has changed, so the leg simply continues.
  if (momentum === 0) return up ? 'Trending' : 'Lagging';
  if (momentum > 0) return up ? 'Trending' : 'Recovering';
  return up ? 'Fading' : 'Lagging';
}

/**
 * The asset's position in the quadrant as a POINT, not just a name: which quadrant,
 * how far from the centre, and at what angle.
 *
 * Distance from the centre is the size of the swing — a broad index orbits close in, a
 * high-beta name orbits wide — and it is the part a phase label throws away. Both axes
 * are in % of price, so the radius is a real distance.
 *
 * The angle turns CLOCKWISE through the cycle — Recovering 135°, Trending 45°,
 * Fading 315°, Lagging 225° — so a falling angle is an asset going round the way the
 * model says it should. That makes "does it actually rotate?" a number rather than an
 * impression; on the eight assets measured, 70% of the transitions step to the next
 * quadrant clockwise.
 */
export interface QuadrantPosition {
  phase: RotationPhase | null;
  /** X in %: the averaged distance from the middle of the 40-day range. */
  x: number;
  /** Y in %: how far into the current leg the price has travelled, signed by its direction. */
  y: number;
  /** Distance from the centre, in %. */
  radius: number;
  /** 0° = due right, increasing anticlockwise; the cycle runs the other way. */
  angle: number;
}

export function quadrantPosition(
  rangePos: number | null | undefined,
  momentum: number | null | undefined,
): QuadrantPosition | null {
  if (rangePos == null || momentum == null) return null;
  const x = rangePos, y = momentum;
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
 * Bars per month in this history. Crypto trades every day and equities ~21 days a
 * month, so a span counted in bars would mean a different amount of TIME for each.
 * Every window below is scaled by this, which is how the definition was measured.
 */
function barsPerMonth(hist: PricePoint[]): number {
  const tail = hist.slice(-Math.min(hist.length, 260));
  if (tail.length < 30) return 21;
  const days = (Date.parse(tail[tail.length - 1].date) - Date.parse(tail[0].date)) / 86_400_000;
  if (!(days > 0)) return 21;
  return Math.max(15, Math.min(31, (tail.length / days) * 30.44));
}

/** EMA over a closed array, seeded on the first value (history is a warm-up, not data). */
function emaSeries(v: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const out = new Array<number>(v.length);
  let prev = v[0];
  for (let i = 0; i < v.length; i++) { prev = i === 0 ? v[i] : v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export interface TrendAxes {
  /** X: % from the middle of the 40-day range, averaged, less the agitation penalty. */
  rangePos: number;
  /** Y: % into the current leg — above the low it started from, or below the high. */
  momentum: number;
}

/**
 * Realized monthly volatility per bar, in %, from a rolling window of log returns.
 * Kept as running sums rather than a re-scan per bar: this function is called once per
 * plotted date on a decade of history, and the naive version made that quadratic.
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
 * monthly volatility, so a 4% wobble ends a leg for the TSX and does not for Bitcoin,
 * and the threshold needs no per-asset tuning. Returns % above the low an up-leg
 * started from, or % below the high a down-leg started from — positive means the
 * price is advancing, negative that it is giving ground back.
 *
 * The scan is causal: at every bar it only ever looks at bars before it, so the value
 * on a past date is the value the model would have shown on that date.
 */
function swingPosition(closes: number[], vol: (number | null)[], fallbackVol: number): number {
  // `hi` tracks the high while an up-leg runs and becomes the top the following
  // down-leg retraces FROM; `lo` tracks the low while a down-leg runs and becomes the
  // bottom the following up-leg advances FROM. Neither is reset at the turn, so both
  // legs are measured from the real extreme rather than from the price at which the
  // reversal happened to be confirmed.
  //
  // The result is then clamped to the sign of the leg. Without that, a price slipping
  // just past the point its leg began — without falling far enough to end it — would
  // report a number whose sign contradicts the leg, and the sign is what decides the
  // phase. Zero there means "back at the start of the leg", which the classifier reads
  // as the leg simply continuing.
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

/**
 * The two quadrant coordinates as of a date, from the asset's own price history.
 * `asOf` defaults to the last bar. Null when the history is too short for the EMAs to
 * mean anything — reported rather than approximated, because an EMA-40 seeded ten bars
 * ago is just the last ten bars wearing a longer name.
 */
/**
 * Rolling min and max of `closes` over the last `span` bars, for the last `count` bars.
 * Only the tail is needed — this is called once per plotted date — so a plain scan is
 * both simpler and faster here than maintaining a deque over the whole history.
 */
function rangeTail(closes: number[], span: number, count: number): { mid: number; half: number }[] {
  const out: { mid: number; half: number }[] = [];
  for (let i = closes.length - count; i < closes.length; i++) {
    if (i < span) { out.push({ mid: NaN, half: NaN }); continue; }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - span + 1; j <= i; j++) { if (closes[j] > hi) hi = closes[j]; if (closes[j] < lo) lo = closes[j]; }
    const m = (hi + lo) / 2;
    out.push(m > 0
      ? { mid: (closes[i] / m - 1) * 100, half: ((hi - lo) / 2 / m) * 100 }
      : { mid: NaN, half: NaN });
  }
  return out;
}

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

  const bpm = barsPerMonth(hist.slice(0, lo));
  const scale = bpm / 21;
  const W = (d: number) => Math.max(2, Math.round(d * scale));
  const span = W(RANGE_SPAN), smooth = W(RANGE_SMOOTH);
  if (closes.length < span * 2.5 + smooth) return null;

  const vol = rollingVol(closes, W(VOL_SPAN));
  const volFast = rollingVol(closes, W(VOL_FAST));
  const known = vol.filter((v): v is number => v != null);
  if (!known.length) return null;
  // Median of what is known, for the bars before the volatility window is full: a
  // zero there would turn the floor into the only threshold and cut the early legs
  // at 2% regardless of what the asset normally does.
  const sorted = [...known].sort((a, b) => a - b);
  const volMedian = sorted[sorted.length >> 1];

  // X: how far the price sits from the MIDDLE of its own 40-day range, in % of price,
  // averaged over three weeks — then pushed down when the market is more agitated than
  // its own normal, by up to the range's half-width.
  const tail = rangeTail(closes, span, smooth);
  let sum = 0, n = 0;
  for (let k = 0; k < tail.length; k++) {
    const t = tail[k];
    if (!isFinite(t.mid)) continue;
    const i = closes.length - smooth + k;
    const fast = volFast[i], slow = vol[i] ?? volMedian;
    const agitation = fast != null && slow ? fast / slow - 1 : 0;
    sum += t.mid - CALM_WEIGHT * agitation * t.half;
    n++;
  }
  if (n < smooth) return null;
  const rangePos = sum / n;

  const momentum = swingPosition(closes, vol, volMedian);

  if (!isFinite(rangePos) || !isFinite(momentum)) return null;
  return { rangePos, momentum };
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — still in the lower half of its 40-day range, but the leg has turned up: the fall has stopped and the price is taking ground back. The entry.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — in the upper half of its 40-day range and still advancing: the move is running. This is where new highs happen — twice as often as on an average day.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — still in the upper half of its range, but the leg has turned down: MACD crossing below its signal is 1.7× more likely here than on an average day. The exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — in the lower half of its range and still giving ground: new 20-day lows are 3.2× more likely here than on an average day. Wait for Recovering.',
  },
};
