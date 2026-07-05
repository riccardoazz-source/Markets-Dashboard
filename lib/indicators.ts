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
 * Scaled periods (in bars) for all standard chart indicators, adapted to the
 * data's granularity. Each indicator is defined by a real-world calendar span:
 *
 *   "SMA 20"  = 20 trading days × 1.4 cal/trading = 28 cal days
 *   "SMA 200W"= 200 weeks × 7                     = 1400 cal days
 *   "RSI 14"  = 14 trading days × 1.4             = 20 cal days
 *   …
 *
 * A chip is considered feasible (not disabled) only if its computed period
 * is ≥ its minBars. Returns both the period to pass to computeXXX and a
 * boolean `ok` that drives the disabled prop.
 */
export function computeIndicatorPeriods(avgDPB: number) {
  // p(calendarDays, minBars) → { period, ok: period >= minBars && period >= 2 }
  const p = (calDays: number, minBars: number) => {
    const period = barsForCalDays(calDays, avgDPB);
    return { period, ok: period >= Math.max(minBars, 2) };
  };
  return {
    sma20:    p(28,   3),    // 20 trading days
    sma50:    p(70,   3),    // 50 trading days
    sma200:   p(280,  3),    // 200 trading days
    sma200w:  p(1400, 3),    // 200 calendar weeks
    ema20:    p(28,   3),    // 20 trading days
    ema100:   p(140,  3),    // 100 trading days
    boll:     p(28,   10),   // 20 trading days; min 10 for meaningful variance
    rsi:      p(20,   10),   // 14 trading days
    macdFast: p(17,   3),    // 12 trading days
    macdSlow: p(36,   5),    // 26 trading days
    macdSig:  p(13,   3),    // 9 trading days
    momWeek:  { period: Math.max(1, Math.round(7  / avgDPB)), ok: true },
    momMonth: { period: Math.max(1, Math.round(30 / avgDPB)), ok: true },
  };
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
