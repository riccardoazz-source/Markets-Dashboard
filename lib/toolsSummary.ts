import type { ActiveTools } from '@/components/ui/ChartTools';
import { HistoricalPoint } from './types';
import {
  computeSMA, computeEMA, computeRSI, computeMACD, computeBollingerBands, computeMomentum,
  computeSma200wLatest, computeEma55wLatest, computeRsiResampledDaily, computeMacdResampledDaily, computeTrendLine,
  avgCalendarDaysPerBar, computeIndicatorPeriods,
} from './indicators';

const lastOf = (a: (number | null)[]): number | null => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i];
  return null;
};
const fmt = (v: number | null): string | null =>
  v == null || !isFinite(v) ? null : (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));

/**
 * Human-readable summary of the indicators the user currently has active on the chart, with
 * their latest values where computable on the given points. Fed to the AI so it "sees" the same
 * tools the user does. Values are computed on the visible-timeframe points (what the user sees);
 * long look-backs that don't fit the window are listed by name without a value.
 */
export function summarizeTools(t: ActiveTools, points: HistoricalPoint[]): string[] {
  const out: string[] = [];
  const dates = points.map(p => p.date);
  const rawCloses = points.map(p => p.close);
  const closes = rawCloses.filter((c): c is number => typeof c === 'number' && isFinite(c));
  const n = closes.length;
  if (n < 2) return out;
  const P = computeIndicatorPeriods(avgCalendarDaysPerBar(dates));

  const withVal = (label: string, v: number | null, digits?: (x: number) => string) => {
    if (v == null) { out.push(label); return; }
    out.push(`${label}: ${digits ? digits(v) : fmt(v)}`);
  };

  if (t.avg) out.push(`Average: ${fmt(closes.reduce((s, v) => s + v, 0) / n)}`);
  if (t.minMax) out.push(`Range: ${fmt(Math.min(...closes))}–${fmt(Math.max(...closes))}`);
  if (t.sma20)  n >= 20  ? withVal('SMA 20',  lastOf(computeSMA(closes, 20)))  : out.push('SMA 20');
  if (t.sma50)  n >= 50  ? withVal('SMA 50',  lastOf(computeSMA(closes, 50)))  : out.push('SMA 50');
  if (t.sma200) n >= 200 ? withVal('SMA 200', lastOf(computeSMA(closes, 200))) : out.push('SMA 200');
  if (t.sma200w) withVal('SMA 200W', computeSma200wLatest(dates, rawCloses));
  if (t.ema55w) withVal('EMA 55W', computeEma55wLatest(dates, rawCloses));
  if (t.ema20)  n >= 20  ? withVal('EMA 20',  lastOf(computeEMA(closes, 20)))  : out.push('EMA 20');
  if (t.ema100) n >= 100 ? withVal('EMA 100', lastOf(computeEMA(closes, 100))) : out.push('EMA 100');
  if (t.bollinger && n >= P.boll.period) {
    const b = computeBollingerBands(closes, P.boll.period, 2);
    const lo = lastOf(b.lower), hi = lastOf(b.upper);
    out.push(`Bollinger 20·2σ: ${fmt(lo)}–${fmt(hi)}`);
  } else if (t.bollinger) out.push('Bollinger 20·2σ');
  if (t.fib) out.push('Fibonacci retracement');

  if (t.trend) {
    const fit = computeTrendLine(closes);
    out.push(`Trend line (${t.trendFull ? 'full history' : 'visible period'}${fit ? fit.slope >= 0 ? ', rising' : ', falling' : ''})`);
  }

  if (t.rsi) {
    const g: 'daily' | 'weekly' | 'monthly' = t.rsiMonthly ? 'monthly' : t.rsiWeekly ? 'weekly' : 'daily';
    const v = g === 'daily' ? lastOf(computeRSI(closes, 14)) : lastOf(computeRsiResampledDaily(dates, rawCloses, g, 14));
    withVal(`RSI 14 (${g})`, v, x => x.toFixed(1));
  }
  if (t.macd) {
    const g: 'daily' | 'weekly' | 'monthly' = t.macdMonthly ? 'monthly' : t.macdWeekly ? 'weekly' : 'daily';
    const m = g === 'daily' ? computeMACD(closes) : computeMacdResampledDaily(dates, rawCloses, g);
    const macd = lastOf(m.macd), sig = lastOf(m.signal), hist = lastOf(m.hist);
    if (macd != null && sig != null) out.push(`MACD 12/26/9 (${g}): macd ${fmt(macd)}, signal ${fmt(sig)}, hist ${fmt(hist)}`);
    else out.push(`MACD 12/26/9 (${g})`);
  }

  const mom = (label: string, period: number) => {
    const v = n > period ? lastOf(computeMomentum(closes, period)) : null;
    withVal(label, v, x => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`);
  };
  if (t.momentumDaily)   mom('Momentum ROC daily', 1);
  if (t.momentumWeekly)  mom('Momentum ROC weekly', P.momWeek.period);
  if (t.momentumMonthly) mom('Momentum ROC monthly', P.momMonth.period);
  if (t.spyRatio) out.push('vs SPY benchmark overlay');

  return out;
}
