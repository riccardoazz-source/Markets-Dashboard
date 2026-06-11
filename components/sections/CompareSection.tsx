'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Component, ReactNode } from 'react';
import { ALL_COMPARABLE_ASSETS, RECESSION_SERIES, BTC_HALVING_DATES, FOMC_MEETING_DATES, MARKET_EVENTS } from '@/lib/config';
import { CompareAsset, HistoricalPoint, Timeframe } from '@/lib/types';
import {
  pctChangeFromStart, calculateCAGR, formatPercent, colorForPercent,
  CHART_COLORS, getTimeframeStart, buildTotalReturnSeries, computeAssetIRR,
  correlationMatrix, extendToToday, CorrAlignedRow,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { CompareChart } from '@/components/charts/CompareChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { X, Search, ChevronDown, ChevronUp, Layers, Minus, Plus } from 'lucide-react';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { StackAnalysisPanel, DEFAULT_TOOLS } from '@/components/ui/StackAnalysisPanel';
import type { ActiveTools } from '@/components/ui/ChartTools';

class ChartErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { console.error('[CompareChart] render error:', error); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          Chart rendering error — try a different timeframe or asset.
        </div>
      );
    }
    return this.props.children;
  }
}

const PRESETS = [
  { label: 'Indexes', symbols: ['^GSPC', '^NDX', '^STOXX50E', 'URTH'] },
  { label: 'Crypto',  symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'] },
  { label: 'Commodities', symbols: ['GC=F', 'SI=F', 'CL=F'] },
  { label: 'Tech Sectors', symbols: ['XLK', 'SOXX', 'AIQ', 'CIBR'] },
];

const TF_OPTIONS: Timeframe[] = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface StockApiResp {
  symbol: string; meta: unknown;
  prices: HistoricalPoint[];
  adjPrices?: HistoricalPoint[];
  dividends: { date: string; amount: number }[];
}
interface SearchHit { symbol: string; name: string; exchange: string; type: string }

// ── per-symbol name cache so custom stocks keep their name after fetching ──
const nameCacheRef: Record<string, string> = {};

// Recession series render as shaded bands, not data lines — excluded from
// stats cards. Included in correlation as 0/1 (point-biserial correlation).
const RECESSION_SET = new Set(RECESSION_SERIES);

// ── Spread series ───────────────────────────────────────────────────────────
// A spread is a synthetic series defined by two of the compared assets: it is
// (assetA − assetB) computed point-by-point on the SAME values the chart shows
// (so in "% Change" mode it is the percentage-point outperformance of A over B,
// and in "Absolute price" mode it is the raw price difference). It is added as a
// new line and participates in the correlation matrix like any other series.
const SPREAD_PREFIX = '__SPREAD__';
const SPREAD_COLORS = ['#f472b6', '#facc15', '#22d3ee', '#a3e635', '#fb923c', '#c084fc'];
const isSpreadSymbol = (s: string) => s.startsWith(SPREAD_PREFIX);
const spreadSymbol = (a: string, b: string) => `${SPREAD_PREFIX}${a}__${b}`;

// Difference of two aligned series, keyed by date (intersection only).
function diffSeries(a: HistoricalPoint[], b: HistoricalPoint[]): HistoricalPoint[] {
  const bMap = new Map(b.map(d => [d.date, d.close]));
  const out: HistoricalPoint[] = [];
  for (const d of a) {
    const bv = bMap.get(d.date);
    if (bv == null || !isFinite(d.close) || !isFinite(bv)) continue;
    out.push({ date: d.date, close: d.close - bv });
  }
  return out;
}

// Build the synthetic spread assets from the already-aligned display assets.
function buildSpreadAssets(
  base: CompareAsset[],
  spreads: { a: string; b: string }[],
): CompareAsset[] {
  const bySym = new Map(base.map(a => [a.symbol, a]));
  const out: CompareAsset[] = [];
  spreads.forEach((sp, idx) => {
    const A = bySym.get(sp.a);
    const B = bySym.get(sp.b);
    if (!A || !B) return; // an underlying asset was removed
    // Chart line: difference of the displayed (mode-aware) values.
    const data = diffSeries(A.data, B.data);
    if (data.length < 2) return;
    // Raw difference (absolute units) for stats + correlation.
    const rawData = A.rawData && B.rawData ? diffSeries(A.rawData, B.rawData) : data;
    out.push({
      symbol: spreadSymbol(sp.a, sp.b),
      name: `${A.name} − ${B.name}`,
      type: 'index', // plain monotone line (not stepped/crypto)
      color: SPREAD_COLORS[idx % SPREAD_COLORS.length],
      data,
      rawData,
      isSpread: true,
    });
  });
  return out;
}

export function CompareSection({ jumpTo }: { jumpTo?: string | null }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => {
    if (jumpTo?.startsWith('compare:')) {
      const syms = jumpTo.slice('compare:'.length).split(',').filter(Boolean);
      if (syms.length > 0) return syms;
    }
    return ['^GSPC', '^NDX', 'GC=F'];
  });
  const [assets, setAssets] = useState<CompareAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [normalized, setNormalized] = useState(true);
  // Linear scale by default. Log is an opt-in toggle for when one asset has
  // returns many times larger than the others (e.g. an index vs a macro series).
  const [logScale, setLogScale] = useState(false);
  const [showStack, setShowStack] = useState(false);
  const [stackAssetIdx, setStackAssetIdx] = useState(0);
  const [stackTools, setStackTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  // Spread series (assetA − assetB), defined by symbol pairs.
  const [spreads, setSpreads] = useState<{ a: string; b: string }[]>([]);
  const [showSpreadPanel, setShowSpreadPanel] = useState(false);
  const [spreadA, setSpreadA] = useState<string>('');
  const [spreadB, setSpreadB] = useState<string>('');
  // Dual search: local config + remote Yahoo search
  const [search, setSearch] = useState('');
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search || search.length < 1) { setRemoteHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stock?mode=search&q=${encodeURIComponent(search)}`);
        const json = await res.json() as SearchHit[];
        setRemoteHits(Array.isArray(json) ? json : []);
      } catch { setRemoteHits([]); }
      finally { setSearching(false); }
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setSearch('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchAsset = useCallback(async (symbol: string, color: string, tf: Timeframe, dateRange?: { from: string; to: string }): Promise<CompareAsset | null> => {
    const config = ALL_COMPARABLE_ASSETS.find(a => a.symbol === symbol);
    const displayName = nameCacheRef[symbol] ?? config?.name ?? symbol;

    try {
      let data: HistoricalPoint[] = [];
      let adjData: HistoricalPoint[] = [];
      let dividends: { date: string; amount: number }[] = [];

      if (config?.type === 'crypto') {
        // For custom date ranges, compute days from the range span; otherwise use the timeframe map.
        let days: number;
        if (dateRange) {
          const spanMs = new Date(dateRange.to).getTime() - new Date(dateRange.from).getTime();
          // Add 10% buffer so commonStart alignment never truncates the first visible point.
          days = Math.max(365, Math.ceil(spanMs / 86_400_000 * 1.1));
        } else {
          // Cap at 3650: CoinGecko free tier silently returns MONTHLY data for
          // days > ~3650, breaking SMA/EMA tools (e.g. MAX=4000 → 141 monthly pts).
          const daysMap: Record<string, number> = { '1D': 3, '1W': 7, '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650, 'MAX': 3650 };
          days = daysMap[tf] ?? 365;
        }
        const coinId = symbol.replace('-USD', '').toLowerCase();
        const coinMap: Record<string, string> = {
          btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
          xrp: 'ripple', ada: 'cardano', avax: 'avalanche-2', link: 'chainlink',
        };
        const id = coinMap[coinId] ?? coinId;
        // For MAX timeframe: try Yahoo first (daily from 2014, more complete than CG cap)
        if (tf === 'MAX' && !dateRange) {
          const yhRes = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=MAX`);
          if (yhRes.ok) { const j = await yhRes.json(); if (Array.isArray(j) && j.length > 500) data = j; }
        }
        if (!data.length) {
          const cgRes = await fetch(`/api/crypto?mode=historical&id=${id}&days=${days}`);
          if (cgRes.ok) {
            const json = await cgRes.json();
            if (Array.isArray(json) && json.length > 0) data = json as HistoricalPoint[];
          }
        }
        if (!data.length) {
          const histParams = dateRange
            ? `symbol=${encodeURIComponent(symbol)}&from=${dateRange.from}&to=${dateRange.to}&timeframe=MAX`
            : `symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
          const yhRes = await fetch(`/api/historical?${histParams}`);
          if (yhRes.ok) { const j = await yhRes.json(); if (Array.isArray(j) && j.length) data = j; }
        }
        if (!data.length) return null;
      } else if (config?.type === 'macro') {
        const from = dateRange ? dateRange.from : getTimeframeStart(tf);
        const toParam = dateRange ? `&to=${dateRange.to}` : '';
        const res = await fetch(`/api/macro?mode=history&id=${encodeURIComponent(symbol)}&from=${from}${toParam}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || !json.length) return null;
        data = json as HistoricalPoint[];
      } else if (config?.type === 'currency') {
        // Currency pairs: use /api/historical with date params when a custom range is active.
        const urlParams = dateRange
          ? `symbol=${encodeURIComponent(symbol)}&from=${dateRange.from}&to=${dateRange.to}&timeframe=MAX`
          : `symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
        const res = await fetch(`/api/historical?${urlParams}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || !json.length) return null;
        data = json as HistoricalPoint[];
      } else {
        // Stocks/indexes/ETFs/sectors — use date params when a custom range is set so Yahoo
        // gets a targeted period1/period2 query (reliable) instead of range=max (large/slow).
        const stockUrl = dateRange
          ? `/api/stock?symbol=${encodeURIComponent(symbol)}&from=${dateRange.from}&to=${dateRange.to}`
          : `/api/stock?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
        const res = await fetch(stockUrl);
        if (res.ok) {
          const json = await res.json() as StockApiResp;
          if (Array.isArray(json.prices) && json.prices.length) {
            data = json.prices;
            // adjPrices are split + dividend adjusted — use as total-return series.
            // Fall back to manual reinvestment only when adjPrices are not returned.
            if (Array.isArray(json.adjPrices) && json.adjPrices.length) {
              adjData = json.adjPrices;
            }
            dividends = Array.isArray(json.dividends) ? json.dividends : [];
            // Cache name from meta if available
            if (!nameCacheRef[symbol] && json.meta) {
              const m = json.meta as Record<string, unknown>;
              const n = (m.shortName as string) ?? (m.longName as string);
              if (n) nameCacheRef[symbol] = n;
            }
          }
        }
        if (!data.length) {
          const fbParams = dateRange
            ? `symbol=${encodeURIComponent(symbol)}&from=${dateRange.from}&to=${dateRange.to}&timeframe=MAX`
            : `symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
          const fb = await fetch(`/api/historical?${fbParams}`);
          if (fb.ok) { const j = await fb.json(); if (Array.isArray(j) && j.length) data = j; }
        }
        if (!data.length) return null;
      }

      // Total-return series only when the asset actually pays dividends.
      // Raw indexes (^GSPC, ^NDX…) and macro series have no distributions, so
      // their TR line would just duplicate the price line — skip it entirely.
      // When dividends exist, prefer adjPrices (Yahoo adjclose handles splits +
      // dividends), falling back to manual reinvestment.
      const totalReturnData: HistoricalPoint[] | undefined =
        dividends.length > 0
          ? (adjData.length > 0 ? adjData : buildTotalReturnSeries(data, dividends))
          : undefined;

      const cagr = calculateCAGR(data, tf);
      const cagrTR = totalReturnData ? calculateCAGR(totalReturnData, tf) : undefined;
      const irr = dividends.length > 0 ? computeAssetIRR(data, dividends) : undefined;

      // For chart: % change from start (Google Finance style) or absolute
      const displayData = normalized ? pctChangeFromStart(data) : data;
      const displayTrData = totalReturnData
        ? (normalized ? pctChangeFromStart(totalReturnData) : totalReturnData)
        : undefined;

      return {
        symbol,
        name: nameCacheRef[symbol] ?? displayName,
        type: config?.type ?? 'stock',
        color,
        data: displayData,
        rawData: data,
        totalReturnData,
        trData: displayTrData,
        cagr: cagr?.cagr,
        totalReturn: cagr?.return,
        cagrWithDiv: cagrTR?.cagr,
        irr: irr != null ? irr * 100 : undefined,
        dividends,
      };
    } catch { return null; }
  }, [normalized]);

  const fetchAll = useCallback(async () => {
    if (!selectedSymbols.length) { setAssets([]); return; }
    setLoading(true);
    // For custom ranges: pass the exact from/to dates so APIs request a targeted
    // period1/period2 query from Yahoo (fast & reliable) instead of range=max.
    // For standard timeframes: use the timeframe string as before.
    const fetchTF: Timeframe = customRange ? 'MAX' : timeframe;
    const dateRange = customRange ? { from: customRange.from, to: customRange.to } : undefined;
    const results: (CompareAsset | null)[] = [];
    for (let i = 0; i < selectedSymbols.length; i++) {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      let asset = await fetchAsset(selectedSymbols[i], color, fetchTF, dateRange);
      if (!asset) {
        await new Promise(r => setTimeout(r, 1500));
        asset = await fetchAsset(selectedSymbols[i], color, fetchTF, dateRange);
      }
      results.push(asset);
    }
    setAssets(results.filter(Boolean) as CompareAsset[]);
    setLoading(false);
  }, [selectedSymbols, timeframe, customRange, fetchAsset]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (jumpTo?.startsWith('compare:')) {
      const syms = jumpTo.slice('compare:'.length).split(',').filter(Boolean);
      if (syms.length > 0) setSelectedSymbols(syms);
    }
  }, [jumpTo]);

  // Drop spreads whose underlying assets are no longer selected.
  useEffect(() => {
    setSpreads(prev => {
      const next = prev.filter(s => selectedSymbols.includes(s.a) && selectedSymbols.includes(s.b));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedSymbols]);

  // Keep the A/B pickers pointing at valid, distinct selected symbols.
  const spreadPickable = selectedSymbols.filter(s => !isSpreadSymbol(s));
  useEffect(() => {
    setSpreadA(prev => (prev && spreadPickable.includes(prev) ? prev : spreadPickable[0] ?? ''));
    setSpreadB(prev => (prev && spreadPickable.includes(prev) ? prev : spreadPickable[1] ?? spreadPickable[0] ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbols]);

  const addSpread = () => {
    if (!spreadA || !spreadB || spreadA === spreadB) return;
    setSpreads(prev =>
      prev.some(s => s.a === spreadA && s.b === spreadB) ? prev : [...prev, { a: spreadA, b: spreadB }]
    );
  };
  const removeSpread = (a: string, b: string) =>
    setSpreads(prev => prev.filter(s => !(s.a === a && s.b === b)));

  const symbolName = (s: string) =>
    nameCacheRef[s] ?? ALL_COMPARABLE_ASSETS.find(x => x.symbol === s)?.name ?? s;

  const addSymbol = (symbol: string, name?: string) => {
    if (selectedSymbols.includes(symbol) || selectedSymbols.length >= 8) return;
    if (name) nameCacheRef[symbol] = name;
    setSelectedSymbols(prev => [...prev, symbol]);
    setSearch('');
    setRemoteHits([]);
  };

  const removeSymbol = (symbol: string) => setSelectedSymbols(prev => prev.filter(s => s !== symbol));
  const loadPreset = (preset: typeof PRESETS[0]) => setSelectedSymbols(preset.symbols);

  // Local config search (exclude already selected)
  const localHits = ALL_COMPARABLE_ASSETS.filter(a =>
    !selectedSymbols.includes(a.symbol) &&
    (a.name.toLowerCase().includes(search.toLowerCase()) ||
     a.symbol.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 8);

  // Remote hits that aren't already in local config or selected
  const localSymbols = new Set(ALL_COMPARABLE_ASSETS.map(a => a.symbol));
  const extraRemoteHits = remoteHits
    .filter(h => !selectedSymbols.includes(h.symbol) && !localSymbols.has(h.symbol))
    .slice(0, 8);

  // For ALL timeframes: trim every asset to the same common start date.
  // commonStart = latest first-date after clipping each series to the
  // selected timeframe window. This ensures:
  //   1. No asset shows data before the selected timeframe start
  //   2. All assets start at the same date (shortest-available series wins)
  //   3. rawData + totalReturnData are trimmed so correlation uses the same range
  const displayAssets = useMemo(() => {
    if (!assets.length) return assets;
    try {
      const tfStart = customRange ? customRange.from : getTimeframeStart(timeframe);
      const tfEnd = customRange ? customRange.to : null;

      // First pass: find each asset's first date that falls within the TF window.
      // Recession assets and event overlays (BTC_HALVING, FOMC_MEETINGS) carry full
      // history and are excluded from commonStart so they don't constrain other assets.
      const EVENT_OVERLAY = new Set([...RECESSION_SERIES, 'BTC_HALVING', 'FOMC_MEETINGS', 'MARKET_EVENTS']);
      const firstDates = assets
        .filter(a => !EVENT_OVERLAY.has(a.symbol))
        .map(a => {
          const raw = a.rawData ?? a.data;
          const rawFirst = raw.find(d => d.date >= tfStart)?.date ?? tfStart;
          const tr = a.totalReturnData;
          if (!tr || tr.length === 0) return rawFirst;
          const trFirst = tr.find(d => d.date >= tfStart)?.date ?? tfStart;
          return rawFirst > trFirst ? rawFirst : trFirst;
        });
      const commonStart = firstDates.length > 0
        ? firstDates.reduce((a, b) => (a > b ? a : b))
        : tfStart;

      return assets.map(a => {
        const raw = a.rawData ?? a.data;
        const isOverlay = EVENT_OVERLAY.has(a.symbol);
        // rawFiltered: full history for overlay assets (recession bands, FOMC lines)
        // so CompareChart can find all events even on short timeframes.
        let rawFiltered = isOverlay ? raw : raw.filter(d => d.date >= commonStart);
        if (tfEnd && !isOverlay) rawFiltered = rawFiltered.filter(d => d.date <= tfEnd);
        // displayFiltered: always trimmed to the visible range so the Stack
        // panel and all display charts align with the main chart timeframe.
        let displayFiltered = raw.filter(d => d.date >= commonStart);
        if (tfEnd) displayFiltered = displayFiltered.filter(d => d.date <= tfEnd);
        let trFiltered = a.totalReturnData?.filter(d => d.date >= commonStart);
        if (tfEnd && trFiltered) trFiltered = trFiltered.filter(d => d.date <= tfEnd);
        const divsFiltered = (a.dividends ?? []).filter(d =>
          d.date >= commonStart && (!tfEnd || d.date <= tfEnd)
        );
        const isRec = RECESSION_SET.has(a.symbol);
        // Macro series: only extend to today (so the line reaches "now" visually).
        // Removed dedupStepSeries: it dropped any data point whose value matched
        // the previous one, which thinned the series during flat-policy periods
        // and hid intra-period jitter on daily series (NY Fed EFFR, T-yields).
        // The chart already uses type="stepAfter" for macro, which renders the
        // step look from the full data.
        const displayRaw = a.type === 'macro' && !isOverlay
          ? extendToToday(displayFiltered)
          : displayFiltered;
        const displayData = normalized ? pctChangeFromStart(displayRaw) : displayRaw;
        const displayTrData = trFiltered
          ? (normalized ? pctChangeFromStart(trFiltered) : trFiltered)
          : undefined;

        // Recompute PRICE-ONLY Return/CAGR on the trimmed (commonStart→today)
        // window so card numbers reflect exactly the same period the chart
        // shows. IRR already covers the dividend-inclusive metric separately.
        const cagrPrice = isOverlay ? null : calculateCAGR(rawFiltered, timeframe);
        const cagrTR = trFiltered && trFiltered.length > 1
          ? calculateCAGR(trFiltered, timeframe)
          : null;
        const irrTrim = divsFiltered.length > 0
          ? computeAssetIRR(rawFiltered, divsFiltered)
          : null;

        return {
          ...a,
          data: displayData,
          rawData: rawFiltered,
          totalReturnData: trFiltered,
          trData: displayTrData,
          cagr: cagrPrice?.cagr,
          totalReturn: cagrPrice?.return,
          cagrWithDiv: cagrTR?.cagr,
          irr: irrTrim != null ? irrTrim * 100 : a.irr,
        };
      });
    } catch (e) {
      console.error('[CompareSection] displayAssets error:', e);
      return assets;
    }
  }, [assets, timeframe, customRange, normalized]);

  // Synthetic spread series, derived from the aligned display assets.
  const spreadAssets = useMemo(
    () => buildSpreadAssets(displayAssets, spreads),
    [displayAssets, spreads],
  );
  // Everything that feeds the chart, stats cards and correlation matrix.
  const allAssets = useMemo(
    () => [...displayAssets, ...spreadAssets],
    [displayAssets, spreadAssets],
  );

  const safeStackIdx = Math.min(stackAssetIdx, Math.max(0, displayAssets.length - 1));
  const mainChartAssets = (showStack && displayAssets.length > 1
    ? displayAssets.filter((_, i) => i !== safeStackIdx)
    : displayAssets
  ).concat(spreadAssets);

  const correl = useMemo(() => {
    try {
      // USREC is included with its raw 0/1 values (point-biserial correlation).
      // BTC_HALVING and FOMC_MEETINGS are excluded here and added below as 0/1
      // dummies (their raw series are event markers, not continuous values).
      const DUMMY_SET = new Set(['BTC_HALVING', 'FOMC_MEETINGS', 'MARKET_EVENTS']);
      const series: { symbol: string; data: HistoricalPoint[] }[] = allAssets
        .filter(a => !DUMMY_SET.has(a.symbol) && (a.rawData ?? a.data).length > 1)
        .map(a => ({ symbol: a.symbol, data: a.rawData ?? a.data }));

      // Helper: generate a monthly 0/1 dummy spanning minMonth..maxMonth.
      // We use the 15th of each month as the anchor date so cadence detection
      // sees ~30-day spacing → classified as 'M' (monthly) in correlationMatrix.
      // Explicit 0s are inserted for non-event months so LOCF doesn't carry a
      // stale 1 forward and inflate the series to a near-constant.
      function monthlyDummy(
        minMonth: string, // 'YYYY-MM'
        maxMonth: string,
        eventMonths: Set<string>,
      ): HistoricalPoint[] {
        const pts: HistoricalPoint[] = [];
        const cur = new Date(minMonth + '-15T12:00:00Z');
        const end = new Date(maxMonth + '-15T12:00:00Z');
        while (cur <= end) {
          const m = cur.toISOString().slice(0, 7);
          pts.push({ date: m + '-15', close: eventMonths.has(m) ? 1 : 0 });
          cur.setUTCMonth(cur.getUTCMonth() + 1);
        }
        return pts;
      }

      // Reference date range from the first non-dummy series (e.g. Bitcoin).
      const refData = series[0]?.data ?? [];
      const refMin = refData.length > 0 ? refData[0].date.slice(0, 7) : null;
      const refMax = refData.length > 0 ? refData[refData.length - 1].date.slice(0, 7) : null;

      const halvingAsset = displayAssets.find(a => a.symbol === 'BTC_HALVING');
      if (halvingAsset && refMin && refMax) {
        // BTC_HALVING: 1 in the month of each past halving, 0 otherwise.
        const halvingMonths = new Set(BTC_HALVING_DATES.map(d => d.slice(0, 7)));
        const halvingDummy = monthlyDummy(refMin, refMax, halvingMonths);
        if (halvingDummy.length > 1) series.push({ symbol: 'BTC_HALVING', data: halvingDummy });
      }

      const fomcAsset = displayAssets.find(a => a.symbol === 'FOMC_MEETINGS');
      if (fomcAsset && refMin && refMax) {
        // FOMC_MEETINGS: 1 in every month that contains at least one meeting, 0 otherwise.
        // We cannot use fomcAsset.rawData as the base because it only contains meeting
        // dates (all value=1) — mapping those dates against FOMC_MEETING_DATES would
        // always return 1, giving a constant series with zero variance (correlation = —).
        const fomcMonthSet = new Set(FOMC_MEETING_DATES.map(d => d.slice(0, 7)));
        const fomcDummy = monthlyDummy(refMin, refMax, fomcMonthSet);
        if (fomcDummy.length > 1) series.push({ symbol: 'FOMC_MEETINGS', data: fomcDummy });
      }

      const eventsAsset = displayAssets.find(a => a.symbol === 'MARKET_EVENTS');
      if (eventsAsset && refMin && refMax) {
        // MARKET_EVENTS: 1 in every month that contains at least one curated event.
        const eventMonthSet = new Set(MARKET_EVENTS.map(e => e.date.slice(0, 7)));
        const eventDummy = monthlyDummy(refMin, refMax, eventMonthSet);
        if (eventDummy.length > 1) series.push({ symbol: 'MARKET_EVENTS', data: eventDummy });
      }

      return correlationMatrix(series);
    } catch (e) {
      console.error('[CompareSection] correlationMatrix error:', e);
      return { labels: [], matrix: [] as (number | null)[][], sampleCount: 0, alignedData: [] as CorrAlignedRow[] };
    }
  }, [allAssets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => loadPreset(p)}
              className="px-3 py-1 text-xs font-medium rounded-full border border-border text-gray-400 hover:text-gray-100 hover:border-border-light transition-all">
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex gap-1">
            <button onClick={() => setNormalized(n => !n)}
              className={clsx('px-3 py-1 text-xs font-medium rounded-full transition-all border',
                normalized ? 'border-accent text-accent bg-accent/10' : 'border-border text-gray-400 hover:text-gray-200')}>
              {normalized ? '% Change' : 'Absolute price'}
            </button>
            {!normalized && (
              <button onClick={() => setLogScale(s => !s)}
                title="Logarithmic scale: useful when assets have very different magnitudes (e.g. BTC vs gold)"
                className={clsx('px-3 py-1 text-xs font-medium rounded-full transition-all border',
                  logScale ? 'border-amber-400 text-amber-400 bg-amber-400/10' : 'border-border text-gray-400 hover:text-gray-200')}>
                Log
              </button>
            )}
            <button
              onClick={() => setShowStack(v => !v)}
              title="Stack a technical analysis panel below the main chart"
              className={clsx('flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full transition-all border',
                showStack ? 'border-violet-400 text-violet-400 bg-violet-400/10' : 'border-border text-gray-400 hover:text-gray-200')}
            >
              <Layers size={12} />
              Stack
            </button>
            <button
              onClick={() => setShowSpreadPanel(v => !v)}
              disabled={selectedSymbols.length < 2}
              title="Add a spread series (asset A − asset B) as a new line"
              className={clsx('flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full transition-all border disabled:opacity-40 disabled:cursor-not-allowed',
                showSpreadPanel || spreads.length > 0 ? 'border-pink-400 text-pink-400 bg-pink-400/10' : 'border-border text-gray-400 hover:text-gray-200')}
            >
              <Minus size={12} />
              Spread{spreads.length > 0 ? ` (${spreads.length})` : ''}
            </button>
          </div>
          <TimeframeSelector
            value={timeframe}
            onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
            options={TF_OPTIONS}
            isCustom={!!customRange}
            onCustomRange={(from, to) => setCustomRange({ from, to })}
          />
        </div>
      </div>

      {/* Selected symbols chips + search */}
      <div className="flex flex-wrap gap-2 items-center">
        {selectedSymbols.map((s, i) => {
          const conf = ALL_COMPARABLE_ASSETS.find(a => a.symbol === s);
          return (
            <div key={s} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '33', border: `1px solid ${CHART_COLORS[i % CHART_COLORS.length]}66`, color: 'white' }}>
              <span style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>●</span>
              {nameCacheRef[s] ?? conf?.name ?? s}
              <button onClick={() => removeSymbol(s)} className="ml-1 opacity-70 hover:opacity-100"><X size={11} /></button>
            </div>
          );
        })}

        {selectedSymbols.length < 8 && (
          <div ref={searchRef} className="relative">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-border text-xs text-gray-500">
              <Search size={11} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Add asset…"
                className="bg-transparent outline-none text-gray-200 w-28" />
              {searching && <span className="text-[10px] text-gray-500 animate-pulse">…</span>}
            </div>

            {search.length > 0 && (localHits.length > 0 || extraRemoteHits.length > 0) && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-bg-card border border-border rounded-lg shadow-xl z-20 max-h-64 overflow-y-auto">
                {localHits.length > 0 && (
                  <>
                    <p className="px-3 pt-2 pb-1 text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Preset</p>
                    {localHits.map(a => (
                      <button key={a.symbol} onClick={() => addSymbol(a.symbol, a.name)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-bg-hover text-left">
                        <span className="text-gray-100 truncate">{a.name}</span>
                        <span className="text-gray-500 ml-2 shrink-0 font-mono text-[10px]">{a.symbol}</span>
                      </button>
                    ))}
                  </>
                )}
                {extraRemoteHits.length > 0 && (
                  <>
                    <p className="px-3 pt-2 pb-1 text-[10px] text-gray-600 uppercase tracking-wider font-semibold border-t border-border mt-1">Yahoo Finance</p>
                    {extraRemoteHits.map(h => (
                      <button key={h.symbol} onClick={() => addSymbol(h.symbol, h.name)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-bg-hover text-left">
                        <div className="min-w-0 flex-1">
                          <span className="text-gray-100 truncate block">{h.name}</span>
                          <span className="text-gray-500 text-[10px]">{h.exchange}</span>
                        </div>
                        <span className="text-gray-400 ml-2 shrink-0 font-mono text-[10px]">{h.symbol}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spread builder */}
      {(showSpreadPanel || spreads.length > 0) && (
        <div className="rounded-xl border border-pink-400/25 bg-pink-400/[0.03] p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Minus size={13} className="text-pink-400" />
            <span className="text-xs font-semibold text-gray-200">Spread</span>
            <span className="text-[10px] text-gray-500">= A − B over time, added as a new series</span>
          </div>

          {spreadPickable.length < 2 ? (
            <p className="text-[11px] text-gray-500">Select at least two assets to build a spread.</p>
          ) : (
            <div className="flex items-end gap-2 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">A</span>
                <select value={spreadA} onChange={e => setSpreadA(e.target.value)}
                  className="bg-bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-border-light max-w-[10rem]">
                  {spreadPickable.map(s => <option key={s} value={s}>{symbolName(s)}</option>)}
                </select>
              </label>
              <span className="pb-2 text-gray-400 font-bold">−</span>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">B</span>
                <select value={spreadB} onChange={e => setSpreadB(e.target.value)}
                  className="bg-bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-border-light max-w-[10rem]">
                  {spreadPickable.map(s => <option key={s} value={s}>{symbolName(s)}</option>)}
                </select>
              </label>
              <button onClick={addSpread}
                disabled={!spreadA || !spreadB || spreadA === spreadB}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-pink-400/50 text-pink-400 hover:bg-pink-400/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                <Plus size={12} /> Add spread
              </button>
            </div>
          )}

          {spreads.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {spreads.map((s, i) => (
                <div key={`${s.a}-${s.b}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: SPREAD_COLORS[i % SPREAD_COLORS.length] + '22', border: `1px solid ${SPREAD_COLORS[i % SPREAD_COLORS.length]}66`, color: 'white' }}>
                  <span style={{ color: SPREAD_COLORS[i % SPREAD_COLORS.length] }}>●</span>
                  {symbolName(s.a)} − {symbolName(s.b)}
                  <button onClick={() => removeSpread(s.a, s.b)} className="ml-1 opacity-70 hover:opacity-100"><X size={11} /></button>
                </div>
              ))}
            </div>
          )}

          {!normalized && (
            <p className="text-[10px] text-amber-400/70 leading-snug">
              In <strong>Absolute price</strong> mode the spread is the raw price difference, so it only makes sense when A and B share the same unit (e.g. two indices in $). In <strong>% Change</strong> mode it is the percentage-point outperformance of A over B.
            </p>
          )}
        </div>
      )}

      {logScale && !normalized && (
        <p className="text-[10px] text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-1.5">
          Logarithmic scale active — equal percentage moves take equal vertical space. Ideal when one asset has returns many times larger than others (e.g. BTC vs gold).
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-3"><LoadingSpinner size={36} />
            <p className="text-xs text-gray-500">Loading data…</p>
          </div>
        </div>
      ) : displayAssets.length > 0 ? (
        <ChartErrorBoundary>
          <div className="rounded-xl border border-border bg-bg-card p-4">
            <CompareChart assets={mainChartAssets} height={360} logScale={!normalized && logScale} percentMode={normalized}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          </div>

          {showStack && displayAssets.length > 0 && (
            <StackAnalysisPanel
              assets={displayAssets}
              assetIdx={safeStackIdx}
              onAssetSelect={setStackAssetIdx}
              activeTools={stackTools}
              onToolsChange={setStackTools}
              normalized={normalized}
            />
          )}

          {/* Stats cards — use displayAssets so numbers are computed on the
              same window the chart displays (commonStart → today), and prefer
              total-return values to match the dashed line. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {allAssets.map(a => RECESSION_SET.has(a.symbol) ? null : (
              <div key={a.symbol} className="rounded-xl border p-3 bg-bg-card"
                style={{ borderColor: a.color + '66' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <p className="text-sm font-semibold text-gray-100 truncate">{a.name}</p>
                  {a.isSpread ? (
                    <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-pink-400/10 text-pink-400 border border-pink-400/20">SPREAD</span>
                  ) : a.totalReturnData && (
                    <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">DIV</span>
                  )}
                </div>
                {a.isSpread ? (() => {
                  const last = a.data.length ? a.data[a.data.length - 1].close : null;
                  return (
                    <div>
                      <p className="text-[10px] text-gray-500">Latest spread{normalized ? ' (pp)' : ''}</p>
                      <p className={clsx('text-base font-bold', last != null ? colorForPercent(last) : 'text-gray-400')}>
                        {last == null ? '—'
                          : normalized ? formatPercent(last)
                          : `${last >= 0 ? '+' : ''}${last.toFixed(2)}`}
                      </p>
                      {normalized && (
                        <p className="mt-1 text-[10px] text-gray-600 leading-snug">A − B outperformance in percentage points</p>
                      )}
                    </div>
                  );
                })() : (
                  <>
                    {a.totalReturn != null && (
                      <div>
                        <p className="text-[10px] text-gray-500">Return ({customRange ? 'Custom' : timeframe})</p>
                        <p className={clsx('text-base font-bold', colorForPercent(a.totalReturn))}>{formatPercent(a.totalReturn)}</p>
                      </div>
                    )}
                    {a.cagr != null && (
                      <div className="mt-1">
                        <p className="text-[10px] text-gray-500">CAGR</p>
                        <p className={clsx('text-sm font-semibold', colorForPercent(a.cagr))}>{formatPercent(a.cagr)}</p>
                      </div>
                    )}
                    {a.cagrWithDiv != null && (
                      <div className="mt-1">
                        <p className="text-[10px] text-gray-500">IRR (w/ div.)</p>
                        <p className={clsx('text-sm font-semibold', colorForPercent(a.cagrWithDiv))}>{formatPercent(a.cagrWithDiv)}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Correlation matrix */}
          {correl.labels.length >= 2 && (
            <CorrelationMatrix
              labels={correl.labels}
              matrix={correl.matrix}
              sampleCount={correl.sampleCount}
              alignedData={correl.alignedData}
              names={Object.fromEntries(allAssets.map(a => [a.symbol, a.name]))}
            />
          )}
        </ChartErrorBoundary>
      ) : (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          Select assets to compare
        </div>
      )}

      {selectedSymbols.length > 0 && (
        <ChartNotes
          chartId={`compare:${[...selectedSymbols].sort().join(',')}`}
          defaultCategory="Compare"
        />
      )}
    </div>
  );
}

// ── Correlation strength helper ────────────────────────────────────────────
function corrStrength(v: number): { label: string; bg: string; text: string } {
  const a = Math.abs(v);
  const pos = v >= 0;
  if (a >= 0.90) return {
    label: 'Very strong',
    bg: pos ? 'rgba(5,150,105,0.85)' : 'rgba(185,28,28,0.85)',
    text: 'white',
  };
  if (a >= 0.60) return {
    label: 'Strong',
    bg: pos ? 'rgba(16,185,129,0.65)' : 'rgba(239,68,68,0.65)',
    text: 'white',
  };
  if (a >= 0.30) return {
    label: 'Moderate',
    bg: pos ? 'rgba(52,211,153,0.40)' : 'rgba(248,113,113,0.40)',
    text: pos ? '#6ee7b7' : '#fca5a5',
  };
  return {
    label: 'Weak',
    bg: 'rgba(40,44,65,0.7)',
    text: '#6b7280',
  };
}

function CorrelationMatrix({
  labels, matrix, sampleCount, alignedData, names,
}: {
  labels: string[];
  matrix: (number | null)[][];
  sampleCount: number;
  alignedData: CorrAlignedRow[];
  names: Record<string, string>;
}) {
  const [showData, setShowData] = useState(false);

  // Show most recent first
  const rows = [...alignedData].reverse();

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Correlation matrix</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {sampleCount} periods · green = positive, red = negative
          </p>
        </div>
        {/* Legend */}
        <div className="flex flex-col gap-1 text-[10px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 mr-1">Negative:</span>
            {[
              { label: 'Very strong (r ≤ −0.90)', bg: 'rgba(185,28,28,0.85)', text: 'white' },
              { label: 'Strong (−0.90 to −0.60)', bg: 'rgba(239,68,68,0.65)', text: 'white' },
              { label: 'Moderate (−0.60 to −0.30)', bg: 'rgba(248,113,113,0.40)', text: '#fca5a5' },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: l.bg, border: '1px solid rgba(255,255,255,0.08)' }} />
                <span style={{ color: l.text }}>{l.label}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 mr-1">Weak:</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(40,44,65,0.9)', border: '1px solid rgba(255,255,255,0.08)' }} />
              <span style={{ color: '#6b7280' }}>|r| &lt; 0.30</span>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 mr-1">Positive:</span>
            {[
              { label: 'Moderate (0.30 to 0.60)', bg: 'rgba(52,211,153,0.40)', text: '#6ee7b7' },
              { label: 'Strong (0.60 to 0.90)', bg: 'rgba(16,185,129,0.65)', text: 'white' },
              { label: 'Very strong (r ≥ 0.90)', bg: 'rgba(5,150,105,0.85)', text: 'white' },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: l.bg, border: '1px solid rgba(255,255,255,0.08)' }} />
                <span style={{ color: l.text }}>{l.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="pr-2" />
              {labels.map(l => (
                <th key={l} className="px-2 py-1 text-gray-400 font-mono text-[10px] text-center whitespace-nowrap" title={names[l]}>
                  {names[l] ?? l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((row, i) => (
              <tr key={row}>
                <td className="text-gray-300 font-medium pr-2 py-1 whitespace-nowrap text-[11px]">{names[row] ?? row}</td>
                {labels.map((col, j) => {
                  const v = matrix[i]?.[j];
                  const { bg, text } = v != null ? corrStrength(v) : { bg: '#1f2233', text: '#6b7280' };
                  return (
                    <td key={col} className="text-center font-mono text-[11px] tabular-nums px-2 py-1.5 rounded"
                      style={{ backgroundColor: bg, color: text, minWidth: 60 }}>
                      {v == null ? '—' : v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expandable raw-data panel */}
      {alignedData.length > 0 && (
        <div>
          <button
            onClick={() => setShowData(s => !s)}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showData ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showData ? 'Hide' : 'Inspect'} data used in calculation
            <span className="text-gray-700">({alignedData.length} periods)</span>
          </button>

          {showData && (
            <div className="mt-2 overflow-auto max-h-72 rounded-lg border border-border">
              <table className="text-[11px] w-full border-collapse">
                <thead className="sticky top-0 bg-bg-card z-10">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-gray-400 font-semibold border-b border-border whitespace-nowrap">Period</th>
                    {labels.map(l => (
                      <th key={l} className="text-right px-3 py-1.5 text-gray-400 font-semibold border-b border-border whitespace-nowrap">
                        {names[l] ?? l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-bg-input/40' : ''}>
                      <td className="px-3 py-1 text-gray-400 font-mono whitespace-nowrap">{row.period}</td>
                      {row.values.map((v, vi) => (
                        <td key={vi} className="px-3 py-1 text-right font-mono tabular-nums text-gray-200">
                          {v.toFixed(4)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
