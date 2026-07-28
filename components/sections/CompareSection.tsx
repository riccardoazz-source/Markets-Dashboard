'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Component, ReactNode } from 'react';
import { ALL_COMPARABLE_ASSETS, RECESSION_SERIES, BTC_HALVING_DATES, FOMC_MEETING_DATES, FED_CHAIR_CHANGES, MARKET_EVENTS, EVENT_INDICATOR_CATEGORY, COMPARE_ASSET_CLASSES, type CompareClass } from '@/lib/config';
import { useGistData } from '@/lib/gist';
import { CompareAsset, HistoricalPoint, Timeframe } from '@/lib/types';
import {
  pctChangeFromStart, calculateCAGR, formatPercent, colorForPercent,
  CHART_COLORS, getTimeframeStart, buildTotalReturnSeries, computeAssetIRR,
  correlationMatrix, extendToToday, CorrAlignedRow, pearson,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { CompareChart } from '@/components/charts/CompareChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { X, Search, ChevronDown, ChevronUp, Layers, Minus, Plus } from 'lucide-react';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { StackAnalysisPanel, DEFAULT_TOOLS } from '@/components/ui/StackAnalysisPanel';
import { ChartTools, type ActiveTools } from '@/components/ui/ChartTools';
import { IMF_INDICATOR_BY_CODE, MACRO_WORLD_ENABLED, imfCompareAssets, imfCompareClass } from '@/lib/imfConfig';

// Comparable universe = the static config assets plus (when enabled) the curated
// Macro World country×indicator series, so both can be searched/added in Compare.
const COMPARABLE_ASSETS = [
  ...ALL_COMPARABLE_ASSETS,
  ...(MACRO_WORLD_ENABLED ? imfCompareAssets() : []),
];

// Colour for each source tag shown next to a search result (which dashboard
// section the asset comes from).
const GROUP_TAG_COLOR: Record<string, string> = {
  'Macro World': 'text-emerald-400/80',
  Indexes: 'text-blue-400/80',
  Crypto: 'text-orange-400/80',
  Commodities: 'text-amber-400/80',
  Sectors: 'text-violet-400/80',
  Macro: 'text-cyan-400/80',
  FX: 'text-teal-400/80',
};

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
// stats cards. Included in correlation as a 0/1 series correlated with the
// asset's monthly returns (point-biserial correlation) — same r as any pair.

const RECESSION_SET = new Set(RECESSION_SERIES);

// Binary indicators (recessions, halvings, FOMC meetings, per-category event
// calendars) that must be correlated against an asset's RETURNS rather than its
// price level — see the correlation post-processing in the `correl` memo.
const INDICATOR_CORR_IDS = new Set<string>([
  'USREC', 'BTC_HALVING', 'FOMC_MEETINGS', 'FED_CHAIRS', 'MONTHLY_MARKERS', 'YEARLY_MARKERS', ...Object.keys(EVENT_INDICATOR_CATEGORY),
]);

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

// Difference of two series (A − B), aligned on the UNION of their dates with
// last-observation-carried-forward. Using the union (not the intersection) means
// a spread works even when the two series live on different date grids — e.g. an
// annual macro series (dated Jan-1) minus a daily index (no Jan-1 point). Each
// side's most recent value is held until it next prints; a date is only emitted
// once BOTH series have started, so the spread has no leading gap.
function diffSeries(a: HistoricalPoint[], b: HistoricalPoint[]): HistoricalPoint[] {
  if (!a.length || !b.length) return [];
  const A = [...a].sort((p, q) => p.date.localeCompare(q.date));
  const B = [...b].sort((p, q) => p.date.localeCompare(q.date));
  const dates = Array.from(new Set([...A.map(d => d.date), ...B.map(d => d.date)])).sort();
  let i = 0, j = 0;
  let lastA: number | null = null, lastB: number | null = null;
  const out: HistoricalPoint[] = [];
  for (const date of dates) {
    while (i < A.length && A[i].date <= date) { lastA = A[i].close; i++; }
    while (j < B.length && B[j].date <= date) { lastB = B[j].close; j++; }
    if (lastA == null || lastB == null) continue;
    if (isFinite(lastA) && isFinite(lastB)) out.push({ date, close: lastA - lastB });
  }
  return out;
}

// Window a series to [start, end] but ALWAYS keep a line for lagging series:
// if the series has no point at `start`, carry its last value before `start`
// forward as a synthetic point at `start`. This is what lets an annual, 1-2y
// lagging macro series (e.g. World Bank GDP growth, last point 2024) still draw
// a flat line on a short window (1D, 3M) using its most recent known value,
// instead of disappearing entirely.
function withCarryIn(raw: HistoricalPoint[], start: string, end: string | null): HistoricalPoint[] {
  const inside = raw.filter(d => d.date >= start && (!end || d.date <= end));
  if (inside.length && inside[0].date === start) return inside;
  let carry: HistoricalPoint | null = null;
  for (const d of raw) { if (d.date < start) carry = d; else break; }
  return carry ? [{ date: start, close: carry.close }, ...inside] : inside;
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
  const { data: gistData } = useGistData();
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeAssetClass, setActiveAssetClass] = useState<string | null>(null);
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
  // Align every asset to a common start (the shortest-history asset's start) for an
  // apples-to-apples comparison. Turn OFF to let each asset span its own full history
  // from the timeframe start (shows more data + each asset's full dividend history).
  const [alignStart, setAlignStart] = useState(true);
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
    const config = COMPARABLE_ASSETS.find(a => a.symbol === symbol);
    const displayName = nameCacheRef[symbol] ?? config?.name ?? symbol;

    try {
      let data: HistoricalPoint[] = [];
      let dividends: { date: string; amount: number }[] = [];

      if (symbol.startsWith('WBX:')) {
        // Macro World EXTRA series — "WBX:<ISO3>:<key>" (policyRate|gdpForecast|debt|buffett).
        const [, ctry, key] = symbol.split(':');
        const res = await fetch(`/api/macroworld-extra?mode=country&country=${encodeURIComponent(ctry)}`);
        if (!res.ok) return null;
        const json = await res.json();
        const arr = json?.[key];
        if (!Array.isArray(arr) || !arr.length) return null;
        data = arr as HistoricalPoint[];
        if (!nameCacheRef[symbol]) {
          const labels: Record<string, string> = { policyRate: 'Interest Rate', gdpForecast: 'Real GDP Growth + Forecast', debt: 'Govt Debt (IMF)', buffett: 'Buffett Indicator' };
          nameCacheRef[symbol] = `${ctry} · ${labels[key] ?? key}`;
        }
      } else if (symbol.startsWith('WB:')) {
        // Macro World — "WB:<ISO3>:<indicatorCode>" (e.g. WB:USA:NY.GDP.MKTP.KD.ZG).
        // Fetch the whole country payload and pull out the one annual indicator series;
        // displayAssets trims it to the timeframe/custom-range window like any other asset.
        const [, ctry, code] = symbol.split(':');
        const res = await fetch(`/api/worldbank?mode=country&country=${encodeURIComponent(ctry)}`);
        if (!res.ok) return null;
        const json = await res.json();
        const ind = json?.indicators?.[code];
        if (!ind || !Array.isArray(ind.series) || !ind.series.length) return null;
        data = ind.series as HistoricalPoint[];
        // Cache a readable name so the chip/legend don't show the raw "WB:…" symbol.
        if (!nameCacheRef[symbol]) {
          const indName = IMF_INDICATOR_BY_CODE.get(code)?.name ?? code;
          nameCacheRef[symbol] = `${ctry} · ${indName}`;
        }
      } else if (config?.type === 'crypto') {
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

      // Total-return series only when the asset actually pays dividends. Built by reinvesting
      // the actual dividend cash flows into the (split-adjusted) price series — NOT Yahoo's
      // adjClose, which for some ETFs (e.g. MAGS) is returned unadjusted so it would silently
      // hide the dividends. This keeps the TR line, the IRR and the dividend bars all consistent
      // with the same dividend list. Raw indexes/macro have no distributions → no TR line.
      const totalReturnData: HistoricalPoint[] | undefined =
        dividends.length > 0 ? buildTotalReturnSeries(data, dividends) : undefined;

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
        type: (symbol.startsWith('WB:') || symbol.startsWith('WBX:')) ? 'index' : (config?.type ?? 'stock'),
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
    nameCacheRef[s] ?? COMPARABLE_ASSETS.find(x => x.symbol === s)?.name ?? s;

  const addSymbol = (symbol: string, name?: string) => {
    if (selectedSymbols.includes(symbol) || selectedSymbols.length >= 8) return;
    if (name) nameCacheRef[symbol] = name;
    setSelectedSymbols(prev => [...prev, symbol]);
    setSearch('');
    setRemoteHits([]);
  };

  const removeSymbol = (symbol: string) => setSelectedSymbols(prev => prev.filter(s => s !== symbol));
  const loadSubcat = (symbols: string[]) => {
    setSelectedSymbols(symbols.slice(0, 8));
  };

  // "Stocks" asset class — built from the user's note categories (watchlists),
  // since stocks have no fixed config list. Each category that tags at least one
  // stock note becomes a subcategory that bulk-adds those tickers.
  const assetClasses = useMemo<CompareClass[]>(() => {
    const notes = gistData.notes ?? {};
    const byCat = new Map<string, string[]>();
    for (const [chartId, list] of Object.entries(notes)) {
      if (!chartId.startsWith('stock:')) continue;
      const sym = chartId.slice('stock:'.length);
      for (const n of list) {
        if (!n.category) continue;
        const arr = byCat.get(n.category) ?? [];
        if (!arr.includes(sym)) arr.push(sym);
        byCat.set(n.category, arr);
      }
    }
    const subcats = [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, symbols]) => ({ label, symbols }));
    const stocksClass: CompareClass[] = subcats.length
      ? [{ key: 'Stocks', label: 'Stocks', subcats }]
      : [];
    const macroWorldClass: CompareClass[] = MACRO_WORLD_ENABLED ? [imfCompareClass()] : [];
    return [...COMPARE_ASSET_CLASSES, ...stocksClass, ...macroWorldClass];
  }, [gistData]);

  // Local config search (exclude already selected)
  const localHits = COMPARABLE_ASSETS.filter(a =>
    !selectedSymbols.includes(a.symbol) &&
    (a.name.toLowerCase().includes(search.toLowerCase()) ||
     a.symbol.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 8);

  // Remote hits that aren't already in local config or selected
  const localSymbols = new Set(COMPARABLE_ASSETS.map(a => a.symbol));
  const extraRemoteHits = remoteHits
    .filter(h => !selectedSymbols.includes(h.symbol) && !localSymbols.has(h.symbol))
    .slice(0, 8);

  // For ALL timeframes: trim every asset to the SAME common start date and re-normalise
  // each to 0% there, so % Change comparisons are apples-to-apples. The common start is the
  // latest first-available date across the compared assets (the shortest-history asset sets
  // the baseline), clamped to the timeframe window [tfStart, tfEnd].
  const displayAssets = useMemo(() => {
    if (!assets.length) return assets;
    try {
      const tfStart = customRange ? customRange.from : getTimeframeStart(timeframe);
      const tfEnd = customRange ? customRange.to : null;

      // First pass: find each asset's first date that falls within the TF window.
      // Recession assets and event overlays (BTC_HALVING, FOMC_MEETINGS, EVENTS_*) carry full
      // history and are excluded from commonStart so they don't constrain other assets.
      const EVENT_OVERLAY = new Set([
        ...RECESSION_SERIES, 'BTC_HALVING', 'FOMC_MEETINGS', 'FED_CHAIRS', 'MONTHLY_MARKERS', 'YEARLY_MARKERS',
        ...Object.keys(EVENT_INDICATOR_CATEGORY),
      ]);
      // Align every (non-overlay) asset to a COMMON start = the LATEST first-available
      // date across them (the asset with the LEAST history sets the baseline). Every series
      // is then trimmed to that date and re-normalised to 0% there, so a % Change comparison
      // is apples-to-apples: all lines start from the same point in time. Two full-history
      // assets both resolve to tfStart (no change); a recently-listed asset pulls the common
      // start forward so nobody is compared from a date it has no data for.
      // Event/recession overlays carry full history and are excluded so they never move it.
      const firstInWindow = (a: (typeof assets)[number]): string | null => {
        const src = a.rawData ?? a.data;
        for (const d of src) {
          if (d.date >= tfStart && (!tfEnd || d.date <= tfEnd)) return d.date;
        }
        return null;
      };
      const commonStart = alignStart
        ? assets
            .filter(a => !EVENT_OVERLAY.has(a.symbol))
            .map(firstInWindow)
            .filter((d): d is string => d != null)
            .reduce((m, d) => (d > m ? d : m), tfStart)
        : tfStart; // each asset spans its own history from the timeframe start

      return assets.map(a => {
        const raw = a.rawData ?? a.data;
        const isOverlay = EVENT_OVERLAY.has(a.symbol);
        // Macro series and Macro World (World Bank) are annual and lag by 1-2y, so on a
        // short window their last real point can fall BEFORE the window start. Carry that
        // last value forward into the window so the line always shows (flat) rather than
        // vanishing — this is the "show the last available point" behaviour.
        const laggingMacro = (a.type === 'macro' || a.symbol.startsWith('WB:') || a.symbol.startsWith('WBX:')) && !isOverlay;
        // rawFiltered: full history for overlay assets (recession bands, FOMC lines)
        // so CompareChart can find all events even on short timeframes.
        let rawFiltered = isOverlay ? raw
          : laggingMacro ? withCarryIn(raw, commonStart, tfEnd)
          : raw.filter(d => d.date >= commonStart);
        if (tfEnd && !isOverlay && !laggingMacro) rawFiltered = rawFiltered.filter(d => d.date <= tfEnd);
        // displayFiltered: always trimmed to the visible range so the Stack
        // panel and all display charts align with the main chart timeframe.
        let displayFiltered = laggingMacro
          ? withCarryIn(raw, commonStart, tfEnd)
          : raw.filter(d => d.date >= commonStart);
        if (tfEnd && !laggingMacro) displayFiltered = displayFiltered.filter(d => d.date <= tfEnd);
        const divsFiltered = (a.dividends ?? []).filter(d =>
          d.date >= commonStart && (!tfEnd || d.date <= tfEnd)
        );
        // Total-return line ONLY when a dividend actually falls inside the displayed
        // window. With no payment in the window the reinvestment factor is constant,
        // so the TR series is the price series — drawing it would put an identical
        // line under the price line while the legend advertised a "(Total Return)"
        // series that is nowhere to be seen. Now the line, the legend entry and the
        // IRR appear together, or not at all.
        let trFiltered = divsFiltered.length > 0
          ? a.totalReturnData?.filter(d => d.date >= commonStart)
          : undefined;
        if (tfEnd && trFiltered) trFiltered = trFiltered.filter(d => d.date <= tfEnd);
        const isRec = RECESSION_SET.has(a.symbol);
        // Macro series: only extend to today (so the line reaches "now" visually).
        // Removed dedupStepSeries: it dropped any data point whose value matched
        // the previous one, which thinned the series during flat-policy periods
        // and hid intra-period jitter on daily series (NY Fed EFFR, T-yields).
        // The chart already uses type="stepAfter" for macro, which renders the
        // step look from the full data.
        // Lagging macro/World Bank lines also reach "now": carry the last value to today
        // (unless a custom end date is set, which must be respected exactly).
        const displayRaw = laggingMacro
          ? (tfEnd ? displayFiltered : extendToToday(displayFiltered))
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
        // IRR from the ACTUAL dividend cash flows over the aligned window (dividend-paying
        // assets only). computeAssetIRR handles an empty in-window dividend list = the price
        // IRR, so a dividend payer with no distribution inside the window shows its price return
        // rather than falling back to a stale full-history value.
        // IRR over the ALIGNED window, and only when a dividend was actually paid
        // inside it. Two rules matter here:
        //  - never fall back to the full-fetch-window IRR: with the chart aligned to a
        //    younger asset's start, that value covers a different period, which is how
        //    "CAGR +3.5%" (5 months) ended up beside "IRR +10.8%" (12 months);
        //  - no dividend in the window ⇒ no IRR row, rather than an annualised price
        //    return sitting under the CAGR pretending to be a dividend figure.
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
          irr: irrTrim != null ? irrTrim * 100 : undefined,
          divsOutsideWindow: (a.dividends?.length ?? 0) > 0 && divsFiltered.length === 0,
        };
      });
    } catch (e) {
      console.error('[CompareSection] displayAssets error:', e);
      return assets;
    }
  }, [assets, timeframe, customRange, normalized, alignStart]);

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

  // Why the chart may cover LESS than the selected timeframe. Two distinct causes,
  // and the notice names the one that applies — otherwise a card reading
  // "Return (10Y)" over a five-month window looks like a broken number.
  const windowNote = useMemo<string | null>(() => {
    if (customRange || timeframe === 'MAX' || assets.length === 0) return null;
    const OVERLAY = new Set([
      ...RECESSION_SERIES, 'BTC_HALVING', 'FOMC_MEETINGS', 'FED_CHAIRS', 'MONTHLY_MARKERS', 'YEARLY_MARKERS',
      ...Object.keys(EVENT_INDICATOR_CATEGORY),
    ]);
    const tfStart = getTimeframeStart(timeframe);
    const firsts = assets
      .filter(a => !OVERLAY.has(a.symbol))
      .map(a => {
        const src = a.rawData ?? a.data;
        const first = src.find(d => d.date >= tfStart)?.date ?? src[0]?.date;
        return first ? { name: a.name, first } : null;
      })
      .filter((x): x is { name: string; first: string } => x != null);
    if (firsts.length === 0) return null;

    // Aligned start uses the LATEST first date across assets; without it each asset
    // simply begins where its own history begins.
    const limiter = firsts.reduce((m, x) => (x.first > m.first ? x : m), firsts[0]);
    const gapDays = (new Date(limiter.first).getTime() - new Date(tfStart).getTime()) / 86_400_000;
    if (gapDays <= 30) return null;
    const label = new Date(limiter.first + 'T12:00:00Z')
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return alignStart && firsts.length > 1
      ? `Aligned start: comparison runs from ${label} — ${limiter.name} has no data before then`
      : `Data available from ${label}`;
  }, [assets, timeframe, customRange, alignStart]);

  const safeStackIdx = Math.min(stackAssetIdx, Math.max(0, displayAssets.length - 1));
  // Stack isolates the chosen asset in its own chart below. Tools draw on the
  // chosen asset WHEREVER it is: on the main overlay when not stacked, on the
  // sub-chart when it is.
  const mainChartAssets = (showStack && displayAssets.length > 1
    ? displayAssets.filter((_, i) => i !== safeStackIdx)
    : displayAssets
  ).concat(spreadAssets);
  const toolAsset = displayAssets[safeStackIdx];

  const correl = useMemo(() => {
    try {
      // USREC is included with its raw 0/1 values (point-biserial correlation).
      // BTC_HALVING, FOMC_MEETINGS and EVENTS_* are excluded here and added below as 0/1
      // dummies (their raw series are event markers, not continuous values).
      const DUMMY_SET = new Set(['BTC_HALVING', 'FOMC_MEETINGS', 'FED_CHAIRS', 'MONTHLY_MARKERS', 'YEARLY_MARKERS', ...Object.keys(EVENT_INDICATOR_CATEGORY)]);
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

      const fedChairsAsset = displayAssets.find(a => a.symbol === 'FED_CHAIRS');
      if (fedChairsAsset && refMin && refMax) {
        // FED_CHAIRS: 1 in every month with a chair nomination or first meeting.
        const chairMonths = new Set(
          FED_CHAIR_CHANGES.flatMap(c => c.firstMeeting ? [c.date.slice(0, 7), c.firstMeeting.slice(0, 7)] : [c.date.slice(0, 7)])
        );
        const chairDummy = monthlyDummy(refMin, refMax, chairMonths);
        if (chairDummy.length > 1) series.push({ symbol: 'FED_CHAIRS', data: chairDummy });
      }

      const monthlyMarkersAssetCorr = displayAssets.find(a => a.symbol === 'MONTHLY_MARKERS');
      if (monthlyMarkersAssetCorr) {
        // MONTHLY_MARKERS: every month is value=1 — no variance, correlation undefined. Skip.
        // Do not push to series.
      }

      const yearlyMarkersAssetCorr = displayAssets.find(a => a.symbol === 'YEARLY_MARKERS');
      if (yearlyMarkersAssetCorr && refMin && refMax) {
        // YEARLY_MARKERS: 1 in January of each year, 0 otherwise.
        const janMonths = new Set<string>();
        const y0 = parseInt(refMin.slice(0, 4), 10);
        const y1 = parseInt(refMax.slice(0, 4), 10);
        for (let y = y0; y <= y1; y++) janMonths.add(`${y}-01`);
        const yearlyDummy = monthlyDummy(refMin, refMax, janMonths);
        if (yearlyDummy.length > 1) series.push({ symbol: 'YEARLY_MARKERS', data: yearlyDummy });
      }

      // EVENTS_* per-category: 1 in every month containing at least one event of that category.
      for (const [catId, cat] of Object.entries(EVENT_INDICATOR_CATEGORY)) {
        const catAsset = displayAssets.find(a => a.symbol === catId);
        if (catAsset && refMin && refMax) {
          const catMonthSet = new Set(MARKET_EVENTS.filter(e => e.category === cat).map(e => e.date.slice(0, 7)));
          const catDummy = monthlyDummy(refMin, refMax, catMonthSet);
          if (catDummy.length > 1) series.push({ symbol: catId, data: catDummy });
        }
      }

      const base = correlationMatrix(series);

      // ── Dummy / event indicators: correlate against RETURNS, not levels ──────
      // Spearman on price LEVELS is ~0 for sparse dummies — events at every price
      // level, no monotone rank link. We recompute Pearson with the non-dummy side
      // converted to month-over-month returns (point-biserial correlation).
      const { labels, alignedData } = base;
      let finalMatrix = base.matrix;
      if (alignedData.length > 2 && labels.some(l => INDICATOR_CORR_IDS.has(l))) {
        const nL = labels.length;
        const isDummy = labels.map(l => INDICATOR_CORR_IDS.has(l));
        const col = (j: number) => alignedData.map(r => r.values[j]);
        const toReturns = (v: number[]) =>
          v.map((x, i) => (i === 0 || v[i - 1] === 0 ? NaN : x / v[i - 1] - 1));
        finalMatrix = base.matrix.map(r => r.slice());
        for (let i = 0; i < nL; i++) {
          for (let j = i + 1; j < nL; j++) {
            if (!isDummy[i] && !isDummy[j]) continue;
            const ai = isDummy[i] ? col(i) : toReturns(col(i));
            const aj = isDummy[j] ? col(j) : toReturns(col(j));
            const xs: number[] = [], ys: number[] = [];
            for (let p = 0; p < ai.length; p++) {
              if (isFinite(ai[p]) && isFinite(aj[p])) { xs.push(ai[p]); ys.push(aj[p]); }
            }
            const c = pearson(xs, ys);
            finalMatrix[i][j] = c;
            finalMatrix[j][i] = c;
          }
        }
      }

      return { ...base, matrix: finalMatrix };
    } catch (e) {
      console.error('[CompareSection] correlationMatrix error:', e);
      return {
        labels: [], matrix: [] as (number | null)[][], sampleCount: 0,
        alignedData: [] as CorrAlignedRow[],
      };
    }
  }, [allAssets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-2 w-full sm:w-auto">
          {/* Asset class buttons */}
          <div className="flex gap-1.5 flex-wrap">
            {assetClasses.map(ac => (
              <button key={ac.key}
                onClick={() => setActiveAssetClass(prev => prev === ac.key ? null : ac.key)}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-full border transition-all',
                  activeAssetClass === ac.key
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-border text-gray-400 hover:text-gray-100 hover:border-border-light'
                )}>
                {ac.label}
              </button>
            ))}
          </div>
          {/* Subcategory pills — shown when an asset class is active */}
          {activeAssetClass && (() => {
            const ac = assetClasses.find(a => a.key === activeAssetClass);
            if (!ac || ac.subcats.length === 0) return null;
            return (
              <div className="flex gap-1.5 flex-wrap pl-1">
                {ac.subcats.map(sc => (
                  <button key={sc.label}
                    onClick={() => loadSubcat(sc.symbols)}
                    className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full border border-accent/40 text-accent/80 hover:bg-accent/15 hover:text-accent hover:border-accent transition-all whitespace-nowrap">
                    {sc.label}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex gap-1">
            <button onClick={() => setNormalized(n => !n)}
              className={clsx('px-3 py-1 text-xs font-medium rounded-full transition-all border',
                normalized ? 'border-accent text-accent bg-accent/10' : 'border-border text-gray-400 hover:text-gray-200')}>
              {normalized ? '% Change' : 'Absolute price'}
            </button>
            <button onClick={() => setAlignStart(s => !s)}
              title="Aligned: every asset starts from the same date (the shortest-history one) for a fair comparison. Full history: each asset spans its own data from the timeframe start — more data and each asset's full dividend history."
              className={clsx('px-3 py-1 text-xs font-medium rounded-full transition-all border',
                alignStart ? 'border-accent text-accent bg-accent/10' : 'border-border text-gray-400 hover:text-gray-200')}>
              {alignStart ? 'Aligned start' : 'Full history'}
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
              title="Stack an asset in its own chart below the main overlay"
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
          const conf = COMPARABLE_ASSETS.find(a => a.symbol === s);
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
              <div className="absolute top-full left-0 mt-1 w-80 max-w-[85vw] bg-bg-card border border-border rounded-lg shadow-xl z-20 max-h-64 overflow-y-auto">
                {localHits.length > 0 && (
                  <>
                    <p className="px-3 pt-2 pb-1 text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Preset</p>
                    {localHits.map(a => (
                      <button key={a.symbol} onClick={() => addSymbol(a.symbol, a.name)}
                        className="w-full flex items-start justify-between gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover text-left">
                        {/* Full name, wraps instead of truncating, so the indicator stays readable */}
                        <span className="text-gray-100 leading-tight min-w-0 flex-1">{a.name}</span>
                        {/* Source tag: which dashboard section the asset comes from */}
                        <span className={clsx('shrink-0 text-[10px] mt-0.5 font-medium', GROUP_TAG_COLOR[a.group] ?? 'text-gray-500')}>
                          {a.group}
                        </span>
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
          {windowNote && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5 mb-3">
              ⚠ {windowNote}
            </p>
          )}
          <div className="rounded-xl border border-border bg-bg-card p-4">
            <CompareChart assets={mainChartAssets} height={360} logScale={!normalized && logScale} percentMode={normalized}
              overlay={toolAsset ? { symbol: toolAsset.symbol, tools: stackTools } : undefined}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          </div>

          {showStack && displayAssets.length > 0 && (
            <StackAnalysisPanel
              assets={displayAssets}
              assetIdx={safeStackIdx}
              activeTools={stackTools}
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
                        <p className="mt-1 text-[10px] text-gray-600 leading-snug">A − B: how many percentage points A has out/under-performed B since the start</p>
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
                    {/* IRR (true cash-flow formula) — shown under the CAGR whenever the
                        asset actually paid a dividend inside the displayed window. */}
                    {a.irr != null && (
                      <div className="mt-1">
                        <p className="text-[10px] text-gray-500">IRR (w/ div.)</p>
                        <p className={clsx('text-sm font-semibold', colorForPercent(a.irr))}>{formatPercent(a.irr)}</p>
                      </div>
                    )}
                    {/* Pays dividends, but the window on screen contains none — say so,
                        so a missing IRR / total-return line never reads as a glitch. */}
                    {a.irr == null && a.divsOutsideWindow && (
                      <div className="mt-1">
                        <p className="text-[10px] text-gray-500">IRR (w/ div.)</p>
                        <p className="text-[10px] text-gray-600 leading-snug">
                          no ex-date in this window{alignStart ? ' — turn off Aligned start' : ''}
                        </p>
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
              hasIndicators={correl.labels.some(l => INDICATOR_CORR_IDS.has(l))}
            />
          )}
        </ChartErrorBoundary>
      ) : (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          Select assets to compare
        </div>
      )}

      {displayAssets.length >= 2 && !loading && (
        <div className="flex justify-end">
          <GeminiCommentButton
            key={selectedSymbols.join(',')}
            mode="compare"
            assets={allAssets
              .filter(a => !a.isSpread && !RECESSION_SET.has(a.symbol))
              .map(a => ({ name: a.name, symbol: a.symbol, totalReturn: a.totalReturn ?? undefined, cagr: a.cagr ?? undefined }))}
            correlations={(() => {
              const { labels, matrix } = correl;
              const pairs: { a: string; b: string; r: number }[] = [];
              for (let i = 0; i < labels.length; i++) {
                for (let j = i + 1; j < labels.length; j++) {
                  const r = matrix[i]?.[j];
                  if (r != null && isFinite(r)) {
                    pairs.push({
                      a: allAssets.find(x => x.symbol === labels[i])?.name ?? labels[i],
                      b: allAssets.find(x => x.symbol === labels[j])?.name ?? labels[j],
                      r,
                    });
                  }
                }
              }
              return pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 6);
            })()}
            timeframe={customRange ? 'Custom' : timeframe}
            label="Compare Analysis"
          />
        </div>
      )}

      {displayAssets.length > 0 && (
        <ToolsControl
          assets={displayAssets}
          assetIdx={safeStackIdx}
          onAssetSelect={setStackAssetIdx}
          tools={stackTools}
          onToolsChange={setStackTools}
          normalized={normalized}
        />
      )}

      {selectedSymbols.length > 0 && (
        <ChartNotes
          chartId={`compare:${[...selectedSymbols].sort().join(',')}`}
          defaultCategory="Compare"
          captureView={() => ({
            tools: { ...stackTools } as Record<string, boolean>,
            timeframe, customRange, symbols: selectedSymbols,
            // Tiny normalized thumbnail per series so My Strategy can draw this chart inline.
            preview: assets.slice(0, 8).map(a => {
              const norm = pctChangeFromStart(a.rawData ?? a.data).map(p => p.close).filter(v => isFinite(v));
              const max = 100;
              const pts = norm.length <= max
                ? norm
                : Array.from({ length: max }, (_, i) => norm[Math.round(i * (norm.length - 1) / (max - 1))]);
              return { label: a.name || a.symbol, color: a.color, pts };
            }).filter(p => p.pts.length > 1),
            // Correlation matrix of the compared assets (rendered in My Strategy).
            correlation: correl.labels.length ? { labels: correl.labels.slice(), matrix: correl.matrix.map(r => r.slice()) } : undefined,
            // Full Compare setup so Restore brings back exactly what was saved.
            spreads: spreads.map(s => ({ ...s })),
            normalized, alignStart, logScale, showStack, stackAssetIdx,
          })}
          onRestoreView={v => {
            if (v.tools) setStackTools({ ...DEFAULT_TOOLS, ...(v.tools as Partial<ActiveTools>) });
            if (v.timeframe) setTimeframe(v.timeframe as Timeframe);
            setCustomRange(v.customRange ?? null);
            if (v.symbols && v.symbols.length > 0) setSelectedSymbols(v.symbols.slice(0, 8));
            if (typeof v.normalized === 'boolean') setNormalized(v.normalized);
            if (typeof v.alignStart === 'boolean') setAlignStart(v.alignStart);
            if (typeof v.logScale === 'boolean') setLogScale(v.logScale);
            if (typeof v.showStack === 'boolean') setShowStack(v.showStack);
            if (typeof v.stackAssetIdx === 'number') setStackAssetIdx(v.stackAssetIdx);
            // Restore spreads last, once symbols are set (the cleanup effect keeps only
            // spreads whose underlying symbols are selected).
            if (Array.isArray(v.spreads)) setSpreads(v.spreads.map(s => ({ a: s.a, b: s.b })));
          }}
        />
      )}
    </div>
  );
}

// ── Tools control ──────────────────────────────────────────────────────────
// The standard ChartTools panel (same as every other asset), but with an asset
// selector on top so you choose WHICH compared asset the tool applies to. The
// tool is drawn on that asset's isolated chart below (Stack auto-opens for it).
function ToolsControl({ assets, assetIdx, onAssetSelect, tools, onToolsChange, normalized }: {
  assets: CompareAsset[];
  assetIdx: number;
  onAssetSelect: (i: number) => void;
  tools: ActiveTools;
  onToolsChange: (t: ActiveTools) => void;
  normalized: boolean;
}) {
  const asset = assets[assetIdx];
  const data = normalized ? (asset?.data ?? []) : (asset?.rawData ?? asset?.data ?? []);
  return (
    <div className="rounded-xl border border-border bg-bg-card p-3 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mr-0.5">Tools · apply to</span>
        {assets.map((a, i) => (
          <button
            key={a.symbol}
            onClick={() => onAssetSelect(i)}
            className={clsx('flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-all border',
              i === assetIdx ? 'text-white border-transparent' : 'border-border text-gray-500 hover:text-gray-300')}
            style={i === assetIdx ? { backgroundColor: a.color + '33', borderColor: a.color + '99' } : {}}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
            {a.name.length > 18 ? a.symbol : a.name}
          </button>
        ))}
      </div>
      <ChartTools data={data} activeTools={tools} onChange={onToolsChange} symbol={asset?.symbol} />
      <p className="text-[10px] text-gray-600 leading-snug">Tools are drawn on <b className="text-gray-400">{asset?.name ?? 'the chosen asset'}</b> on the chart above — or on the chart below if you put it in <b className="text-gray-400">Stack</b>.</p>
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
  labels, matrix, sampleCount, alignedData, names, hasIndicators,
}: {
  labels: string[];
  matrix: (number | null)[][];
  sampleCount: number;
  alignedData: CorrAlignedRow[];
  names: Record<string, string>;
  hasIndicators?: boolean;
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
          {hasIndicators && (
            <p className="text-[10px] text-gray-500 mt-1 max-w-xl leading-snug">
              Event rows (halvings, FOMC, …) are a <strong>0/1 series</strong> — 1 in months with the
              event — correlated with each asset&rsquo;s monthly returns (point-biserial r).
              Sparse events are noisy: a dash means no events in the current window → try <strong>MAX</strong>.
            </p>
          )}
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

                  // Every cell shows the same thing: the correlation r. For
                  // event×asset pairs that's the point-biserial r (halving/FOMC/…
                  // as a 0/1 series correlated with the asset's monthly returns),
                  // computed in the matrix above — identical treatment to any pair.
                  const { bg, text } = v != null && isFinite(v) ? corrStrength(v) : { bg: '#1f2233', text: '#6b7280' };
                  return (
                    <td key={col} className="text-center font-mono text-[11px] tabular-nums px-2 py-1.5 rounded"
                      style={{ backgroundColor: bg, color: text, minWidth: 60 }}>
                      {i === j ? '1.00' : (v == null || !isFinite(v) ? '—' : v.toFixed(2))}
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
