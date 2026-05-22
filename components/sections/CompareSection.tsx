'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Component, ReactNode } from 'react';
import { ALL_COMPARABLE_ASSETS } from '@/lib/config';
import { CompareAsset, HistoricalPoint, Timeframe } from '@/lib/types';
import {
  pctChangeFromStart, calculateCAGR, formatPercent, colorForPercent,
  CHART_COLORS, getTimeframeStart, buildTotalReturnSeries, computeAssetIRR,
  correlationMatrix, dedupStepSeries, extendToToday, CorrAlignedRow,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { CompareChart } from '@/components/charts/CompareChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { X, Search, ChevronDown, ChevronUp, Layers } from 'lucide-react';
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

  const fetchAsset = useCallback(async (symbol: string, color: string, tf: Timeframe): Promise<CompareAsset | null> => {
    const config = ALL_COMPARABLE_ASSETS.find(a => a.symbol === symbol);
    const displayName = nameCacheRef[symbol] ?? config?.name ?? symbol;

    try {
      let data: HistoricalPoint[] = [];
      let adjData: HistoricalPoint[] = [];
      let dividends: { date: string; amount: number }[] = [];

      if (config?.type === 'crypto') {
        const daysMap: Record<string, number> = { '1D': 3, '1W': 7, '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650, 'MAX': 4000 };
        const days = daysMap[tf] ?? 365;
        const coinId = symbol.replace('-USD', '').toLowerCase();
        const coinMap: Record<string, string> = {
          btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
          xrp: 'ripple', ada: 'cardano', avax: 'avalanche-2', link: 'chainlink',
        };
        const id = coinMap[coinId] ?? coinId;
        const cgRes = await fetch(`/api/crypto?mode=historical&id=${id}&days=${days}`);
        if (cgRes.ok) {
          const json = await cgRes.json();
          if (Array.isArray(json) && json.length > 0) data = json as HistoricalPoint[];
        }
        if (!data.length) {
          const yhRes = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`);
          if (yhRes.ok) { const j = await yhRes.json(); if (Array.isArray(j) && j.length) data = j; }
        }
        if (!data.length) return null;
      } else if (config?.type === 'macro') {
        const from = getTimeframeStart(tf);
        const res = await fetch(`/api/macro?mode=history&id=${encodeURIComponent(symbol)}&from=${from}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || !json.length) return null;
        data = json as HistoricalPoint[];
      } else if (config?.type === 'currency') {
        // Currency pairs: use /api/historical (Yahoo USDEUR=X etc.)
        const res = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || !json.length) return null;
        data = json as HistoricalPoint[];
      } else {
        // Stocks/indexes/ETFs/sectors → use stock API for adjPrices + dividends
        const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`);
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
          const fb = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`);
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
    // When a custom date range is active, always fetch MAX so the data covers it.
    const fetchTF: Timeframe = customRange ? 'MAX' : timeframe;
    const results: (CompareAsset | null)[] = [];
    for (let i = 0; i < selectedSymbols.length; i++) {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      let asset = await fetchAsset(selectedSymbols[i], color, fetchTF);
      if (!asset) {
        await new Promise(r => setTimeout(r, 1500));
        asset = await fetchAsset(selectedSymbols[i], color, fetchTF);
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
      // Consider BOTH prices and totalReturnData so both lines share the same baseline.
      const firstDates = assets.map(a => {
        const raw = a.rawData ?? a.data;
        const rawFirst = raw.find(d => d.date >= tfStart)?.date ?? tfStart;
        const tr = a.totalReturnData;
        if (!tr || tr.length === 0) return rawFirst;
        const trFirst = tr.find(d => d.date >= tfStart)?.date ?? tfStart;
        return rawFirst > trFirst ? rawFirst : trFirst;
      });
      const commonStart = firstDates.reduce((a, b) => (a > b ? a : b));

      return assets.map(a => {
        const raw = a.rawData ?? a.data;
        let rawFiltered = raw.filter(d => d.date >= commonStart);
        if (tfEnd) rawFiltered = rawFiltered.filter(d => d.date <= tfEnd);
        let trFiltered = a.totalReturnData?.filter(d => d.date >= commonStart);
        if (tfEnd && trFiltered) trFiltered = trFiltered.filter(d => d.date <= tfEnd);
        const divsFiltered = (a.dividends ?? []).filter(d =>
          d.date >= commonStart && (!tfEnd || d.date <= tfEnd)
        );
        // For macro series:
        //   1. dedup consecutive identical values → chart shows when value
        //      actually changed, not 100s of "no change" daily duplicates.
        //   2. extendToToday → line extends horizontally to today, clearly
        //      showing "value is still current" instead of ending mid-axis
        //      and looking like the value collapsed.
        const displayRaw = a.type === 'macro'
          ? extendToToday(dedupStepSeries(rawFiltered))
          : rawFiltered;
        const displayData = normalized ? pctChangeFromStart(displayRaw) : displayRaw;
        const displayTrData = trFiltered
          ? (normalized ? pctChangeFromStart(trFiltered) : trFiltered)
          : undefined;

        // Recompute PRICE-ONLY Return/CAGR on the trimmed (commonStart→today)
        // window so card numbers reflect exactly the same period the chart
        // shows. IRR already covers the dividend-inclusive metric separately.
        const cagrPrice = calculateCAGR(rawFiltered, timeframe);
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

  const safeStackIdx = Math.min(stackAssetIdx, Math.max(0, displayAssets.length - 1));
  const mainChartAssets = showStack && displayAssets.length > 1
    ? displayAssets.filter((_, i) => i !== safeStackIdx)
    : displayAssets;

  const correl = useMemo(() => {
    try {
      const series = displayAssets
        .filter(a => (a.rawData ?? a.data).length > 1)
        .map(a => ({ symbol: a.symbol, data: a.rawData ?? a.data }));
      return correlationMatrix(series);
    } catch (e) {
      console.error('[CompareSection] correlationMatrix error:', e);
      return { labels: [], matrix: [] as (number | null)[][], sampleCount: 0, alignedData: [] as CorrAlignedRow[] };
    }
  }, [displayAssets]);

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
            <CompareChart assets={mainChartAssets} height={360} logScale={!normalized && logScale} percentMode={normalized} />
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
            {displayAssets.map((a, i) => (
              <div key={a.symbol} className="rounded-xl border p-3 bg-bg-card"
                style={{ borderColor: CHART_COLORS[i % CHART_COLORS.length] + '66' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <p className="text-sm font-semibold text-gray-100 truncate">{a.name}</p>
                  {a.totalReturnData && (
                    <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">DIV</span>
                  )}
                </div>
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
              names={Object.fromEntries(assets.map(a => [a.symbol, a.name]))}
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
