'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import {
  calculateCAGR, formatPercent, formatPrice, colorForPercent,
  buildTotalReturnSeries, computeAssetIRR, DividendEvent,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, ComposedChart, Cell,
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

const TF_OPTIONS: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

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

function DualChart({
  prices, totalReturn, currency, eps, financials,
}: {
  prices: HistoricalPoint[];
  totalReturn: HistoricalPoint[];
  currency: string;
  eps?: EarningsPoint[];          // when present, overlay quarterly EPS bars on right axis
  financials?: FinancialPoint[];  // when present, overlay revenue/profit bars on right axis
}) {
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
  }));

  const decimals = 2;
  const isUp = (prices[prices.length - 1]?.close ?? 0) >= (prices[0]?.close ?? 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      {/* key forces a fresh ComposedChart mount when the overlay changes — Recharts'
          internal layout doesn't always recompute when YAxis components are added/removed. */}
      <ComposedChart key={`chart-${showEps ? 'eps' : ''}${showFin ? 'fin' : ''}${showPe ? 'pe' : ''}`}
        data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
            const label = name === 'price' ? 'Price' : 'Total Return (incl. div.)';
            return [formatPrice(value, currency), label];
          }}
          labelFormatter={label => { try { return format(parseISO(label as string), 'MMM d, yyyy'); } catch { return label as string; } }}
        />
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
      </ComposedChart>
    </ResponsiveContainer>
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

export function StockSection() {
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const fetchAsset = useCallback(async (sym: string, tf: Timeframe) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&timeframe=${tf}`);
      setData(await res.json() as StockData);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selected) fetchAsset(selected.symbol, timeframe);
  }, [selected, timeframe, fetchAsset]);

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

      {!selected && (
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
            <TimeframeSelector value={timeframe} onChange={setTimeframe} options={TF_OPTIONS} />
          </div>

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
            />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-500 text-sm">
              No data found. Try a different ticker.
            </div>
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
