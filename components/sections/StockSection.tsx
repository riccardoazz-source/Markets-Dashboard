'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { HistoricalPoint, Timeframe, QuoteData } from '@/lib/types';
import {
  calculateCAGR, formatPercent, formatPrice, colorForPercent,
  buildTotalReturnSeries, computeAssetIRR, DividendEvent, dataAvailabilityMessage,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore } from '@/lib/useChartDragSelect';
import { useGistData } from '@/lib/gist';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  computeBollingerBands, computeFibLevels,
} from '@/lib/indicators';
import {
  ResponsiveContainer, LineChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, ComposedChart, Cell, ReferenceArea, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';

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

type StockSortKey = 'changePercent' | 'mtdChangePercent' | 'ytdChangePercent';

const WATCHLIST_SORT_OPTIONS: { value: StockSortKey; label: string }[] = [
  { value: 'changePercent',    label: 'Day' },
  { value: 'mtdChangePercent', label: 'MTD' },
  { value: 'ytdChangePercent', label: 'YTD' },
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
}

function DualChart({
  prices, totalReturn, currency, eps, financials, toolsOverlay,
}: {
  prices: HistoricalPoint[];
  totalReturn: HistoricalPoint[];
  currency: string;
  eps?: EarningsPoint[];
  financials?: FinancialPoint[];
  toolsOverlay?: DualChartToolsOverlay;
}) {
  const { handlers, range, area, clear } = useChartDragSelect();
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

  // Moving-average / band / level overlays (all on the price axis)
  const sma20Vals  = toolsOverlay?.sma20  ? computeSMA(toolCloses, 20)  : null;
  const sma50Vals  = toolsOverlay?.sma50  ? computeSMA(toolCloses, 50)  : null;
  const sma200Vals = toolsOverlay?.sma200 ? computeSMA(toolCloses, 200) : null;
  const ema20Vals  = toolsOverlay?.ema20  ? computeEMA(toolCloses, 20)  : null;
  const bands      = toolsOverlay?.bollinger ? computeBollingerBands(toolCloses, 20, 2) : null;
  const fibLevels  = toolsOverlay?.fib ? computeFibLevels(toolCloses) : null;
  const overlayByDate = new Map<string, {
    sma20: number | null; sma50: number | null; sma200: number | null;
    ema20: number | null; bbRange: [number, number] | null;
  }>();
  if (sma20Vals || sma50Vals || sma200Vals || ema20Vals || bands) {
    prices.forEach((p, i) => {
      overlayByDate.set(p.date, {
        sma20:  sma20Vals?.[i]  ?? null,
        sma50:  sma50Vals?.[i]  ?? null,
        sma200: sma200Vals?.[i] ?? null,
        ema20:  ema20Vals?.[i]  ?? null,
        bbRange: bands && bands.lower[i] != null && bands.upper[i] != null
          ? [bands.lower[i] as number, bands.upper[i] as number]
          : null,
      });
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
    sma50:  overlayByDate.get(date)?.sma50  ?? null,
    sma200: overlayByDate.get(date)?.sma200 ?? null,
    ema20:  overlayByDate.get(date)?.ema20  ?? null,
    bbRange: overlayByDate.get(date)?.bbRange ?? null,
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

  // Drag-selection price change
  let selStats: { leftVal: number; rightVal: number; pct: number } | null = null;
  if (range) {
    const lv = valueAtOrAfter(prices, range.left, 'close');
    const rv = valueAtOrBefore(prices, range.right, 'close');
    if (lv != null && rv != null && lv !== 0) {
      selStats = { leftVal: lv, rightVal: rv, pct: (rv - lv) / Math.abs(lv) * 100 };
    }
  }
  const fmtD = (d: string) => { try { return format(parseISO(d), 'MMM d, yyyy'); } catch { return d; } };

  return (
    <div className="relative select-none">
      {range && selStats && (
        <div className="flex items-center justify-between mb-2 bg-bg-input rounded-lg px-3 py-1.5 text-xs flex-wrap gap-2">
          <span className="text-gray-400">{fmtD(range.left)} → {fmtD(range.right)}</span>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 tabular-nums">
              {formatPrice(selStats.leftVal, currency)} → {formatPrice(selStats.rightVal, currency)}
            </span>
            <span className={`font-bold tabular-nums ${selStats.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {selStats.pct >= 0 ? '+' : ''}{selStats.pct.toFixed(2)}%
            </span>
            <button onClick={clear} className="text-gray-600 hover:text-gray-300 text-[10px] ml-1">✕</button>
          </div>
        </div>
      )}
      {(toolsOverlay?.sma20 || toolsOverlay?.sma50 || toolsOverlay?.sma200 ||
        toolsOverlay?.ema20 || toolsOverlay?.bollinger || toolsOverlay?.fib) && (
        <div className="flex items-center gap-3 mb-1 px-1 flex-wrap">
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
            if (name === 'sma20')  return [value != null ? formatPrice(value, currency) : '—', 'SMA 20'];
            if (name === 'sma50')  return [value != null ? formatPrice(value, currency) : '—', 'SMA 50'];
            if (name === 'sma200') return [value != null ? formatPrice(value, currency) : '—', 'SMA 200'];
            if (name === 'ema20')  return [value != null ? formatPrice(value, currency) : '—', 'EMA 20'];
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
        {toolsOverlay?.ema20 && (
          <Line yAxisId="price" type="monotone" dataKey="ema20" stroke="#f472b6"
            strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} name="ema20" />
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

function DividendsBarChart({ dividends, currency }: { dividends: DividendEvent[]; currency: string }) {
  if (!dividends.length) return null;
  const data = dividends.map(d => ({ date: d.date, amount: d.amount }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis dataKey="date"
          tickFormatter={d => { try { return format(parseISO(d as string), "MMM ''yy"); } catch { return d as string; } }}
          tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={56}
          tickFormatter={v => (v as number).toFixed(2)}
          domain={[(dataMin: number) => dataMin * 0.85, (dataMax: number) => dataMax * 1.1]} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
          itemStyle={{ color: '#e2e8f0' }}
          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
          formatter={(value: number) => [formatPrice(value, currency), 'Dividend']}
          labelFormatter={label => { try { return format(parseISO(label as string), 'MMM d, yyyy'); } catch { return label as string; } }}
        />
        <Bar dataKey="amount" fill="#10b981" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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

export function StockSection({ jumpTo }: { jumpTo?: string | null }) {
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
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: gistData } = useGistData();
  const [watchlistQuotes, setWatchlistQuotes] = useState<Record<string, QuoteData>>({});
  const [watchlistCategory, setWatchlistCategory] = useState('Watchlist');
  const [watchlistSort, setWatchlistSort] = useState<StockSortKey>('changePercent');

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
      setDataMsg(dataAvailabilityMessage(stockData?.prices ?? [], tf));
    } catch { setData(null); setDataMsg(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selected) fetchAsset(selected.symbol, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchAsset]);

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

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

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

  // Watchlist sorted by the active sort key (Day / MTD / YTD); symbols whose
  // quote hasn't loaded yet sink to the bottom.
  const sortedWatchlistSymbols = useMemo(() => {
    const valueOf = (sym: string): number | null => {
      const q = watchlistQuotes[sym];
      if (!q) return null;
      if (watchlistSort === 'changePercent') return q.changePercent ?? null;
      if (watchlistSort === 'mtdChangePercent') return q.mtdChangePercent ?? null;
      return q.ytdChangePercent ?? null;
    };
    return [...watchlistSymbols].sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }, [watchlistSymbols, watchlistQuotes, watchlistSort]);

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
  const cagrTR = calculateCAGR(totalReturn, timeframe);
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
          <div className="flex items-center justify-between flex-wrap gap-2">
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
            </div>
            {watchlistSymbols.length > 0 && (
              <div className="flex gap-1 bg-bg-input rounded-lg p-1 shrink-0">
                {WATCHLIST_SORT_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setWatchlistSort(opt.value)}
                    className={clsx('px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                      watchlistSort === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {watchlistSymbols.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {sortedWatchlistSymbols.map(sym => {
                const q = watchlistQuotes[sym];
                const change = q?.changePercent ?? null;
                const mtd = q?.mtdChangePercent ?? null;
                const ytd = q?.ytdChangePercent ?? null;
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
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold text-gray-100 font-mono">{sym}</span>
                      {change != null && (
                        <span className={clsx('text-[10px] font-bold tabular-nums', change >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    {q?.name && <p className="text-[10px] text-gray-500 truncate mb-1">{q.name}</p>}
                    {q?.price != null && (
                      <p className="text-sm font-bold text-white">{formatPrice(q.price, q.currency ?? 'USD')}</p>
                    )}
                    {(mtd != null || ytd != null) && (
                      <div className="mt-1.5 pt-1.5 border-t border-border/40 space-y-0.5">
                        {mtd != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-gray-600 uppercase tracking-wide">MTD</span>
                            <span className={clsx('text-[10px] font-semibold tabular-nums', mtd >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {mtd >= 0 ? '+' : ''}{mtd.toFixed(2)}%
                            </span>
                          </div>
                        )}
                        {ytd != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-gray-600 uppercase tracking-wide">YTD</span>
                            <span className={clsx('text-[10px] font-semibold tabular-nums', ytd >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {ytd >= 0 ? '+' : ''}{ytd.toFixed(2)}%
                            </span>
                          </div>
                        )}
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
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">{selected.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                <span className="font-mono">{selected.symbol}</span>
                {selected.exchange ? ` · ${selected.exchange}` : ''}
                {data?.meta?.currency ? ` · ${data.meta.currency}` : ''}
              </p>
            </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <Stat label="Price" value={formatPrice(data.meta.price, currency)} />
              {cagrPrice && (
                <Stat label={`Return (${timeframe})`} value={formatPercent(cagrPrice.return)} color={colorForPercent(cagrPrice.return)} />
              )}
              {cagrPrice && (
                <Stat label={`CAGR (${timeframe})`} value={formatPercent(cagrPrice.cagr)} color={colorForPercent(cagrPrice.cagr)} />
              )}
              {cagrTR && dividends.length > 0 && (
                <Stat label={`IRR (${timeframe})`} value={formatPercent(cagrTR.cagr)} color={colorForPercent(cagrTR.cagr)} />
              )}
              {nrIRR != null && (
                <Stat label="IRR (cash flow)" value={formatPercent(nrIRR * 100)} color={colorForPercent(nrIRR * 100)} />
              )}
              {peTtm != null && peTtm > 0 && peTtm <= 1000 ? (
                <Stat label="P/E (TTM)" value={`${peTtm.toFixed(1)}x`} color="text-sky-400" />
              ) : epsList.length > 0 && peTtm == null ? (
                <Stat label="P/E (TTM)" value="N/A" color="text-gray-600" />
              ) : null}
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
              {data.meta.high52w != null && <Stat label="52W High" value={formatPrice(data.meta.high52w, currency)} />}
              {data.meta.low52w != null && <Stat label="52W Low" value={formatPrice(data.meta.low52w, currency)} />}
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
              totalReturn={totalReturn}
              currency={currency}
              eps={overlay === 'eps' ? earnings?.quarterly : undefined}
              financials={overlay === 'financials' ? earnings?.financials : undefined}
              toolsOverlay={activeTools}
            />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-500 text-sm">
              No data found. Try a different ticker.
            </div>
          )}

          {/* RSI / MACD oscillator sub-charts for stocks */}
          {!loading && prices.length > 0 && activeTools.rsi && (() => {
            const stockCloses = prices.map(p => p.close).filter((c): c is number => isFinite(c));
            const rsiVals = computeRSI(stockCloses);
            const rsiData = prices.map((p, i) => ({ date: p.date, rsi: rsiVals[i] }));
            const valid = rsiData.filter(d => d.rsi != null);
            if (!valid.length) return <div className="text-[10px] text-gray-600 py-1">RSI: not enough data</div>;
            return (
              <div className="rounded-lg border border-border p-3 bg-bg-input/40">
                <p className="text-[10px] text-indigo-400 font-semibold mb-1">RSI 14</p>
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
            const stockCloses = prices.map(p => p.close).filter((c): c is number => isFinite(c));
            const macdResult = computeMACD(stockCloses);
            const macdData = prices.map((p, i) => ({
              date: p.date,
              macd: macdResult.macd[i], signal: macdResult.signal[i], hist: macdResult.hist[i],
            }));
            const valid = macdData.filter(d => d.hist != null);
            if (!valid.length) return <div className="text-[10px] text-gray-600 py-1">MACD: not enough data</div>;
            return (
              <div className="rounded-lg border border-border p-3 bg-bg-input/40">
                <p className="text-[10px] text-blue-400 font-semibold mb-1">MACD (12, 26, 9)</p>
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
            <ChartTools data={prices} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {!loading && prices.length > 0 && (
            <ChartDataTable data={prices} unit={currency} />
          )}
          {selected && <ChartNotes chartId={`stock:${selected.symbol}`} defaultCategory="Watchlist" />}

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
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className={clsx('text-sm font-bold tabular-nums', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}
