'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { HistoricalPoint, Timeframe, QuoteData } from '@/lib/types';
import {
  calculateCAGR, formatPercent, formatPrice, colorForPercent,
  buildTotalReturnSeries, computeAssetIRR, DividendEvent, dataAvailabilityMessage,
  spyBenchmarkSeries,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { Sma200wLine, Ma200dLine, MaSpreadLine } from '@/components/ui/Sma200wLine';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore, rangeDurationLabel } from '@/lib/useChartDragSelect';
import { useGistData, usePins } from '@/lib/gist';
import { useRotationPhases } from '@/lib/useRotationPhases';
import { PhaseChip, PinButton, RotationFilterBar, MAFilterChips, PhaseFilter, isBelowMA } from '@/components/ui/RotationControls';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  avgCalendarDaysPerBar, computeIndicatorPeriods,
  computeBollingerBands, computeFibLevels, computeTrendLine, computeSma200wDaily, computeRsiResampledDaily, computeMacdResampledDaily,
} from '@/lib/indicators';
import { useFullHistory } from '@/lib/useFullHistory';
import {
  ResponsiveContainer, LineChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, ComposedChart, Cell, ReferenceArea, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { Search, X, BarChart2, TrendingUp, TrendingDown } from 'lucide-react';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { summarizeTools } from '@/lib/toolsSummary';
import { ReturnsTableButton } from '@/components/ui/ReturnsTableButton';
import { DetailModal } from '@/components/ui/DetailModal';
import { useAvgYearly } from '@/lib/useAvgYearly';
import { DividendsBarChart } from '@/components/charts/DividendsBarChart';

interface EarningsPoint { date: string; period: string; eps: number; estimate?: number }
interface FinancialPoint {
  date: string;
  revenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  isAnnual?: boolean;
}
interface EarningsData {
  quarterly: EarningsPoint[];
  financials: FinancialPoint[];
  currency: string;
}

type Overlay = 'none' | 'eps' | 'financials';

function formatBig(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// Trailing-twelve-months EPS: sum of the four most-recent quarterly entries.
// Falls back to the latest annual figure if four quarters aren't available.
// Many companies (e.g. NVDA) don't file Q4 as a separate XBRL quarterly fact —
// it only exists implicitly as FY − (Q1+Q2+Q3). This function fills that gap:
// when it finds a >130-day hole between consecutive quarterly entries and an
// annual entry covers the gap, it derives Q4 = Annual − (Q1+Q2+Q3).
function buildCompleteQuarterlyEps(eps: EarningsPoint[]): EarningsPoint[] {
  const quarterly = eps
    .filter(e => !e.period.startsWith('FY '))
    .sort((a, b) => a.date.localeCompare(b.date));
  const annuals = eps
    .filter(e => e.period.startsWith('FY '))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!annuals.length) return quarterly;

  const result = [...quarterly];
  const qDates = new Set(quarterly.map(q => q.date));

  for (const annual of annuals) {
    if (qDates.has(annual.date)) continue; // Q4 already filed explicitly
    // Find the 3 quarterly entries inside this fiscal year (within 385 days before year-end)
    const fyStartMs = new Date(annual.date).getTime() - 385 * 86_400_000;
    const fyStartStr = new Date(fyStartMs).toISOString().slice(0, 10);
    const fyQs = quarterly.filter(q => q.date > fyStartStr && q.date <= annual.date);
    if (fyQs.length !== 3) continue; // can't safely derive Q4
    const derived = annual.eps - fyQs.reduce((s, q) => s + q.eps, 0);
    result.push({ date: annual.date, period: annual.date, eps: derived });
    qDates.add(annual.date);
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function computeTtmEps(eps: EarningsPoint[]): number | null {
  const q = buildCompleteQuarterlyEps(eps).sort((a, b) => b.date.localeCompare(a.date));
  if (q.length >= 4) return q.slice(0, 4).reduce((s, e) => s + e.eps, 0);
  const a = eps.filter(e => e.period.startsWith('FY ')).sort((a, b) => b.date.localeCompare(a.date));
  return a[0]?.eps ?? null;
}

// Arithmetic mean of rolling-TTM P/E across every price point in the period.
// Skips negative/zero TTM EPS (P/E meaningless) and extreme outliers from near-zero TTM.
function computeAvgPe(prices: HistoricalPoint[], eps: EarningsPoint[]): number | null {
  if (!prices.length || !eps.length) return null;
  const qEps = buildCompleteQuarterlyEps(eps);
  if (qEps.length < 4) return null;
  let idx = -1, sum = 0, n = 0;
  for (const p of prices) {
    while (idx + 1 < qEps.length && qEps[idx + 1].date <= p.date) idx++;
    if (idx < 3) continue;
    const ttm = qEps[idx - 3].eps + qEps[idx - 2].eps + qEps[idx - 1].eps + qEps[idx].eps;
    if (ttm <= 0) continue;
    const pe = p.close / ttm;
    if (pe < 5000) { sum += pe; n++; }
  }
  return n > 0 ? sum / n : null;
}

// Annual dividend yield using the trailing-12-months sum / current price.
function computeDivYield(divs: DividendEvent[], price: number): number | null {
  if (!divs.length || !price) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const ttm = divs.filter(d => new Date(d.date) >= cutoff).reduce((s, d) => s + d.amount, 0);
  return ttm > 0 ? (ttm / price) * 100 : null;
}

// CAGR over full calendar years of dividend totals. Ignores the current (partial)
// year so two partial-year halves don't skew the rate.
function computeDivCAGR(divs: DividendEvent[]): { cagr: number; years: number } | null {
  if (divs.length < 4) return null;
  const byYear = new Map<number, number>();
  for (const d of divs) {
    const y = new Date(d.date).getFullYear();
    byYear.set(y, (byYear.get(y) ?? 0) + d.amount);
  }
  const years = Array.from(byYear.keys()).sort();
  const currentYear = new Date().getFullYear();
  const full = years.filter(y => y < currentYear && (byYear.get(y) ?? 0) > 0);
  if (full.length < 2) return null;
  const first = byYear.get(full[0])!;
  const last = byYear.get(full[full.length - 1])!;
  const n = full[full.length - 1] - full[0];
  if (first <= 0 || last <= 0 || n <= 0) return null;
  return { cagr: (Math.pow(last / first, 1 / n) - 1) * 100, years: n };
}

// CAGR from earliest to latest annual EPS entry.
function computeEpsCAGR(eps: EarningsPoint[]): { cagr: number; years: number } | null {
  const annual = eps.filter(e => e.period.startsWith('FY ')).sort((a, b) => a.date.localeCompare(b.date));
  if (annual.length < 2) return null;
  const first = annual[0].eps;
  const last = annual[annual.length - 1].eps;
  const n = parseInt(annual[annual.length - 1].period.slice(3), 10) - parseInt(annual[0].period.slice(3), 10);
  // Sign-flips make CAGR meaningless; skip.
  if (first <= 0 || last <= 0 || n <= 0) return null;
  return { cagr: (Math.pow(last / first, 1 / n) - 1) * 100, years: n };
}

// CAGR from earliest to latest annual revenue entry.
function computeRevenueCAGR(fin: FinancialPoint[]): { cagr: number; years: number } | null {
  const annual = fin.filter(f => f.isAnnual && f.revenue != null).sort((a, b) => a.date.localeCompare(b.date));
  if (annual.length < 2) return null;
  const first = annual[0].revenue!;
  const last = annual[annual.length - 1].revenue!;
  const n = new Date(annual[annual.length - 1].date).getFullYear() - new Date(annual[0].date).getFullYear();
  if (first <= 0 || last <= 0 || n <= 0) return null;
  return { cagr: (Math.pow(last / first, 1 / n) - 1) * 100, years: n };
}

// Median gap between recent quarterly entries → reporting cadence.
function detectReportingFreq(eps: EarningsPoint[]): string {
  const q = eps.filter(e => !e.period.startsWith('FY ')).sort((a, b) => a.date.localeCompare(b.date));
  if (q.length < 2) return eps.some(e => e.period.startsWith('FY ')) ? 'annual only' : '';
  const recent = q.slice(-8);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push((new Date(recent[i].date).getTime() - new Date(recent[i - 1].date).getTime()) / 86_400_000);
  }
  deltas.sort((a, b) => a - b);
  const med = deltas[Math.floor(deltas.length / 2)];
  if (med <= 100) return 'quarterly';
  if (med <= 200) return 'semi-annual';
  return 'less frequent';
}

const TF_OPTIONS: Timeframe[] = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

type StockSortKey = 'changePercent' | 'oneMonthChangePercent' | 'threeMonthChangePercent' | 'sixMonthChangePercent' | 'mtdChangePercent' | 'ytdChangePercent' | 'fiveYearChangePercent' | 'fiveYearCagrPercent' | 'avgYearly';

const WATCHLIST_SORT_OPTIONS: { value: StockSortKey; label: string }[] = [
  { value: 'changePercent',            label: 'Day' },
  { value: 'oneMonthChangePercent',    label: '1M' },
  { value: 'threeMonthChangePercent',  label: '3M' },
  { value: 'sixMonthChangePercent',    label: '6M' },
  { value: 'mtdChangePercent',         label: 'MTD' },
  { value: 'ytdChangePercent',         label: 'YTD' },
  { value: 'fiveYearChangePercent',    label: '5Y' },
  { value: 'fiveYearCagrPercent',      label: 'CAGR' },
  { value: 'avgYearly',                label: 'Avg Yr' },
];

interface SearchHit { symbol: string; name: string; exchange: string; type: string }
interface StockData {
  symbol: string;
  meta: { price: number; previousClose: number; currency: string; high52w: number | null; low52w: number | null } | null;
  prices: HistoricalPoint[];
  dividends: DividendEvent[];
}

function formatXDate(dateStr: string, data: HistoricalPoint[]) {
  try {
    const d = parseISO(dateStr);
    if (data.length < 2) return format(d, 'MMM d');
    const span = (new Date(data[data.length - 1].date).getTime() - new Date(data[0].date).getTime()) / (365.25 * 86400 * 1000);
    if (span < 0.5) return format(d, 'MMM d');
    if (span < 4) return format(d, "MMM ''yy");
    return format(d, 'yyyy');
  } catch { return dateStr; }
}

interface DualChartToolsOverlay {
  avg?: boolean;
  stdDev?: boolean;
  minMax?: boolean;
  sma20?: boolean;
  sma50?: boolean;
  sma200?: boolean;
  ema20?: boolean;
  bollinger?: boolean;
  fib?: boolean;
  spyRatio?: boolean;
  sma200w?: boolean;
  trend?: boolean;
  trendFull?: boolean;
}

function DualChart({
  prices, symbol, totalReturn, currency, eps, financials, toolsOverlay, spyPrices, onSetRange,
}: {
  prices: HistoricalPoint[];
  symbol?: string;
  totalReturn: HistoricalPoint[];
  currency: string;
  eps?: EarningsPoint[];
  financials?: FinancialPoint[];
  toolsOverlay?: DualChartToolsOverlay;
  spyPrices?: HistoricalPoint[];
  onSetRange?: (from: string, to: string) => void;
}) {
  const { handlers, range, area, clear } = useChartDragSelect();
  // Full daily history so every moving average + the full-history trend line render on short
  // windows (a MA is a fixed number today, independent of the view period).
  const wantsFullMA = !!(toolsOverlay?.sma20 || toolsOverlay?.sma50 || toolsOverlay?.sma200 ||
    toolsOverlay?.sma200w || toolsOverlay?.ema20);
  const wantsFullTrend = !!(toolsOverlay?.trend && toolsOverlay?.trendFull);
  const fullHist = useFullHistory(symbol, wantsFullMA || wantsFullTrend);
  if (!prices.length) return null;
  const hasDivs = totalReturn !== prices && totalReturn.length > 0 &&
    Math.abs((totalReturn[totalReturn.length - 1]?.close ?? 0) - (prices[prices.length - 1]?.close ?? 0)) > 0.0001;

  const firstDate = prices[0].date;
  const lastDate = prices[prices.length - 1].date;

  // For EPS/financials overlays: include all entries within the visible price range.
  // Prefer quarterly entries if at least 2 exist; fall back to annual so the user
  // always sees bars when data is available. Snapping to price dates means bars land on
  // visible data points. No artificial slice — the visible-range filter naturally limits
  // the bar count to what fits the chart.
  const inRange = (d: string) => d >= firstDate && d <= lastDate;
  const sortedEps = [...(eps ?? [])].filter(e => inRange(e.date)).sort((a, b) => b.date.localeCompare(a.date));
  const sortedFin = [...(financials ?? [])].filter(e => inRange(e.date)).sort((a, b) => b.date.localeCompare(a.date));
  const showEps = sortedEps.length > 0;
  const showFin = sortedFin.length > 0;

  const priceMap = new Map(prices.map(d => [d.date, d.close]));
  const trMap = new Map(totalReturn.map(d => [d.date, d.close]));
  // Snap each event date to the nearest trading day so bars land on actual price dates.
  const priceDates = prices.map(p => p.date);
  function nearestPriceDate(d: string): string {
    let lo = 0, hi = priceDates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (priceDates[mid] < d) lo = mid + 1; else hi = mid;
    }
    return priceDates[lo] ?? d;
  }
  const epsMap = new Map<string, number>();
  const epsIsAnnualMap = new Map<string, boolean>();
  for (const e of sortedEps) {
    const d = nearestPriceDate(e.date);
    epsMap.set(d, e.eps);
    epsIsAnnualMap.set(d, e.period.startsWith('FY '));
  }
  const revMap = new Map<string, number>();
  const revIsAnnualMap = new Map<string, boolean>();
  const profMap = new Map<string, number>();
  for (const f of sortedFin) {
    const d = nearestPriceDate(f.date);
    if (f.revenue != null) { revMap.set(d, f.revenue); revIsAnnualMap.set(d, f.isAnnual ?? false); }
    const profit = f.netIncome ?? f.operatingIncome ?? f.grossProfit;
    if (profit != null) profMap.set(d, profit);
  }

  // Rolling P/E using TTM EPS (sum of the last 4 quarterly entries). Advances a
  // single pointer through the sorted quarterly list as we sweep prices forward,
  // so the whole sweep is O(prices + epsQuarters).
  const peMap = new Map<string, number>();
  if (showEps) {
    const qEps = buildCompleteQuarterlyEps(eps ?? []);
    let idx = -1;
    for (const p of prices) {
      while (idx + 1 < qEps.length && qEps[idx + 1].date <= p.date) idx++;
      if (idx >= 3) {
        const ttm = qEps[idx - 3].eps + qEps[idx - 2].eps + qEps[idx - 1].eps + qEps[idx].eps;
        if (ttm > 0) {
          const pe = p.close / ttm;
          // Clamp at 500x: handles TSLA (~435x) and most bubble peaks without
          // letting near-zero TTM EPS (MSTR-style) blow the axis to 50,000x.
          // The stat card always shows the real (unclamped) P/E.
          if (pe < 5000) peMap.set(p.date, Math.min(pe, 500));
        }
      }
    }
  }
  const showPe = peMap.size > 0;

  const allDates = Array.from(new Set([
    ...priceMap.keys(),
    ...trMap.keys(),
    ...epsMap.keys(),
    ...revMap.keys(),
    ...profMap.keys(),
    ...peMap.keys(),
  ])).sort();
  // Tool overlay computations (on price series)
  const toolCloses = prices.map(p => p.close).filter((c): c is number => typeof c === 'number' && isFinite(c));
  const P = computeIndicatorPeriods(avgCalendarDaysPerBar(prices.map(p => p.date)));

  // Full-history context: long MAs and the full-history trend are computed on the WHOLE daily
  // series, then projected (at-or-before each visible date) so they render on short windows too.
  const visDates = prices.map(p => p.date);
  const useFull = !!fullHist && fullHist.length > 2;
  const fullDates = useFull ? fullHist!.map(d => d.date) : [];
  const fullCloses = useFull ? fullHist!.map(d => d.close) : [];
  const PFull = useFull ? computeIndicatorPeriods(avgCalendarDaysPerBar(fullDates)) : P;
  const projectFull = (vals: (number | null)[]): (number | null)[] => {
    const out: (number | null)[] = new Array(visDates.length).fill(null);
    let j = 0; let lastVal: number | null = null;
    for (let i = 0; i < visDates.length; i++) {
      while (j < fullDates.length && fullDates[j] <= visDates[i]) { if (vals[j] != null) lastVal = vals[j]; j++; }
      out[i] = lastVal;
    }
    return out;
  };

  // Moving-average / band / level overlays (all on the price axis)
  const sma20Vals   = toolsOverlay?.sma20
    ? (useFull && PFull.sma20.ok    ? projectFull(computeSMA(fullCloses, PFull.sma20.period))   : (P.sma20.ok   ? computeSMA(toolCloses, P.sma20.period)   : null))
    : null;
  const sma50Vals   = toolsOverlay?.sma50
    ? (useFull && PFull.sma50.ok   ? projectFull(computeSMA(fullCloses, PFull.sma50.period))   : (P.sma50.ok   ? computeSMA(toolCloses, P.sma50.period)   : null))
    : null;
  const sma200Vals  = toolsOverlay?.sma200
    ? (useFull && PFull.sma200.ok  ? projectFull(computeSMA(fullCloses, PFull.sma200.period))  : (P.sma200.ok  ? computeSMA(toolCloses, P.sma200.period)  : null))
    : null;
  const sma200wVals = toolsOverlay?.sma200w
    ? (useFull
        ? projectFull(computeSma200wDaily(fullDates, fullCloses))
        : computeSma200wDaily(prices.map(p => p.date), prices.map(p => p.close)))
    : null;
  const ema20Vals  = toolsOverlay?.ema20
    ? (useFull && PFull.ema20.ok    ? projectFull(computeEMA(fullCloses, PFull.ema20.period))   : (P.ema20.ok   ? computeEMA(toolCloses, P.ema20.period)   : null))
    : null;
  const bands      = toolsOverlay?.bollinger && P.boll.ok ? computeBollingerBands(toolCloses, P.boll.period, 2) : null;
  const fibLevels  = toolsOverlay?.fib ? computeFibLevels(toolCloses) : null;

  // Trend line (OLS linear regression) — on full history evaluated at each visible bar, or on
  // the visible window only, per trendFull. Keyed by date so it merges into chartData below.
  const trendByDate = new Map<string, number>();
  let trendUp = true;
  if (toolsOverlay?.trend) {
    if (toolsOverlay.trendFull && useFull) {
      const fit = computeTrendLine(fullCloses);
      if (fit) {
        trendUp = fit.slope >= 0;
        let j = 0;
        for (let i = 0; i < visDates.length; i++) {
          while (j < fullDates.length && fullDates[j] < visDates[i]) j++;
          const idx = Math.min(j, Math.max(fullDates.length - 1, 0));
          trendByDate.set(visDates[i], fit.intercept + fit.slope * idx);
        }
      }
    } else {
      const fit = computeTrendLine(prices.map(p => p.close));
      if (fit) { trendUp = fit.slope >= 0; prices.forEach((p, i) => trendByDate.set(p.date, fit.intercept + fit.slope * i)); }
    }
  }
  const showTrend = trendByDate.size > 0;
  const trendColor = trendUp ? '#10b981' : '#ef4444';
  const overlayByDate = new Map<string, {
    sma20: number | null; sma50: number | null; sma200: number | null; sma200w: number | null;
    ema20: number | null; bbRange: [number, number] | null;
  }>();
  if (sma20Vals || sma50Vals || sma200Vals || sma200wVals || ema20Vals || bands) {
    prices.forEach((p, i) => {
      overlayByDate.set(p.date, {
        sma20:   sma20Vals?.[i]   ?? null,
        sma50:   sma50Vals?.[i]   ?? null,
        sma200:  sma200Vals?.[i]  ?? null,
        sma200w: sma200wVals?.[i] ?? null,
        ema20:   ema20Vals?.[i]   ?? null,
        bbRange: bands && bands.lower[i] != null && bands.upper[i] != null
          ? [bands.lower[i] as number, bands.upper[i] as number]
          : null,
      });
    });
  }

  // vs SPY benchmark line — rebased to the stock's first price, keyed by date.
  const showSpy = !!toolsOverlay?.spyRatio && !!spyPrices && spyPrices.length > 0;
  const spyByDate = new Map<string, number>();
  if (showSpy) {
    const spyLine = spyBenchmarkSeries(prices, spyPrices!);
    prices.forEach((p, i) => {
      const v = spyLine[i];
      if (v != null) spyByDate.set(p.date, v);
    });
  }

  const chartData = allDates.map(date => ({
    date,
    price: priceMap.get(date) ?? null,
    tr: hasDivs ? (trMap.get(date) ?? null) : undefined,
    eps: epsMap.get(date) ?? null,
    epsIsAnnual: epsIsAnnualMap.get(date) ?? false,
    revenue: revMap.get(date) ?? null,
    revIsAnnual: revIsAnnualMap.get(date) ?? false,
    profit: profMap.get(date) ?? null,
    pe: peMap.get(date) ?? null,
    sma20:  overlayByDate.get(date)?.sma20  ?? null,
    sma50:   overlayByDate.get(date)?.sma50   ?? null,
    sma200:  overlayByDate.get(date)?.sma200  ?? null,
    sma200w: overlayByDate.get(date)?.sma200w ?? null,
    ema20:  overlayByDate.get(date)?.ema20  ?? null,
    bbRange: overlayByDate.get(date)?.bbRange ?? null,
    spy: showSpy ? (spyByDate.get(date) ?? null) : null,
    trend: showTrend ? (trendByDate.get(date) ?? null) : null,
  }));

  const decimals = 2;
  const isUp = (prices[prices.length - 1]?.close ?? 0) >= (prices[0]?.close ?? 0);
  const toolAvg = toolCloses.length > 0 ? toolCloses.reduce((s, v) => s + v, 0) / toolCloses.length : null;
  const toolVariance = toolAvg != null && toolCloses.length > 1
    ? toolCloses.reduce((s, v) => s + (v - toolAvg) ** 2, 0) / toolCloses.length
    : null;
  const toolStdDev = toolVariance != null ? Math.sqrt(toolVariance) : null;
  const toolMin = toolCloses.length > 0 ? Math.min(...toolCloses) : null;
  const toolMax = toolCloses.length > 0 ? Math.max(...toolCloses) : null;

  // Drag-selection: price change, annualised CAGR, and dividend-inclusive IRR (when
  // dividends were paid inside the window — from the total-return series).
  let selStats: { leftVal: number; rightVal: number; pct: number; cagr: number | null; irr: number | null } | null = null;
  if (range) {
    const lv = valueAtOrAfter(prices, range.left, 'close');
    const rv = valueAtOrBefore(prices, range.right, 'close');
    if (lv != null && rv != null && lv !== 0) {
      const years = Math.max(0, (new Date(range.right).getTime() - new Date(range.left).getTime()) / (365.25 * 86_400_000));
      // Annualize only for ≥ 1-year windows (same rule as calculateCAGR).
      const cagr = years >= 1 && lv > 0 && rv > 0 ? (Math.pow(rv / lv, 1 / years) - 1) * 100 : null;
      let irr: number | null = null;
      if (hasDivs && years >= 1) {
        const trSeries = prices.map(d => ({ date: d.date, close: trMap.get(d.date) ?? NaN })).filter(d => isFinite(d.close));
        const tl = valueAtOrAfter(trSeries, range.left, 'close');
        const tr = valueAtOrBefore(trSeries, range.right, 'close');
        if (tl != null && tr != null && tl > 0 && tr > 0) {
          const trCagr = (Math.pow(tr / tl, 1 / years) - 1) * 100;
          if (cagr != null && Math.abs(trCagr - cagr) > 0.05) irr = trCagr;
        }
      }
      selStats = { leftVal: lv, rightVal: rv, pct: (rv - lv) / Math.abs(lv) * 100, cagr, irr };
    }
  }
  const fmtD = (d: string) => { try { return format(parseISO(d), 'MMM d, yyyy'); } catch { return d; } };

  return (
    <div className="relative select-none">
      {range && selStats && (
        <div className="flex items-center justify-between mb-2 bg-bg-input rounded-lg px-3 py-1.5 text-xs flex-wrap gap-2">
          <span className="text-gray-400 flex items-center gap-2">
            {fmtD(range.left)} → {fmtD(range.right)}
            <span className="text-gray-500 border-l border-border pl-2">{rangeDurationLabel(range.left, range.right)}</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 tabular-nums">
              {formatPrice(selStats.leftVal, currency)} → {formatPrice(selStats.rightVal, currency)}
            </span>
            <div className="flex flex-col items-end leading-tight">
              <span className={`font-bold tabular-nums ${selStats.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {selStats.pct >= 0 ? '+' : ''}{selStats.pct.toFixed(2)}%
              </span>
              {(selStats.cagr != null || selStats.irr != null) && (
                <span className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                  {selStats.cagr != null && (
                    <span title="Annualised return (CAGR) over the highlighted period">
                      CAGR {selStats.cagr >= 0 ? '+' : ''}{selStats.cagr.toFixed(1)}%
                    </span>
                  )}
                  {selStats.irr != null && (
                    <span className="text-sky-400" title="Dividend-inclusive annualised return (IRR) — dividends paid in this window, reinvested">
                      {selStats.cagr != null ? ' · ' : ''}IRR {selStats.irr >= 0 ? '+' : ''}{selStats.irr.toFixed(1)}%
                    </span>
                  )}
                </span>
              )}
            </div>
            {onSetRange && (
              <button
                onClick={() => { onSetRange(range.left, range.right); clear(); }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
              >
                Set period
              </button>
            )}
            <button onClick={clear} className="text-gray-600 hover:text-gray-300 text-[10px] ml-1">✕</button>
          </div>
        </div>
      )}
      {(toolsOverlay?.sma20 || toolsOverlay?.sma50 || toolsOverlay?.sma200 || toolsOverlay?.sma200w ||
        toolsOverlay?.ema20 || toolsOverlay?.bollinger || toolsOverlay?.fib || showSpy || showTrend) && (
        <div className="flex items-center gap-3 mb-1 px-1 flex-wrap">
          {showTrend && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: trendColor }}>
              <span className="inline-block w-5 border-t-2" style={{ borderColor: trendColor }} />
              Trend ({toolsOverlay?.trendFull ? 'full history' : 'visible'})
            </span>
          )}
          {showSpy && (
            <span className="flex items-center gap-1 text-[10px] text-slate-300">
              <span className="inline-block w-5 border-t-2 border-dashed border-slate-300" />vs SPY (benchmark)
            </span>
          )}
          {toolsOverlay?.sma20 && (
            <span className="flex items-center gap-1 text-[10px] text-cyan-400">
              <span className="inline-block w-5 border-t-2 border-cyan-400" />SMA 20
            </span>
          )}
          {toolsOverlay?.sma50 && (
            <span className="flex items-center gap-1 text-[10px] text-orange-400">
              <span className="inline-block w-5 border-t-2 border-orange-400" />SMA 50
            </span>
          )}
          {toolsOverlay?.sma200 && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400">
              <span className="inline-block w-5 border-t-2 border-purple-400" />SMA 200
            </span>
          )}
          {toolsOverlay?.sma200w && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-500">
              <span className="inline-block w-5 border-t-2 border-yellow-500" />SMA 200W
            </span>
          )}
          {toolsOverlay?.ema20 && (
            <span className="flex items-center gap-1 text-[10px] text-rose-400">
              <span className="inline-block w-5 border-t-2 border-rose-400" />EMA 20
            </span>
          )}
          {toolsOverlay?.bollinger && (
            <span className="flex items-center gap-1 text-[10px] text-teal-400">
              <span className="inline-block w-5 h-2 bg-teal-400/20 border-y border-teal-400" />Bollinger 20·2σ
            </span>
          )}
          {toolsOverlay?.fib && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400">
              <span className="inline-block w-5 border-t-2 border-dashed border-yellow-400" />Fibonacci
            </span>
          )}
          {toolsOverlay?.sma50 && toolsOverlay?.sma200 && (
            <span className="text-[9px] text-gray-600">Golden Cross when SMA 50 crosses SMA 200</span>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={260}>
        {/* key forces a fresh ComposedChart mount when the overlay changes — Recharts'
            internal layout doesn't always recompute when YAxis components are added/removed. */}
        <ComposedChart key={`chart-${showEps ? 'eps' : ''}${showFin ? 'fin' : ''}${showPe ? 'pe' : ''}`}
          data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          {...handlers} style={{ cursor: 'crosshair' }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis dataKey="date" tickFormatter={d => formatXDate(d as string, prices)}
          tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={50} />
        <YAxis yAxisId="price" tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false} tickLine={false} width={64}
          tickFormatter={v => {
            const n = v as number;
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return n.toFixed(decimals);
          }}
          domain={[(dataMin: number) => dataMin * 0.97, (dataMax: number) => dataMax * 1.03]} />
        {showEps && (
          <YAxis yAxisId="eps" orientation="right"
            tick={{ fill: '#f59e0b', fontSize: 11 }} axisLine={false} tickLine={false} width={48}
            tickFormatter={v => (v as number).toFixed(2)}
            domain={[0, (dataMax: number) => Math.max(dataMax * 1.05, dataMax + 0.1)]} />
        )}
        {showFin && (
          <YAxis yAxisId="fin" orientation="right"
            tick={{ fill: '#60a5fa', fontSize: 11 }} axisLine={false} tickLine={false} width={56}
            tickFormatter={v => formatBig(v as number)}
            domain={[0, (dataMax: number) => dataMax * 1.05]} />
        )}
        {showPe && (
          <YAxis yAxisId="pe" orientation="right"
            tick={{ fill: '#a3e635', fontSize: 11 }} axisLine={false} tickLine={false} width={42}
            tickFormatter={v => `${(v as number).toFixed(0)}x`}
            domain={[0, (dataMax: number) => dataMax * 1.05]} />
        )}
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
          itemStyle={{ color: '#e2e8f0' }}
          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
          formatter={(value: number, name: string, props: { payload?: { epsIsAnnual?: boolean; revIsAnnual?: boolean } }) => {
            if (name === 'eps') return [`${value.toFixed(2)} ${currency}`, props.payload?.epsIsAnnual ? 'EPS (annual)' : 'EPS (quarterly)'];
            if (name === 'revenue') return [`${formatBig(value)} ${currency}`, props.payload?.revIsAnnual ? 'Revenue (annual)' : 'Revenue (quarterly)'];
            if (name === 'pe') return [`${value.toFixed(1)}x`, 'P/E (TTM)'];
            if (name === 'sma20')   return [value != null ? formatPrice(value, currency) : '—', 'SMA 20'];
            if (name === 'sma50')   return [value != null ? formatPrice(value, currency) : '—', 'SMA 50'];
            if (name === 'sma200')  return [value != null ? formatPrice(value, currency) : '—', 'SMA 200'];
            if (name === 'sma200w') return [value != null ? formatPrice(value, currency) : '—', 'SMA 200W'];
            if (name === 'ema20')  return [value != null ? formatPrice(value, currency) : '—', 'EMA 20'];
            if (name === 'spy')    return [value != null ? formatPrice(value, currency) : '—', 'vs SPY (benchmark)'];
            if (name === 'trend')  return [value != null ? formatPrice(value, currency) : '—', 'Trend'];
            if (name === 'bbRange') {
              const r = value as unknown as [number, number] | null;
              return [r ? `${formatPrice(r[0], currency)} – ${formatPrice(r[1], currency)}` : '—', 'Bollinger'];
            }
            const label = name === 'price' ? 'Price' : 'Total Return (incl. div.)';
            return [formatPrice(value, currency), label];
          }}
          labelFormatter={label => { try { return format(parseISO(label as string), 'MMM d, yyyy'); } catch { return label as string; } }}
        />
        {/* Bollinger band (drawn under the price line) */}
        {toolsOverlay?.bollinger && (
          <Area yAxisId="price" type="monotone" dataKey="bbRange" stroke="#2dd4bf"
            strokeWidth={1} strokeOpacity={0.7} fill="#14b8a6" fillOpacity={0.08}
            dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} name="bbRange" />
        )}
        <Line yAxisId="price" type="monotone" dataKey="price" stroke={isUp ? '#10b981' : '#ef4444'}
          strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls name="price" />
        {hasDivs && (
          <Line yAxisId="price" type="monotone" dataKey="tr" stroke={isUp ? '#34d399' : '#f87171'}
            strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4 }} connectNulls name="tr" />
        )}
        {/* EPS/fin axes use domain [0, auto] so the zero line coincides with the
            chart bottom (price X-axis). Negative EPS / revenue values are clipped. */}
        {/* Single Bar per overlay with Cell for per-bar coloring — amber/red for EPS,
            blue/violet for revenue. Single Bar avoids the 0px-width collapse that
            hits two grouped bars on a dense category axis. */}
        {showEps && (
          <Bar yAxisId="eps" dataKey="eps" name="eps" barSize={6} radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.epsIsAnnual ? '#dc2626' : '#f59e0b'} />
            ))}
          </Bar>
        )}
        {showFin && (
          <Bar yAxisId="fin" dataKey="revenue" name="revenue" barSize={6} radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.revIsAnnual ? '#8b5cf6' : '#60a5fa'} />
            ))}
          </Bar>
        )}
        {showPe && (
          <Line yAxisId="pe" type="monotone" dataKey="pe" stroke="#a3e635"
            strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls name="pe" />
        )}
        {/* Moving-average overlays */}
        {toolsOverlay?.sma20 && (
          <Line yAxisId="price" type="monotone" dataKey="sma20" stroke="#22d3ee"
            strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} name="sma20" />
        )}
        {toolsOverlay?.sma50 && (
          <Line yAxisId="price" type="monotone" dataKey="sma50" stroke="#f97316"
            strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} name="sma50" />
        )}
        {toolsOverlay?.sma200 && (
          <Line yAxisId="price" type="monotone" dataKey="sma200" stroke="#a855f7"
            strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} name="sma200" />
        )}
        {toolsOverlay?.sma200w && (
          <Line yAxisId="price" type="monotone" dataKey="sma200w" stroke="#d97706"
            strokeWidth={2} dot={false} activeDot={false} connectNulls={false} name="sma200w" />
        )}
        {toolsOverlay?.ema20 && (
          <Line yAxisId="price" type="monotone" dataKey="ema20" stroke="#f472b6"
            strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} name="ema20" />
        )}
        {showSpy && (
          <Line yAxisId="price" type="monotone" dataKey="spy" stroke="#cbd5e1"
            strokeWidth={1.5} strokeDasharray="5 3" dot={false} activeDot={false} connectNulls name="spy" />
        )}
        {showTrend && (
          <Line yAxisId="price" type="linear" dataKey="trend" stroke={trendColor}
            strokeWidth={2} dot={false} activeDot={false} connectNulls name="trend" />
        )}
        {area && (
          <ReferenceArea
            yAxisId="price"
            x1={area.left}
            x2={area.right}
            fill="#6366f1"
            fillOpacity={0.15}
            stroke="#6366f1"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
        )}
        {toolsOverlay?.avg && toolAvg != null && (
          <ReferenceLine yAxisId="price" y={toolAvg} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5}
            label={{ value: `Avg ${toolAvg.toFixed(decimals)}`, fill: '#f59e0b', fontSize: 9, position: 'right' }} />
        )}
        {/* Arrays (not Fragments) — Recharts only detects reference
            components as direct children or flattened array entries. */}
        {toolsOverlay?.stdDev && toolAvg != null && toolStdDev != null && [
          <ReferenceArea key="sd-band" yAxisId="price" y1={toolAvg - toolStdDev} y2={toolAvg + toolStdDev}
            fill="#38bdf8" fillOpacity={0.05} />,
          <ReferenceLine key="sd-up" yAxisId="price" y={toolAvg + toolStdDev} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1}
            label={{ value: `+1σ ${(toolAvg + toolStdDev).toFixed(decimals)}`, fill: '#38bdf8', fontSize: 9, position: 'right' }} />,
          <ReferenceLine key="sd-dn" yAxisId="price" y={toolAvg - toolStdDev} stroke="#38bdf8" strokeDasharray="3 3" strokeWidth={1}
            label={{ value: `-1σ ${(toolAvg - toolStdDev).toFixed(decimals)}`, fill: '#38bdf8', fontSize: 9, position: 'right' }} />,
        ]}
        {toolsOverlay?.minMax && toolMin != null && toolMax != null && [
          <ReferenceLine key="mm-h" yAxisId="price" y={toolMax} stroke="#a78bfa" strokeDasharray="2 4" strokeWidth={1}
            label={{ value: `H ${toolMax.toFixed(decimals)}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />,
          <ReferenceLine key="mm-l" yAxisId="price" y={toolMin} stroke="#a78bfa" strokeDasharray="2 4" strokeWidth={1}
            label={{ value: `L ${toolMin.toFixed(decimals)}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />,
        ]}
        {fibLevels && fibLevels.map(lvl => (
          <ReferenceLine key={lvl.ratio} yAxisId="price" y={lvl.value} stroke="#eab308"
            strokeDasharray="2 4" strokeWidth={1} strokeOpacity={0.75}
            label={{
              value: `${(lvl.ratio * 100).toFixed(1)}% · ${lvl.value.toFixed(decimals)}`,
              fill: '#eab308', fontSize: 9, position: 'insideLeft',
            }} />
        ))}
        </ComposedChart>
      </ResponsiveContainer>
      {!range && (
        <p className="text-[10px] text-gray-700 text-right mt-0.5">Click &amp; drag to measure a period</p>
      )}
    </div>
  );
}

function FinancialsBarChart({ data, currency }: { data: FinancialPoint[]; currency: string }) {
  if (!data.length) return null;
  const rows = data.map(d => ({
    period: d.date.slice(0, 7),
    revenue: d.revenue ?? null,
    netIncome: d.netIncome ?? null,
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={30} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={56}
          tickFormatter={v => formatBig(v as number)}
          domain={[0, (dataMax: number) => dataMax * 1.05]} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
          itemStyle={{ color: '#e2e8f0' }}
          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
          formatter={(value: number, name: string) => [
            `${formatBig(value)} ${currency}`,
            name === 'revenue' ? 'Revenue' : 'Net income',
          ]}
        />
        <Bar dataKey="revenue" fill="#60a5fa" radius={[2, 2, 0, 0]} name="revenue" />
        <Bar dataKey="netIncome" fill="#a78bfa" radius={[2, 2, 0, 0]} name="netIncome" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EarningsBarChart({ quarterly, currency }: { quarterly: EarningsPoint[]; currency: string }) {
  if (!quarterly.length) return null;
  const data = quarterly.map(q => ({
    period: q.period.match(/^\d{4}-\d{2}-\d{2}$/) ? q.period.slice(0, 7) : q.period,
    eps: q.eps,
    estimate: q.estimate ?? null,
  }));
  const hasEstimates = data.some(d => d.estimate != null);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={48}
          tickFormatter={v => (v as number).toFixed(2)} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
          itemStyle={{ color: '#e2e8f0' }}
          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
          formatter={(value: number, name: string) => [
            `${value.toFixed(2)} ${currency}`,
            name === 'eps' ? 'EPS (actual)' : 'EPS (estimate)',
          ]}
        />
        <Bar dataKey="eps" fill="#6366f1" radius={[2, 2, 0, 0]} name="eps" />
        {hasEstimates && (
          <Bar dataKey="estimate" fill="#475569" radius={[2, 2, 0, 0]} name="estimate" />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StockSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [data, setData] = useState<StockData | null>(null);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('5Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  // Full daily history for a weekly/monthly RSI / MACD on the stock's oscillator sub-charts.
  const rsiGrain = activeTools.rsiMonthly ? 'monthly' : activeTools.rsiWeekly ? 'weekly' : null;
  const macdGrain = activeTools.macdMonthly ? 'monthly' : activeTools.macdWeekly ? 'weekly' : null;
  const oscFullHist = useFullHistory(
    selected?.symbol,
    !!((activeTools.rsi && rsiGrain) || (activeTools.macd && macdGrain)),
  );
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [spyPrices, setSpyPrices] = useState<HistoricalPoint[]>([]);
  const [selQuote, setSelQuote] = useState<QuoteData | null>(null); // for the open stock's forward P/E
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: gistData } = useGistData();
  const [watchlistQuotes, setWatchlistQuotes] = useState<Record<string, QuoteData>>({});
  const [watchlistCategory, setWatchlistCategory] = useState('Watchlist');
  const [watchlistSort, setWatchlistSort] = useState<StockSortKey>('changePercent');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [below200d, setBelow200d] = useState(false);
  const [below200w, setBelow200w] = useState(false);
  const { pins, togglePin } = usePins();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || selected) { setHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stock?mode=search&q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setHits(Array.isArray(json) ? json as SearchHit[] : []);
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, selected]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const fetchAsset = useCallback(async (
    sym: string, tf: Timeframe, override?: { from: string; to: string }
  ) => {
    setLoading(true);
    try {
      const base = `/api/stock?symbol=${encodeURIComponent(sym)}&timeframe=${tf}`;
      const url = override ? `${base}&from=${override.from}&to=${override.to}` : base;
      const res = await fetch(url);
      const stockData = await res.json() as StockData;
      setData(stockData);
      setDataMsg(dataAvailabilityMessage(stockData?.prices ?? [], tf, !!override));
    } catch { setData(null); setDataMsg(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selected) fetchAsset(selected.symbol, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchAsset]);

  // Quote for the open stock — used for the forward P/E (Yahoo analyst estimate).
  useEffect(() => {
    if (!selected) { setSelQuote(null); return; }
    let cancelled = false;
    fetch(`/api/quotes?symbols=${encodeURIComponent(selected.symbol)}`)
      .then(r => r.json())
      .then((d: QuoteData[]) => { if (!cancelled) setSelQuote(Array.isArray(d) ? d[0] ?? null : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  // Earnings — fetched once per symbol (cheap; doesn't depend on timeframe)
  useEffect(() => {
    if (!selected) { setEarnings(null); setOverlay('none'); setEarningsLoading(false); return; }
    let cancelled = false;
    setEarnings(null);
    setOverlay('none');
    setEarningsLoading(true);
    fetch(`/api/stock?mode=earnings&symbol=${encodeURIComponent(selected.symbol)}`)
      .then(r => r.json())
      .then((d: EarningsData) => {
        if (cancelled) return;
        const hasAny = (d?.quarterly?.length ?? 0) > 0 || (d?.financials?.length ?? 0) > 0;
        setEarnings(hasAny ? d : null);
        setEarningsLoading(false);
      })
      .catch(() => { if (!cancelled) { setEarnings(null); setEarningsLoading(false); } });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    if (jumpTo?.startsWith('stock:')) {
      const sym = jumpTo.slice('stock:'.length);
      setSelected({ symbol: sym, name: sym, exchange: '', type: 'EQUITY' });
      setQuery(sym);
    }
  }, [jumpTo]);

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); setSpyPrices([]); }, [selected]);

  useEffect(() => {
    if (!activeTools.spyRatio || !selected || selected.symbol === 'SPY') { setSpyPrices([]); return; }
    let cancelled = false;
    const tf = customRange ? 'MAX' : timeframe;
    const base = `/api/historical?symbol=SPY&timeframe=${tf}`;
    const url = customRange ? `${base}&from=${customRange.from}&to=${customRange.to}` : base;
    fetch(url).then(r => r.json()).then((d: HistoricalPoint[]) => {
      if (!cancelled && Array.isArray(d)) setSpyPrices(d);
    }).catch(() => { if (!cancelled) setSpyPrices([]); });
    return () => { cancelled = true; };
  }, [activeTools.spyRatio, selected, timeframe, customRange]);

  // All unique categories used across stock notes (for the category selector)
  const noteCategories = useMemo(() => {
    const notes = gistData.notes ?? {};
    const cats = new Set<string>();
    for (const [chartId, noteList] of Object.entries(notes)) {
      if (!chartId.startsWith('stock:')) continue;
      noteList.forEach(n => { if (n.category) cats.add(n.category); });
    }
    return Array.from(cats).sort();
  }, [gistData]);

  // Derive watchlist symbols from notes matching the selected category
  const watchlistSymbols = useMemo(() => {
    const notes = gistData.notes ?? {};
    const syms: string[] = [];
    for (const [chartId, noteList] of Object.entries(notes)) {
      if (!chartId.startsWith('stock:')) continue;
      if (noteList.some(n => n.category?.toLowerCase() === watchlistCategory.toLowerCase())) {
        syms.push(chartId.slice('stock:'.length));
      }
    }
    return syms;
  }, [gistData, watchlistCategory]);

  const avgYearlyMap = useAvgYearly(watchlistSymbols);
  const phases = useRotationPhases(watchlistSymbols);

  // Watchlist sorted by the active sort key (Day / MTD / YTD); symbols whose
  // quote hasn't loaded yet sink to the bottom.
  const sortedWatchlistSymbols = useMemo(() => {
    const valueOf = (sym: string): number | null => {
      const q = watchlistQuotes[sym];
      if (!q) return null;
      if (watchlistSort === 'changePercent') return q.changePercent ?? null;
      if (watchlistSort === 'oneMonthChangePercent') return q.oneMonthChangePercent ?? null;
      if (watchlistSort === 'threeMonthChangePercent') return q.threeMonthChangePercent ?? null;
      if (watchlistSort === 'sixMonthChangePercent') return q.sixMonthChangePercent ?? null;
      if (watchlistSort === 'mtdChangePercent') return q.mtdChangePercent ?? null;
      if (watchlistSort === 'ytdChangePercent') return q.ytdChangePercent ?? null;
      if (watchlistSort === 'fiveYearCagrPercent') return q.fiveYearCagrPercent ?? null;
      if (watchlistSort === 'avgYearly') return avgYearlyMap[sym] ?? null;
      return q.fiveYearChangePercent ?? null;
    };
    return [...watchlistSymbols].sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }, [watchlistSymbols, watchlistQuotes, watchlistSort]);

  // Rotation-phase + pinned filter applied to the sorted watchlist.
  const visibleWatchlist = sortedWatchlistSymbols.filter(sym => {
    const q = watchlistQuotes[sym];
    return (phaseFilter === 'all' || phases.get(sym) === phaseFilter)
      && (!pinnedOnly || pins.has(sym))
      && (!below200d || isBelowMA(q?.price, q?.sma200d))
      && (!below200w || isBelowMA(q?.price, q?.sma200w));
  });

  useEffect(() => {
    if (!watchlistSymbols.length) { setWatchlistQuotes({}); return; }
    const sym = watchlistSymbols.join(',');
    fetch(`/api/quotes?symbols=${encodeURIComponent(sym)}`)
      .then(r => r.json())
      .then((d: QuoteData[]) => {
        const map: Record<string, QuoteData> = {};
        if (Array.isArray(d)) d.forEach(q => { map[q.symbol] = q; });
        setWatchlistQuotes(map);
      })
      .catch(() => {});
  }, [watchlistSymbols]);

  const pickHit = (h: SearchHit) => {
    setSelected(h);
    setQuery(`${h.symbol} — ${h.name}`);
    setHits([]);
    setShowDropdown(false);
  };

  const clearSelection = () => { setSelected(null); setData(null); setQuery(''); setHits([]); };

  const prices = data?.prices ?? [];
  const dividends = data?.dividends ?? [];
  const totalReturn = dividends.length > 0 ? buildTotalReturnSeries(prices, dividends) : prices;
  const cagrPrice = calculateCAGR(prices, timeframe);
  // IRR = annualized total-return CAGR (CAGR of the total-return series)
  // Newton-Raphson IRR (only shown when dividends exist and period > 1 Y)
  const nrIRR = dividends.length > 0 ? computeAssetIRR(prices, dividends) : null;
  const currency = data?.meta?.currency ?? 'USD';
  const totalDivs = dividends.reduce((s, d) => d.date >= (prices[0]?.date ?? '') ? s + d.amount : s, 0);

  const epsList = earnings?.quarterly ?? [];
  const finList = earnings?.financials ?? [];
  const ttmEps = epsList.length > 0 ? computeTtmEps(epsList) : null;
  const peTtm = ttmEps && data?.meta?.price ? data.meta.price / ttmEps : null;
  const avgPe = computeAvgPe(prices, epsList);
  const divYield = computeDivYield(dividends, data?.meta?.price ?? 0);
  const divCagr = computeDivCAGR(dividends);
  const epsCagr = computeEpsCAGR(epsList);
  const revCagr = computeRevenueCAGR(finList);
  const reportFreq = detectReportingFreq(epsList);

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 bg-bg-card border border-border rounded-xl px-3 py-2">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input type="text" value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search by ticker (AAPL, KO, ENI.MI), ISIN (US0378331005) or name…"
            className="bg-transparent outline-none text-gray-100 placeholder-gray-600 text-sm flex-1" />
          {selected && <button onClick={clearSelection} className="p-0.5 text-gray-500 hover:text-gray-300 shrink-0"><X size={14} /></button>}
          {searching && <span className="text-[10px] text-gray-500 animate-pulse shrink-0">…</span>}
        </div>
        {showDropdown && hits.length > 0 && !selected && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-lg shadow-xl z-30 max-h-72 overflow-y-auto">
            {hits.map(h => (
              <button key={h.symbol} onClick={() => pickHit(h)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-bg-hover text-left border-b border-border last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-gray-100 font-medium truncate">{h.name}</p>
                  <p className="text-gray-500 text-[10px]">{h.exchange}{h.type ? ` · ${h.type}` : ''}</p>
                </div>
                <span className="text-gray-400 ml-3 font-mono shrink-0">{h.symbol}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist grid */}
      {(watchlistSymbols.length > 0 || noteCategories.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              ★ {watchlistCategory}
            </h3>
            {noteCategories.length > 1 && (
              <div className="flex gap-1 flex-wrap">
                {noteCategories.map(cat => (
                  <button key={cat} onClick={() => setWatchlistCategory(cat)}
                    className={clsx('px-2.5 py-0.5 text-[10px] font-medium rounded-full border transition-all',
                      watchlistCategory === cat
                        ? 'border-amber-400/60 text-amber-300 bg-amber-400/10'
                        : 'border-border text-gray-500 hover:text-gray-300')}>
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {watchlistSymbols.length > 0 && (
              <div className="flex gap-1 bg-bg-input rounded-lg p-1 ml-auto overflow-x-auto scrollbar-hide min-w-0 max-w-full">
                {WATCHLIST_SORT_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setWatchlistSort(opt.value)}
                    className={clsx('px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                      watchlistSort === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                    {opt.label}
                  </button>
                ))}
                <MAFilterChips below200d={below200d} setBelow200d={setBelow200d} below200w={below200w} setBelow200w={setBelow200w} />
              </div>
            )}
          </div>

          {watchlistSymbols.length > 0 && (
            <RotationFilterBar phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter}
              pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} pinnedCount={watchlistSymbols.filter(s => pins.has(s)).length} />
          )}
          {watchlistSymbols.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {visibleWatchlist.map(sym => {
                const q = watchlistQuotes[sym];
                const change = q?.changePercent ?? null;
                const mtd = q?.mtdChangePercent ?? null;
                const ytd = q?.ytdChangePercent ?? null;
                const fiveYear = q?.fiveYearChangePercent ?? null;
                const cagr = q?.fiveYearCagrPercent ?? null;
                const cagrFull = q?.fiveYearFull ?? false;
                const isSelected = selected?.symbol === sym;
                return (
                  <button
                    key={sym}
                    onClick={() => {
                      const name = q?.name ?? sym;
                      setSelected({ symbol: sym, name, exchange: '', type: 'EQUITY' });
                      setQuery(`${sym} — ${name}`);
                    }}
                    className={clsx(
                      'rounded-xl border p-3 text-left transition-colors',
                      isSelected
                        ? 'border-accent/60 bg-accent/10'
                        : 'border-border bg-bg-card hover:border-accent/40',
                    )}
                  >
                    {/* Top row: symbol + currency badge */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs font-bold text-gray-100 font-mono">{sym}</span>
                        {q?.currency && (
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none shrink-0">
                            {q.currency}
                          </span>
                        )}
                        <PhaseChip phase={phases.get(sym)} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {q?.dividendYield != null && q.dividendYield > 0 && (
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 leading-none">
                            DIV
                          </span>
                        )}
                        <PinButton pinned={pins.has(sym)} onToggle={() => togglePin(sym)} />
                      </div>
                    </div>
                    {/* Company name */}
                    {q?.name && <p className="text-[10px] text-gray-500 truncate mb-1.5">{q.name}</p>}
                    {q?.price != null ? (
                      <>
                        <p className="text-lg font-bold text-white tabular-nums">{formatPrice(q.price, q.currency ?? 'USD')}</p>
                        {change != null && (
                          <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', change >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {change >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
                            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                            <span className="text-[10px] font-medium opacity-70">day</span>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-2 mt-1.5">
                          {([
                            { k: '1M', v: q?.oneMonthChangePercent ?? null },
                            { k: '3M', v: q?.threeMonthChangePercent ?? null },
                            { k: '6M', v: q?.sixMonthChangePercent ?? null },
                            { k: 'MTD', v: mtd },
                            { k: 'YTD', v: ytd },
                            { k: '5Y', v: fiveYear },
                            { k: 'CAGR', v: cagr, cagr: true },
                            { k: 'Avg Yr', v: avgYearlyMap[sym] ?? null },
                          ] as { k: string; v: number | null; cagr?: boolean }[])
                            .filter(s => s.v != null)
                            .map(s => (
                              <p key={s.k} className={clsx('text-[9px] leading-[1.35] tabular-nums', (s.v as number) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                <span className="text-gray-500">{s.k}:</span> {(s.v as number) >= 0 ? '+' : ''}{(s.v as number).toFixed(1)}%{s.cagr && !cagrFull ? '*' : ''}
                              </p>
                            ))}
                        </div>
                        <Ma200dLine price={q.price} sma200d={q.sma200d} currency={q.currency} />
                        <Sma200wLine price={q.price} sma200w={q.sma200w} currency={q.currency} />
                        <MaSpreadLine sma200d={q.sma200d} sma200w={q.sma200w} />
                      </>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        <div className="h-5 bg-border rounded animate-pulse w-16" />
                        <div className="h-3 bg-border rounded animate-pulse w-12" />
                      </div>
                    )}
                    {!q && <p className="text-[10px] text-gray-600 animate-pulse">Loading…</p>}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-600 italic">
              Nessun titolo con categoria &ldquo;{watchlistCategory}&rdquo;. Aggiungi una nota con questa categoria a un titolo.
            </p>
          )}
        </div>
      )}

      {!selected && watchlistSymbols.length === 0 && (
        <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-gray-500">
          Search a stock by ticker (e.g. <span className="text-gray-300 font-mono">AAPL</span>,{' '}
          <span className="text-gray-300 font-mono">KO</span>,{' '}
          <span className="text-gray-300 font-mono">ENI.MI</span>) or by ISIN
          (e.g. <span className="text-gray-300 font-mono">US0378331005</span>).
        </div>
      )}

      {selected && (
        <DetailModal onClose={() => setSelected(null)}>
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">{selected.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className="font-mono">{selected.symbol}</span>
                {selected.exchange ? `· ${selected.exchange}` : ''}
                {data?.meta?.currency && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    {data.meta.currency}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5 justify-end shrink-0">
              {onCompare && (
                <button
                  onClick={() => onCompare(selected.symbol)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  Compare
                </button>
              )}
              <ReturnsTableButton name={selected.name} symbol={selected.symbol} />
              <GeminiCommentButton
                key={selected.symbol}
                name={selected.name}
                symbol={selected.symbol}
                assetClass="Stocks"
                timeframe={timeframe}
                tools={prices.length > 0 ? summarizeTools(activeTools, prices) : undefined}
              />
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300" aria-label="Close"><X size={16} /></button>
            </div>
          </div>

          {/* Timeframe on its own row (it is wide) so the ✕ always stays in the top-right corner. */}
          <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
            <TimeframeSelector
              value={timeframe}
              onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
              options={TF_OPTIONS}
              isCustom={!!customRange}
              onCustomRange={(from, to) => setCustomRange({ from, to })}
            />
          </div>

          {dataMsg && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              ⚠ {dataMsg}
            </p>
          )}

          {/* Legend for dual lines + overlay toggles (EPS / Financials) */}
          {!loading && prices.length > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
              <div className="flex items-center gap-4 flex-wrap">
                {dividends.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="w-6 h-0.5 bg-emerald-400 inline-block" />
                      <span className="text-gray-400">Price</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-6 border-t-2 border-dashed border-emerald-300 inline-block" />
                      <span className="text-gray-400">Total Return (reinvested div.)</span>
                    </div>
                  </>
                )}
                {overlay === 'eps' && earnings && earnings.quarterly.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 inline-block rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
                      <span className="text-gray-400">EPS quarterly</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 inline-block rounded-sm" style={{ backgroundColor: '#dc2626' }} />
                      <span className="text-gray-400">EPS annual</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-6 border-t-2 border-dashed inline-block" style={{ borderColor: '#a3e635' }} />
                      <span className="text-gray-400">P/E (TTM)</span>
                    </div>
                  </>
                )}
                {overlay === 'financials' && earnings && earnings.financials.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 inline-block rounded-sm" style={{ backgroundColor: '#60a5fa' }} />
                      <span className="text-gray-400">Revenue quarterly</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 inline-block rounded-sm" style={{ backgroundColor: '#8b5cf6' }} />
                      <span className="text-gray-400">Revenue annual</span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {earningsLoading ? (
                  <span className="px-2.5 py-0.5 text-[10px] text-gray-600 border border-border rounded-full animate-pulse">
                    Loading earnings…
                  </span>
                ) : (
                  <>
                    {earnings && earnings.quarterly.length > 0 ? (
                      <button onClick={() => setOverlay(o => o === 'eps' ? 'none' : 'eps')}
                        className={clsx('px-2.5 py-0.5 text-[10px] font-medium rounded-full border transition-all',
                          overlay === 'eps'
                            ? 'border-amber-400 text-amber-400 bg-amber-400/10'
                            : 'border-border text-gray-400 hover:text-gray-200')}>
                        {overlay === 'eps' ? 'Hide EPS' : 'Show EPS'}
                      </button>
                    ) : (
                      <span className="px-2.5 py-0.5 text-[10px] text-gray-600 border border-border/40 rounded-full">
                        No EPS data
                      </span>
                    )}
                    {earnings && earnings.financials.length > 0 ? (
                      <button onClick={() => setOverlay(o => o === 'financials' ? 'none' : 'financials')}
                        className={clsx('px-2.5 py-0.5 text-[10px] font-medium rounded-full border transition-all',
                          overlay === 'financials'
                            ? 'border-blue-400 text-blue-400 bg-blue-400/10'
                            : 'border-border text-gray-400 hover:text-gray-200')}>
                        {overlay === 'financials' ? 'Hide Revenue' : 'Show Revenue'}
                      </button>
                    ) : (
                      <span className="px-2.5 py-0.5 text-[10px] text-gray-600 border border-border/40 rounded-full">
                        No financials
                      </span>
                    )}
                    {/* Reporting cadence badge — colored to match EPS bars so the user
                        can tell at a glance how often the company reports. */}
                    {reportFreq && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-400/10 border border-amber-400/50 text-amber-300 font-medium">
                        Reports {reportFreq}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Stats */}
          {data?.meta && (
            <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
              <Stat label="Price" value={formatPrice(data.meta.price, currency)} />
              {cagrPrice && (
                <Stat label={`Return (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagrPrice.return)} color={colorForPercent(cagrPrice.return)} />
              )}
              {cagrPrice && (
                <Stat label={`CAGR (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagrPrice.cagr)} color={colorForPercent(cagrPrice.cagr)} />
              )}
              {/* CAGR above is the PRICE growth rate; the IRR below adds the actual
                  dividend cash flows. Shown only when the asset paid one in the window. */}
              {nrIRR != null && (
                <Stat label={`IRR (${customRange ? 'Custom' : timeframe})`} value={formatPercent(nrIRR * 100)} color={colorForPercent(nrIRR * 100)} />
              )}
              {peTtm != null && peTtm > 0 && peTtm <= 1000 ? (
                <Stat label="P/E (TTM)" value={`${peTtm.toFixed(1)}x`} color="text-sky-400" />
              ) : epsList.length > 0 && peTtm == null ? (
                <Stat label="P/E (TTM)" value="N/A" color="text-gray-600" />
              ) : null}
              {/* ETFs / funds carry no EPS → show Yahoo's trailing P/E instead. */}
              {peTtm == null && epsList.length === 0 && selQuote?.trailingPE != null && selQuote.trailingPE > 0 && selQuote.trailingPE <= 1000 && (
                <Stat label="P/E" value={`${selQuote.trailingPE.toFixed(1)}x`} color="text-sky-400" />
              )}
              {selQuote?.forwardPE != null && selQuote.forwardPE > 0 && selQuote.forwardPE <= 1000 && (
                <Stat label="Fwd P/E" value={`${selQuote.forwardPE.toFixed(1)}x`} color="text-sky-400" />
              )}
              {avgPe != null && avgPe > 0 && avgPe <= 1000 ? (
                <Stat label={`Avg P/E (${timeframe})`} value={`${avgPe.toFixed(1)}x`} color="text-sky-400" />
              ) : epsList.length > 0 ? (
                <Stat label={`Avg P/E (${timeframe})`} value="N/A" color="text-gray-600" />
              ) : null}
              {divYield != null ? (
                <Stat label="Div. yield (TTM)" value={formatPercent(divYield)} color={colorForPercent(divYield)} />
              ) : (
                <Stat label="Div. yield (TTM)" value="—" color="text-gray-600" />
              )}
              {divCagr ? (
                <Stat label={`Div. CAGR (${divCagr.years}y)`} value={formatPercent(divCagr.cagr)} color={colorForPercent(divCagr.cagr)} />
              ) : (
                <Stat label="Div. CAGR" value="—" color="text-gray-600" />
              )}
              {epsCagr ? (
                <Stat label={`EPS CAGR (${epsCagr.years}y)`} value={formatPercent(epsCagr.cagr)} color={colorForPercent(epsCagr.cagr)} />
              ) : epsList.length > 0 ? (
                <Stat label="EPS CAGR" value="N/A" color="text-gray-600" />
              ) : null}
              {revCagr ? (
                <Stat label={`Revenue CAGR (${revCagr.years}y)`} value={formatPercent(revCagr.cagr)} color={colorForPercent(revCagr.cagr)} />
              ) : finList.length > 0 ? (
                <Stat label="Revenue CAGR" value="N/A" color="text-gray-600" />
              ) : null}
              {data.meta.high52w != null && data.meta.high52w > 0 && <Stat label="52W High" value={formatPrice(data.meta.high52w, currency)} />}
              {data.meta.low52w != null && data.meta.low52w > 0 && <Stat label="52W Low" value={formatPrice(data.meta.low52w, currency)} />}
              {dividends.length > 0 && (
                <Stat label="Dividends (period)" value={`${dividends.length} (${formatPrice(totalDivs, currency)})`} />
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-56"><LoadingSpinner size={32} /></div>
          ) : prices.length > 0 ? (
            <DualChart
              prices={prices}
              symbol={selected?.symbol}
              totalReturn={totalReturn}
              currency={currency}
              eps={overlay === 'eps' ? earnings?.quarterly : undefined}
              financials={overlay === 'financials' ? earnings?.financials : undefined}
              toolsOverlay={activeTools}
              spyPrices={spyPrices}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }}
            />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-500 text-sm">
              No data found. Try a different ticker.
            </div>
          )}

          {/* RSI / MACD oscillator sub-charts for stocks */}
          {!loading && prices.length > 0 && activeTools.rsi && (() => {
            let rsiData: { date: string; rsi: number | null }[];
            if (rsiGrain) {
              // Weekly/monthly RSI on the full daily history, held forward onto each visible day.
              const full = oscFullHist && oscFullHist.length > 2 ? oscFullHist : prices;
              const fullDates = full.map(p => p.date);
              const fSeries = computeRsiResampledDaily(fullDates, full.map(p => p.close), rsiGrain, 14);
              let j = 0;
              let lastVal: number | null = null;
              rsiData = prices.map(p => {
                while (j < fullDates.length && fullDates[j] <= p.date) { if (fSeries[j] != null) lastVal = fSeries[j]; j++; }
                return { date: p.date, rsi: lastVal };
              });
            } else {
              const stockCloses = prices.map(p => p.close).filter((c): c is number => isFinite(c));
              const rsiVals = computeRSI(stockCloses);
              rsiData = prices.map((p, i) => ({ date: p.date, rsi: rsiVals[i] }));
            }
            const valid = rsiData.filter(d => d.rsi != null);
            if (!valid.length) return <div className="text-[10px] text-gray-600 py-1">RSI: not enough data</div>;
            return (
              <div className="rounded-lg border border-border p-3 bg-bg-input/40">
                <p className="text-[10px] text-indigo-400 font-semibold mb-1 capitalize">RSI 14 {rsiGrain ?? 'daily'}</p>
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={rsiData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
                    <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
                    <YAxis domain={[0, 100]} ticks={[30, 50, 70]}
                      tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <ReferenceLine y={50} stroke="#6b7280" strokeDasharray="1 4" strokeOpacity={0.35} />
                    <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="rsi" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
                      formatter={(v: number) => [`${(v ?? 0).toFixed(1)}`, 'RSI 14']}
                      labelFormatter={l => { try { return format(parseISO(l as string), 'MMM d, yyyy'); } catch { return String(l); } }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {!loading && prices.length > 0 && activeTools.macd && (() => {
            let macdData: { date: string; macd: number | null; signal: number | null; hist: number | null }[];
            if (macdGrain) {
              const full = oscFullHist && oscFullHist.length > 2 ? oscFullHist : prices;
              const fullDates = full.map(p => p.date);
              const w = computeMacdResampledDaily(fullDates, full.map(p => p.close), macdGrain);
              let j = 0;
              let lm: number | null = null, ls: number | null = null, lh: number | null = null;
              macdData = prices.map(p => {
                while (j < fullDates.length && fullDates[j] <= p.date) {
                  if (w.macd[j] != null) lm = w.macd[j];
                  if (w.signal[j] != null) ls = w.signal[j];
                  if (w.hist[j] != null) lh = w.hist[j];
                  j++;
                }
                return { date: p.date, macd: lm, signal: ls, hist: lh };
              });
            } else {
              const stockCloses = prices.map(p => p.close).filter((c): c is number => isFinite(c));
              const macdResult = computeMACD(stockCloses);
              macdData = prices.map((p, i) => ({
                date: p.date,
                macd: macdResult.macd[i], signal: macdResult.signal[i], hist: macdResult.hist[i],
              }));
            }
            const valid = macdData.filter(d => d.hist != null);
            if (!valid.length) return <div className="text-[10px] text-gray-600 py-1">MACD: not enough data</div>;
            return (
              <div className="rounded-lg border border-border p-3 bg-bg-input/40">
                <p className="text-[10px] text-blue-400 font-semibold mb-1 capitalize">MACD (12, 26, 9) {macdGrain ?? 'daily'}</p>
                <ResponsiveContainer width="100%" height={80}>
                  <ComposedChart data={macdData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
                    <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={36}
                      tickFormatter={v => (v as number).toFixed(2)} />
                    <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.4} />
                    <Bar dataKey="hist" barSize={3}>
                      {macdData.map((entry, i) => (
                        <Cell key={i} fill={(entry.hist ?? 0) >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="macd" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls={false} name="MACD" />
                    <Line type="monotone" dataKey="signal" stroke="#f97316" strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} name="Signal" />
                    <Tooltip contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
                      formatter={(v: number, name: string) => [v != null ? v.toFixed(4) : '—', name]}
                      labelFormatter={l => { try { return format(parseISO(l as string), 'MMM d, yyyy'); } catch { return String(l); } }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {!loading && prices.length > 0 && (
            <ChartTools data={prices} symbol={selected?.symbol} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {!loading && prices.length > 0 && (
            <ChartDataTable data={prices} unit={currency} />
          )}
          {selected && (
            <ChartNotes
              chartId={`stock:${selected.symbol}`}
              defaultCategory="Watchlist"
              captureView={() => ({ tools: { ...activeTools } as Record<string, boolean>, timeframe, customRange })}
              onRestoreView={v => {
                if (v.tools) setActiveTools({ ...DEFAULT_TOOLS, ...(v.tools as Partial<ActiveTools>) });
                if (v.timeframe) setTimeframe(v.timeframe as Timeframe);
                setCustomRange(v.customRange ?? null);
              }}
            />
          )}

          {/* Dividends chart (bar) */}
          {!loading && dividends.length > 0 && (
            <div className="rounded-lg border border-border p-3 bg-bg-input/40 space-y-1">
              <p className="text-xs text-gray-300 font-semibold">Dividends over time</p>
              <DividendsBarChart dividends={dividends} currency={currency} />
            </div>
          )}

          {/* Earnings chart (bar) */}
          {!loading && earnings && earnings.quarterly.length > 0 && (
            <div className="rounded-lg border border-border p-3 bg-bg-input/40 space-y-1">
              <p className="text-xs text-gray-300 font-semibold">
                Earnings per share (quarterly)
                <span className="text-gray-500 font-normal ml-1">· {earnings.quarterly.length} reported quarters</span>
              </p>
              <EarningsBarChart quarterly={earnings.quarterly} currency={earnings.currency || currency} />
            </div>
          )}

          {/* Financials chart (revenue / costs / net income) */}
          {!loading && earnings && earnings.financials.length > 0 && (
            <div className="rounded-lg border border-border p-3 bg-bg-input/40 space-y-1">
              <p className="text-xs text-gray-300 font-semibold">
                Revenue · Costs · Profit (quarterly)
                <span className="text-gray-500 font-normal ml-1">· {earnings.financials.length} reported quarters</span>
              </p>
              <FinancialsBarChart data={earnings.financials} currency={earnings.currency || currency} />
            </div>
          )}

          {dividends.length > 0 && (
            <details className="bg-bg-input rounded-lg px-3 py-2">
              <summary className="text-xs text-gray-300 cursor-pointer">
                {dividends.length} dividends in period — total {formatPrice(totalDivs, currency)}
              </summary>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-400 max-h-32 overflow-y-auto">
                {dividends.slice().reverse().map(d => (
                  <div key={d.date + d.amount} className="flex justify-between">
                    <span>{d.date}</span>
                    <span className="text-gray-200">{d.amount.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[10px] text-gray-700">
            Solid line = price · Dashed line = total return (dividends reinvested at ex-date) · Orange bars = quarterly EPS · Blue/violet bars = quarterly revenue/net income (right axis when overlay enabled).
            IRR ({timeframe}) = CAGR of the total-return series · IRR (cash flow) = rate that zeros the NPV of discrete cashflows.
            Source: Yahoo Finance · Not financial advice.
          </p>
        </div>
        </DetailModal>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-2.5 py-1.5">
      <p className="text-[9px] text-gray-500 mb-0.5 truncate">{label}</p>
      <p className={clsx('text-[13px] font-bold tabular-nums truncate', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}

