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
