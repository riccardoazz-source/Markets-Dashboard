/**
 * Technical indicator computations.
 * All functions return arrays of the same length as the input (nulls where not enough history).
 */

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

/** MACD (12, 26, 9). Returns three arrays of length = closes.length. */
export function computeMACD(closes: number[]): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  const macd: (number | null)[] = ema12.map((v, i) =>
    v != null && ema26[i] != null ? v - ema26[i]! : null,
  );

  const startIdx = macd.findIndex(v => v !== null);
  if (startIdx === -1) {
    const empty = closes.map(() => null as number | null);
    return { macd, signal: empty, hist: empty };
  }

  // 9-period EMA of the contiguous MACD slice
  const macdSlice = macd.slice(startIdx) as number[];
  const signalSlice = computeEMA(macdSlice, 9);

  const signal: (number | null)[] = macd.map((_, i) =>
    i < startIdx ? null : signalSlice[i - startIdx],
  );

  const hist: (number | null)[] = macd.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i]! : null,
  );

  return { macd, signal, hist };
}
