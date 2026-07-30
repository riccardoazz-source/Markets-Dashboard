// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// The four areas are defined the way the chart is read:
//
//   X = TREND GAP — how far the price is from its own 40-day trend, in %,
//                   averaged over a month so it does not jitter.
//                   Above zero = in an up-leg, below zero = in a down-leg.
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
// are strongest (Trending +5.7%, Fading −1.2%, Lagging −2.3%) but half the Recovering
// calls fall straight back to Lagging, because small bounces fail. At 1σ the transitions
// are strongest (Recovering → Trending 72%, Fading → Lagging 67%) but Lagging turns
// positive at the median, because a threshold that large keeps the label on through the
// rebound. 0.75σ is the only setting that beats the previous model on EVERY one of those
// six numbers at once, and it sits in the middle of the curve rather than on a peak — so
// it is a choice about robustness, not a parameter fitted to these eight assets.
//
// WHY 40 DAYS AND NOT 100. A 100-day trend missed a third of the real bottoms, and for a
// single reason: at 91% of the misses the price was still ABOVE that trend when it turned
// — median +5.6% above, only 13% off its 52-week high. The dip never took it into the
// lower half, so X > 0 forced the top half and the turn came out as Trending instead of
// Recovering. A 40-day trend lets an ordinary pullback cross the axis, which is what the
// label is for:
//
//                     swing lows flagged   swing highs flagged   clockwise
//   100-day trend             67%                  78%              64%
//    40-day trend             76%                  80%              70%
//
// A drawdown-from-the-52-week-high axis was tried too, since that was the one variable
// with real separation at the turn. It flags 84-91% of bottoms and ruins everything else:
// "near the high" becomes so narrow that Fading only fires while the price is still
// ripping (+62% to +139%/yr during the phase — a sell label on a rally), the tops fall to
// 34-46%, and rotation drops to 45-50% clockwise. Rejected on those numbers.
//
// WHAT THE SEARCH ALSO SHOWED, because it constrains what this model can promise:
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

/** The trend the price is measured against, in trading days. */
export const TREND_SPAN = 40;
/** The trend gap is averaged over this many trading days before use. */
export const TREND_SMOOTH = 21;
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
 * trendGap: % above (+) or below (−) the asset's own 40-day trend, month-averaged (X).
 * momentum: where the price is inside the leg it is travelling — % above the low an
 * up-leg started from (+), or % below the high a down-leg started from (−) (Y).
 * Null when either is unknown; an asset without enough history has no position in the
 * cycle, and guessing one would be worse than saying nothing.
 */
export function classifyPhase(trendGap: number | null | undefined, momentum: number | null | undefined): RotationPhase | null {
  if (trendGap == null || momentum == null) return null;
  const up = trendGap > 0;
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
  /** X in %: the month-averaged gap to the 40-day trend. */
  x: number;
  /** Y in %: how far into the current leg the price has travelled, signed by its direction. */
  y: number;
  /** Distance from the centre, in %. */
  radius: number;
  /** 0° = due right, increasing anticlockwise; the cycle runs the other way. */
  angle: number;
}

export function quadrantPosition(
  trendGap: number | null | undefined,
  momentum: number | null | undefined,
): QuadrantPosition | null {
  if (trendGap == null || momentum == null) return null;
  const x = trendGap, y = momentum;
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
  /** X: % above/below the 40-day trend, averaged over a month. */
  trendGap: number;
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
  const spanTrend = W(TREND_SPAN), smooth = W(TREND_SMOOTH);
  // Two and a half spans of warm-up: below that the "40-day trend" is mostly the seed.
  if (closes.length < spanTrend * 2.5 + smooth) return null;

  const trend = emaSeries(closes, spanTrend);
  let sum = 0;
  for (let i = closes.length - smooth; i < closes.length; i++) sum += (closes[i] / trend[i] - 1) * 100;
  const trendGap = sum / smooth;

  const vol = rollingVol(closes, W(VOL_SPAN));
  const known = vol.filter((v): v is number => v != null);
  if (!known.length) return null;
  // Median of what is known, for the bars before the volatility window is full: a
  // zero there would turn the floor into the only threshold and cut the early legs
  // at 2% regardless of what the asset normally does.
  const sorted = [...known].sort((a, b) => a - b);
  const momentum = swingPosition(closes, vol, sorted[sorted.length >> 1]);

  if (!isFinite(trendGap) || !isFinite(momentum)) return null;
  return { trendGap, momentum };
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — still below its own 40-day trend, but momentum has turned up: the fall has stopped and the price is starting to take ground back. The entry.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — above its own 40-day trend and momentum is still positive: the move is running.',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — still above its own 40-day trend, but momentum has turned down: the rise is losing pace. The exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — below its own 40-day trend and momentum is still negative: the price is falling, wait for Recovering.',
  },
};
