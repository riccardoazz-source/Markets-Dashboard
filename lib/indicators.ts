/**
 * Technical indicator computations.
 * All functions return arrays of the same length as the input (nulls where not enough history).
 */

/**
 * Average calendar days represented by one bar, measured over the most recent
 * window (total elapsed span ÷ number of intervals).
 *
 * Using span/intervals — rather than averaging individual gaps with a hard
 * cutoff — makes this correct for ANY cadence:
 *   crypto (trades 7d/wk)   → ~1.0    weekly  → ~7
 *   equities (weekends off) → ~1.4    monthly → ~30
 *   quarterly (GDP)         → ~91     annual  → ~365
 *
 * The previous per-gap `< 45 days` filter silently dropped every
 * quarterly/annual gap, collapsing those series to 1.0 (treated as daily) and
 * mis-scaling every indicator on them. Averaging the span avoids that and is
 * naturally robust to weekend/holiday gaps.
 */
export function avgCalendarDaysPerBar(dates: string[]): number {
  if (dates.length < 3) return 1;
  const k = Math.min(dates.length - 1, 60);
  const last = new Date(dates[dates.length - 1]).getTime();
  const first = new Date(dates[dates.length - 1 - k]).getTime();
  const span = (last - first) / 86_400_000;
  return span > 0 ? span / k : 1;
}

/**
 * Convert a calendar-day duration to a bar count given the data's granularity.
 * @internal — prefer computeIndicatorPeriods() which handles all indicators at once.
 * e.g. 1400 calendar days (200 weeks) on daily crypto data (1 day/bar) → 1400 bars.
 *      1400 calendar days on daily equity data (1.4 days/bar) → 1000 bars.
 *      1400 calendar days on weekly data (7 days/bar) → 200 bars.
 */
export function barsForCalDays(calendarDays: number, avgDPB: number): number {
  return Math.max(2, Math.round(calendarDays / avgDPB));
}

/**
 * Periods (in bars) for all standard chart indicators.
 *
 * The bar-count indicators use their CONVENTIONAL period in bars — exactly like
 * TradingView, where "SMA 200" is 200 candles regardless of the instrument. These
 * are computed on the data's native daily bars, so "SMA 200" = 200 daily bars for
 * every asset (200 sessions for equities, 200 days for crypto). The previous
 * "N trading days × 1.4 calendar ÷ avgDPB" scaling only round-tripped to 200 for
 * equities (avgDPB ≈ 1.4); for crypto (avgDPB ≈ 1.0, trades 7 d/wk) it inflated
 * every period (e.g. SMA 200 → 280 bars), which is why crypto MAs disagreed with
 * TradingView. Literal bar counts fix that and leave equities unchanged.
 *
 * Only SMA 200W (defined in calendar WEEKS, not in the data's own bars) and the
 * momentum look-backs (calendar days) still scale by the data's granularity.
 *
 * `ok` guards feasibility; the real "enough history" check (n ≥ period) is done at
 * the call sites.
 */
export function computeIndicatorPeriods(avgDPB: number) {
  const lit = (period: number, minBars: number) => ({ period, ok: period >= Math.max(minBars, 2) });
  const cal = (calDays: number, minBars: number) => {
    const period = barsForCalDays(calDays, avgDPB);
    return { period, ok: period >= Math.max(minBars, 2) };
  };
  return {
    sma20:    lit(20,   3),
    sma50:    lit(50,   3),
    sma200:   lit(200,  3),
    sma200w:  cal(1400, 3),   // 200 calendar weeks → bars for this data's cadence
    ema20:    lit(20,   3),
    ema100:   lit(100,  3),
    boll:     lit(20,   10),  // 20-period Bollinger; min 10 for meaningful variance
    rsi:      lit(14,   10),
    macdFast: lit(12,   3),
    macdSlow: lit(26,   5),
    macdSig:  lit(9,    3),
    momWeek:  { period: Math.max(1, Math.round(7  / avgDPB)), ok: true },
    momMonth: { period: Math.max(1, Math.round(30 / avgDPB)), ok: true },
  };
}

// Bucket a daily series by a key function, keeping the last valid close of each bucket.
function resampleBy(
  dates: string[], closes: (number | null)[], keyOf: (iso: string) => string,
): { dates: string[]; closes: number[] } {
  const outD: string[] = [];
  const outC: number[] = [];
  let curKey = '';
  for (let i = 0; i < dates.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    const k = keyOf(dates[i]);
    if (k === curKey) { outD[outD.length - 1] = dates[i]; outC[outC.length - 1] = c; }
    else { curKey = k; outD.push(dates[i]); outC.push(c); }
  }
  return { dates: outD, closes: outC };
}

const mondayKey = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};

/**
 * Resample a daily series (dates ascending) to weekly closes — the last valid close of each
 * calendar week (Mon–Sun). Used for the 200-week SMA and weekly RSI/MACD so they match how
 * TradingView computes them on the weekly timeframe (from weekly closes).
 */
export function resampleWeekly(dates: string[], closes: (number | null)[]): { dates: string[]; closes: number[] } {
  return resampleBy(dates, closes, mondayKey);
}

/**
 * How many weekly closes a daily series actually yields.
 *
 * This is the REAL precondition for every weekly-timeframe indicator, and it is not the
 * same test as "enough daily bars". A thinly traded listing can span five calendar years
 * and still skip whole weeks, so it clears any bar-count estimate while the weekly
 * resample hands back fewer buckets than the indicator needs — and the tool then draws
 * nothing, from an enabled chip, with no explanation. Guarding on this number instead
 * means a chip is offered exactly when a line can be drawn.
 */
export function weeklyCloseCount(dates: string[], closes: (number | null)[]): number {
  return resampleWeekly(dates, closes).closes.length;
}

/** Resample a daily series to monthly closes — the last valid close of each calendar month. */
export function resampleMonthly(dates: string[], closes: (number | null)[]): { dates: string[]; closes: number[] } {
  return resampleBy(dates, closes, iso => iso.slice(0, 7)); // YYYY-MM
}

/**
 * 200-week SMA the TradingView way: resample to weekly closes, take SMA(200) of them, and hold
 * each weekly value forward onto the daily dates until the next week closes. Returns an array
 * aligned 1:1 with `dates` (null until 200 weekly closes exist). `dates`/`closes` are the raw
 * (possibly null-containing) daily series and must be index-aligned.
 */
export function computeSma200wDaily(dates: string[], closes: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(dates.length).fill(null);
  const w = resampleWeekly(dates, closes);
  if (w.closes.length < 200) return out;
  const wsma = computeSMA(w.closes, 200); // aligned to w.dates
  let j = 0;
  let lastVal: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    while (j < w.dates.length && w.dates[j] <= dates[i]) { if (wsma[j] != null) lastVal = wsma[j]; j++; }
    out[i] = lastVal;
  }
  return out;
}

/** Latest 200-week SMA value (TradingView-style weekly closes), or null if <200 weeks. */
export function computeSma200wLatest(dates: string[], closes: (number | null)[]): number | null {
  const series = computeSma200wDaily(dates, closes);
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i];
  return null;
}

/**
 * Long EMA on WEEKLY closes: resample to weekly closes, take EMA(`weeks`) of those, and hold
 * each weekly value forward onto the daily dates. Aligned 1:1 with `dates`, null until
 * `weeks` weekly closes exist.
 *
 * WEEKLY closes, not `weeks × 7` daily bars. The two are not the same average, and the
 * difference is not academic: an EMA weights recent observations more heavily, so feeding it
 * seven bars a week for crypto and five for equities would give the same nominal indicator a
 * different memory on each — and neither would match the line a chart package draws on the
 * weekly timeframe, which is where anybody quoting "the 50-week" is reading it.
 *
 * The period stays a parameter even though only 50 weeks is offered today: 50 is the
 * round-number convention (the family of the 50- and 200-day averages) and 55 the
 * Fibonacci one, they draw nearly the same line, and the difference between them is a
 * caller's choice rather than something this function should decide.
 */
export function computeEmaWeeklyDaily(
  dates: string[], closes: (number | null)[], weeks: number,
): (number | null)[] {
  const w = resampleWeekly(dates, closes);
  if (w.closes.length < weeks) return new Array(dates.length).fill(null);
  return projectBucketsToDaily(dates, w.dates, computeEMA(w.closes, weeks));
}

/** Latest weekly-EMA value, or null if under `weeks` weekly closes. */
export function computeEmaWeeklyLatest(
  dates: string[], closes: (number | null)[], weeks: number,
): number | null {
  const series = computeEmaWeeklyDaily(dates, closes, weeks);
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i];
  return null;
}

export type Grain = 'weekly' | 'monthly';

const resampleGrain = (grain: Grain, dates: string[], closes: (number | null)[]) =>
  grain === 'monthly' ? resampleMonthly(dates, closes) : resampleWeekly(dates, closes);

// Hold a value-per-bucket series (aligned to bucketDates) forward onto each daily date.
function projectBucketsToDaily(
  dates: string[], bucketDates: string[], bucketVals: (number | null)[],
): (number | null)[] {
  const out: (number | null)[] = new Array(dates.length).fill(null);
  let j = 0;
  let lastVal: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    while (j < bucketDates.length && bucketDates[j] <= dates[i]) { if (bucketVals[j] != null) lastVal = bucketVals[j]; j++; }
    out[i] = lastVal;
  }
  return out;
}

/**
 * RSI(period) computed on WEEKLY or MONTHLY closes, then held forward onto each daily date.
 * Returns an array aligned 1:1 with `dates`, so a higher-timeframe RSI can be drawn on a daily
 * chart — matching TradingView's weekly/monthly RSI. `dates`/`closes` are the raw daily series.
 */
export function computeRsiResampledDaily(
  dates: string[], closes: (number | null)[], grain: Grain, period = 14,
): (number | null)[] {
  const w = resampleGrain(grain, dates, closes);
  if (w.closes.length <= period) return new Array(dates.length).fill(null);
  return projectBucketsToDaily(dates, w.dates, computeRSI(w.closes, period));
}

/** Sliding-window Simple Moving Average — O(n). */
export function computeSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    result.push(i < period - 1 ? null : sum / period);
  }
  return result;
}

/** Exponential Moving Average seeded with SMA. */
export function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length < period) return closes.map(() => null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(period - 1).fill(null);
  const seed = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(seed);
  let prev = seed;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

/** RSI using Wilder smoothing, period defaults to 14. */
export function computeRSI(closes: number[], period = 14): (number | null)[] {
  if (closes.length <= period) return closes.map(() => null);
  const result: (number | null)[] = new Array(period).fill(null);

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

/**
 * Bollinger Bands — middle = SMA(period), upper/lower = middle ± mult·σ.
 * σ is the population standard deviation of the rolling window.
 * Sliding sums of x and x² keep it O(n).
 */
export function computeBollingerBands(
  closes: number[],
  period = 20,
  mult = 2,
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const middle: (number | null)[] = [];
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  let sum = 0, sumSq = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    sumSq += closes[i] * closes[i];
    if (i >= period) {
      sum -= closes[i - period];
      sumSq -= closes[i - period] * closes[i - period];
    }
    if (i < period - 1) {
      middle.push(null); upper.push(null); lower.push(null);
    } else {
      const mean = sum / period;
      // Clamp tiny negatives from floating-point cancellation before sqrt.
      const variance = Math.max(sumSq / period - mean * mean, 0);
      const sd = Math.sqrt(variance);
      middle.push(mean);
      upper.push(mean + mult * sd);
      lower.push(mean - mult * sd);
    }
  }
  return { middle, upper, lower };
}

/** Standard Fibonacci retracement ratios. */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/**
 * Fibonacci retracement levels for the period's high/low range.
 * 0 % sits at the period high, 100 % at the period low.
 */
export function computeFibLevels(closes: number[]): { ratio: number; value: number }[] {
  if (closes.length < 2) return [];
  let high = closes[0], low = closes[0];
  for (const c of closes) {
    if (c > high) high = c;
    if (c < low) low = c;
  }
  if (high === low) return [];
  return FIB_RATIOS.map(r => ({ ratio: r, value: high - r * (high - low) }));
}

/**
 * Rate of Change (Momentum): (close[i] - close[i-period]) / close[i-period] * 100.
 * period=1 → daily, period=5 → weekly, period=21 → monthly.
 */
export function computeMomentum(closes: number[], period: number): (number | null)[] {
  return closes.map((c, i) => {
    if (i < period) return null;
    const prev = closes[i - period];
    return prev > 0 ? (c / prev - 1) * 100 : null;
  });
}

/**
 * Ordinary-least-squares trend line: fits y = intercept + slope·x with x = bar index.
 * Returns the coefficients (evaluate at any index to get the fitted price), or null when
 * there are fewer than 2 valid points. Used by the Trend tool — fit on the visible data
 * OR on the full history, then evaluate at the visible bars' indices.
 */
export function computeTrendLine(closes: (number | null)[]): { slope: number; intercept: number } | null {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < closes.length; i++) {
    const y = closes[i];
    if (y == null || !isFinite(y)) continue;
    n++; sx += i; sy += y; sxy += i * y; sxx += i * i;
  }
  if (n < 2) return null;
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/**
 * MACD(fast/slow/signal) computed on WEEKLY or MONTHLY closes, each series held forward onto the
 * daily dates. Returns arrays aligned 1:1 with `dates`, so a higher-timeframe MACD can be drawn
 * on a daily chart — matching TradingView's weekly/monthly MACD. `dates`/`closes` are raw daily.
 */
export function computeMacdResampledDaily(
  dates: string[], closes: (number | null)[], grain: Grain, fast = 12, slow = 26, signal = 9,
): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
  const empty = () => new Array(dates.length).fill(null) as (number | null)[];
  const w = resampleGrain(grain, dates, closes);
  if (w.closes.length <= slow + signal) return { macd: empty(), signal: empty(), hist: empty() };
  const m = computeMACD(w.closes, fast, slow, signal); // aligned to w.dates
  return {
    macd:   projectBucketsToDaily(dates, w.dates, m.macd),
    signal: projectBucketsToDaily(dates, w.dates, m.signal),
    hist:   projectBucketsToDaily(dates, w.dates, m.hist),
  };
}

/** MACD (default 12/26/9 trading days, auto-scaled via barsForCalDays). Returns three arrays of length = closes.length. */
export function computeMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const emaFast = computeEMA(closes, fast);
  const emaSlow = computeEMA(closes, slow);

  const macd: (number | null)[] = emaFast.map((v, i) =>
    v != null && emaSlow[i] != null ? v - emaSlow[i]! : null,
  );

  const startIdx = macd.findIndex(v => v !== null);
  if (startIdx === -1) {
    const empty = closes.map(() => null as number | null);
    return { macd, signal: empty, hist: empty };
  }

  const macdSlice = macd.slice(startIdx) as number[];
  const signalSlice = computeEMA(macdSlice, signal);

  const sig: (number | null)[] = macd.map((_, i) =>
    i < startIdx ? null : signalSlice[i - startIdx],
  );

  const hist: (number | null)[] = macd.map((v, i) =>
    v != null && sig[i] != null ? v - sig[i]! : null,
  );

  return { macd, signal: sig, hist };
}

// Volume aggregated to the chosen grain. Weekly and monthly are SUMS — a week's
// volume is the volume that traded that week, not an average of its days — and the
// colour comes from the period's own close against the previous period's, so the
// question the pane answers ("were the heavy periods buying or selling?") stays the
// same at every grain. The total is placed on the period's LAST day so the bars
// keep sharing the price chart's daily axis, and the crosshair still lines up.
export type VolumeGrain = 'daily' | 'weekly' | 'monthly';

function mondayOf(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;            // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function aggregateVolume(
  data: { date: string; close: number; volume?: number | null }[],
  grain: VolumeGrain,
): { date: string; volume: number | null; up: boolean }[] {
  if (grain === 'daily') {
    return data.map((d, i) => ({
      date: d.date,
      volume: d.volume ?? null,
      up: i === 0 ? true : d.close >= data[i - 1].close,
    }));
  }
  const keyOf = (d: string) => (grain === 'monthly' ? d.slice(0, 7) : mondayOf(d));
  // One entry per period: where it ends, how much traded, how it closed.
  const periods: { endDate: string; total: number | null; close: number }[] = [];
  let curKey: string | null = null;
  for (const d of data) {
    const k = keyOf(d.date);
    if (k !== curKey) { periods.push({ endDate: d.date, total: null, close: d.close }); curKey = k; }
    const p = periods[periods.length - 1];
    p.endDate = d.date;
    p.close = d.close;
    if (d.volume != null) p.total = (p.total ?? 0) + d.volume;
  }
  const byEnd = new Map(periods.map((p, i) => [p.endDate, {
    volume: p.total,
    up: i === 0 ? true : p.close >= periods[i - 1].close,
  }]));
  // Every date is kept — a period's total sits on its last bar, the rest are blank —
  // so the series still matches the price chart's categories one for one.
  return data.map(d => {
    const hit = byEnd.get(d.date);
    return { date: d.date, volume: hit ? hit.volume : null, up: hit ? hit.up : true };
  });
}

// ── Cycle-shape indicators ───────────────────────────────────────────────────
// Three quantities the model needs but nothing could see: how far price sits from
// its own trend, whether that trend is turning, and how deep and how old the
// drawdown is. All three are self-referential — nothing about any other asset —
// which is what makes them candidates for the quadrant's vertical axis.

/**
 * Rolling realised monthly volatility (%): the standard deviation of daily returns
 * scaled by √21. The same definition the rotation model uses, so "one σ" means the
 * same thing on a chart and inside the score.
 */
export function computeMonthlyVol(closes: number[], lookback = 63): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const rets: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets[i] = closes[i] / closes[i - 1] - 1;
  }
  for (let i = 0; i < closes.length; i++) {
    const from = Math.max(1, i - lookback + 1);
    const w: number[] = [];
    for (let j = from; j <= i; j++) if (rets[j] != null) w.push(rets[j] as number);
    if (w.length < 15) continue;   // below this the estimate is noise, not a measure
    const mean = w.reduce((s, r) => s + r, 0) / w.length;
    const varc = w.reduce((s, r) => s + (r - mean) ** 2, 0) / (w.length - 1);
    out[i] = Math.sqrt(varc) * Math.sqrt(21) * 100;
  }
  return out;
}

/**
 * Distance from the long moving average measured in months of the asset's own
 * volatility: (price/MA − 1) ÷ monthly σ.
 *
 * SIGNED, unlike the model's internal stretch, which clips the downside away
 * because it exists only to brake a blow-off. Here the negative half is the
 * interesting one — it is where an asset trading well below its trend lives — and
 * dividing by σ is what makes −2 mean the same thing on an index as on a crypto,
 * where a raw percentage would not.
 */
export function computeStretchSigma(closes: number[], maPeriod = 200, volLookback = 63): (number | null)[] {
  const ma = computeSMA(closes, maPeriod);
  const vol = computeMonthlyVol(closes, volLookback);
  return closes.map((c, i) => {
    const m = ma[i], v = vol[i];
    if (m == null || m <= 0 || v == null || v <= 0) return null;
    return ((c / m - 1) * 100) / v;
  });
}

/**
 * Slope of the long moving average, in % per `spanBars` (pass ~a month of bars).
 * The point of it: acceleration flips sign every few weeks, so it cannot describe a
 * cycle — the slope of a 200-bar average changes slowly and keeps its sign for
 * quarters, which is the behaviour a phase needs.
 */
export function computeMaSlope(closes: number[], maPeriod = 200, spanBars = 21): (number | null)[] {
  const ma = computeSMA(closes, maPeriod);
  return ma.map((v, i) => {
    const prev = i >= spanBars ? ma[i - spanBars] : null;
    if (v == null || prev == null || prev <= 0) return null;
    return (v / prev - 1) * 100;
  });
}

/**
 * How long price has been on one side of the long average, in months, signed:
 * positive = months above, negative = months below. One series carries both the
 * regime and its age, and the zero crossing is the regime change itself.
 */
export function computeRegimeMonths(closes: number[], maPeriod = 200, avgDPB = 1.4): (number | null)[] {
  const ma = computeSMA(closes, maPeriod);
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let run = 0;
  let side = 0;   // +1 above, −1 below
  for (let i = 0; i < closes.length; i++) {
    const m = ma[i];
    if (m == null || m <= 0) { run = 0; side = 0; continue; }
    const s = closes[i] >= m ? 1 : -1;
    run = s === side ? run + 1 : 1;
    side = s;
    out[i] = (s * run * avgDPB) / 30.44;   // bars → calendar months
  }
  return out;
}

/** Rolling maximum over the trailing `window` bars, and the index it occurred at. */
function rollingMaxWithIndex(closes: number[], window: number): { max: (number | null)[]; at: (number | null)[] } {
  const max: (number | null)[] = new Array(closes.length).fill(null);
  const at: (number | null)[] = new Array(closes.length).fill(null);
  // Monotonic deque of candidate indices, largest first — O(n) rather than O(n·w).
  const dq: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    while (dq.length && dq[0] <= i - window) dq.shift();
    while (dq.length && closes[dq[dq.length - 1]] <= closes[i]) dq.pop();
    dq.push(i);
    max[i] = closes[dq[0]];
    at[i] = dq[0];
  }
  return { max, at };
}

/**
 * Drawdown from the trailing 52-week high, in % (always ≤ 0). "How far it has
 * fallen" — the depth of the hole, which the phase study suggests is where the
 * useful signal lives.
 */
export function computeDrawdown(closes: number[], window = 252): (number | null)[] {
  const { max } = rollingMaxWithIndex(closes, window);
  return closes.map((c, i) => {
    const m = max[i];
    if (m == null || m <= 0) return null;
    return (c / m - 1) * 100;
  });
}

/**
 * Months since that 52-week high. Depth and age are different questions — a −30%
 * drawdown one month old is a crash, the same drawdown eighteen months old is a
 * base — and only the second one is an entry.
 */
export function computeMonthsSinceHigh(dates: string[], closes: number[], window = 252): (number | null)[] {
  const { at } = rollingMaxWithIndex(closes, window);
  return closes.map((_, i) => {
    const j = at[i];
    if (j == null) return null;
    const days = (new Date(dates[i]).getTime() - new Date(dates[j]).getTime()) / 86_400_000;
    return days >= 0 ? days / 30.44 : null;
  });
}
