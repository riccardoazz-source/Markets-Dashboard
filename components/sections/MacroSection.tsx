'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MACRO_INDICATORS, MacroUnit } from '@/lib/config';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import { getTimeframeStart, calculateCAGR, formatPercent, dedupStepSeries, extendToToday } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { HalvingChart } from '@/components/charts/HalvingChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { loadSourcesConfig, SourcesConfig } from '@/lib/userSources';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X } from 'lucide-react';

const BUILTIN_CATS = ['All', 'Rates', 'Inflation', 'Growth', 'Employment', 'Real Estate', 'Money', 'Commodities', 'Sentiment', 'Crypto', 'Debt', 'Market Value'];
const TF_OPTIONS: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface MacroLatest {
  id: string;
  latest: { date: string; value: number } | null;
  prev:   { date: string; value: number } | null;
}

interface UnifiedIndicator {
  id: string;
  name: string;
  category: string;
  unit: MacroUnit;
  isBuiltin: boolean;
  fetchUrl: string | null;  // null → /api/macro (full FRED fallback chain); string → /api/scrape
}

function formatMacroValue(value: number, unit: MacroUnit): string {
  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === 'B$') {
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}T`;
    return `$${value.toFixed(0)}B`;
  }
  if (unit === 'K') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}B`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}M`;
    return `${value.toLocaleString()}K`;
  }
  return value.toFixed(1);
}

function formatMacroChange(change: number, unit: MacroUnit): string {
  const sign = change >= 0 ? '+' : '';
  if (unit === '%') return `${sign}${change.toFixed(2)}${change === 0 ? '' : ' bps'}`;
  if (unit === 'B$') return `${sign}$${change.toFixed(0)}B`;
  if (unit === 'K') {
    if (Math.abs(change) >= 1_000) return `${sign}${(change / 1_000).toFixed(0)}M`;
    return `${sign}${change.toFixed(0)}K`;
  }
  return `${sign}${change.toFixed(2)}`;
}

function colorForChange(change: number): string {
  if (change > 0) return 'text-up-text';
  if (change < 0) return 'text-down-text';
  return 'text-gray-400';
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return dateStr; }
}

export function MacroSection({ jumpTo }: { jumpTo?: string | null }) {
  const [mounted, setMounted] = useState(false);
  const [sourcesConfig, setSourcesConfig] = useState<SourcesConfig>({ overrides: {}, custom: [], hidden: [] });
  const [category, setCategory] = useState('All');
  const [data, setData] = useState<Record<string, MacroLatest>>({});
  const [statusOk, setStatusOk] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('5Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);

  useEffect(() => {
    setMounted(true);
    setSourcesConfig(loadSourcesConfig());
    const handler = () => setSourcesConfig(loadSourcesConfig());
    window.addEventListener('mkt-sources-changed', handler);
    return () => window.removeEventListener('mkt-sources-changed', handler);
  }, []);

  const allIndicators = useMemo<UnifiedIndicator[]>(() => {
    const hiddenSet = new Set(mounted ? (sourcesConfig.hidden ?? []) : []);
    return [
      ...MACRO_INDICATORS
        .filter(m => !hiddenSet.has(m.id))
        .map(m => ({
          id: m.id, name: m.name, category: m.category, unit: m.unit,
          isBuiltin: true,
          fetchUrl: mounted ? (sourcesConfig.overrides[m.id] ?? null) : null,
        })),
      ...(mounted ? sourcesConfig.custom.map(c => ({
        id: c.id, name: c.name, category: c.category, unit: c.unit as MacroUnit,
        isBuiltin: false, fetchUrl: c.url,
      })) : []),
    ];
  }, [mounted, sourcesConfig]);

  const categories = useMemo(() => {
    const extraCats = sourcesConfig.custom
      .map(c => c.category)
      .filter(cat => !BUILTIN_CATS.includes(cat));
    return [...BUILTIN_CATS, ...new Set(extraCats)];
  }, [sourcesConfig.custom]);

  const fetchData = useCallback(async () => {
    // Two groups: built-in indicators via /api/macro (full FRED fallback chain),
    // custom/overridden URLs via /api/scrape. Both groups fetched in parallel.
    const builtins   = allIndicators.filter(ind => ind.isBuiltin && !ind.fetchUrl);
    const scrapeList = allIndicators.filter(ind => !!ind.fetchUrl);

    const dataUpdates: Record<string, MacroLatest> = {};
    const okUpdates: Record<string, boolean> = {};

    const from18 = new Date();
    from18.setMonth(from18.getMonth() - 18);
    const fromStr = from18.toISOString().slice(0, 10);

    await Promise.allSettled([
      // Built-in indicators — /api/macro has the complete source + fallback chain
      (async () => {
        if (!builtins.length) return;
        try {
          const ids = builtins.map(ind => ind.id).join(',');
          const res = await fetch(`/api/macro?mode=list&ids=${ids}`);
          const json = await res.json() as MacroLatest[];
          json.forEach(d => { dataUpdates[d.id] = d; okUpdates[d.id] = d.latest !== null; });
        } catch (e) { console.error('[macro] list error', e); }
      })(),

      // Custom / overridden URLs via scrape route
      ...scrapeList.map(async ind => {
        try {
          const res = await fetch(`/api/scrape?url=${encodeURIComponent(ind.fetchUrl!)}&from=${fromStr}`);
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            const sorted = [...json.data].sort((a: { date: string }, b: { date: string }) =>
              a.date.localeCompare(b.date)
            );
            dataUpdates[ind.id] = {
              id: ind.id,
              latest: sorted[sorted.length - 1],
              prev: sorted.length > 1 ? sorted[sorted.length - 2] : null,
            };
            okUpdates[ind.id] = true;
          } else {
            dataUpdates[ind.id] = { id: ind.id, latest: null, prev: null };
            okUpdates[ind.id] = false;
          }
        } catch {
          dataUpdates[ind.id] = { id: ind.id, latest: null, prev: null };
          okUpdates[ind.id] = false;
        }
      }),
    ]);

    setData(prev => ({ ...prev, ...dataUpdates }));
    setStatusOk(prev => ({ ...prev, ...okUpdates }));
    setLastUpdate(new Date());
    setLoading(false);
  }, [allIndicators]);

  const fetchHistory = useCallback(async (
    id: string, tf: Timeframe, override?: { from: string; to: string }
  ) => {
    setHistLoading(true);
    const ind = allIndicators.find(i => i.id === id);
    const scrapeToHist = (d: { date: string; value: number }[]): HistoricalPoint[] =>
      d.map(p => ({ date: p.date, close: p.value }));
    try {
      const from = override?.from ?? getTimeframeStart(tf);
      const toParam = override?.to ? `&to=${override.to}` : '';
      if (ind?.fetchUrl) {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(ind.fetchUrl)}&from=${from}`);
        const json = await res.json();
        setHistorical(json.success && Array.isArray(json.data) ? scrapeToHist(json.data) : []);
      } else {
        const res = await fetch(`/api/macro?mode=history&id=${id}&from=${from}${toParam}`);
        const json = await res.json() as HistoricalPoint[];
        setHistorical(Array.isArray(json) ? json : []);
      }
    } catch { setHistorical([]); }
    finally { setHistLoading(false); }
  }, [allIndicators]);

  useEffect(() => {
    if (!mounted) return;
    fetchData();
    const intervalId = setInterval(fetchData, 30 * 60_000);
    return () => clearInterval(intervalId);
  }, [mounted, fetchData]);

  useEffect(() => {
    if (selected) fetchHistory(selected, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchHistory]);

  useEffect(() => {
    if (jumpTo) setSelected(jumpTo);
  }, [jumpTo]);

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); }, [selected]);

  const filtered = allIndicators.filter(
    ind => category === 'All' || ind.category === category
  );

  const selectedIndicator = allIndicators.find(ind => ind.id === selected);
  const cagrData = selectedIndicator ? calculateCAGR(historical, timeframe) : null;

  return (
    <div className="space-y-3">
      {/* Category filter */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={clsx(
                'px-3 py-1 text-xs font-semibold rounded-full transition-all',
                category === c
                  ? 'bg-accent text-white'
                  : 'text-gray-400 border border-border hover:text-gray-200 hover:border-border-light'
              )}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-600 shrink-0">
          {loading && <span className="text-accent animate-pulse">loading…</span>}
          {lastUpdate && !loading && (
            <span className="flex items-center gap-1">
              <RefreshCw size={9} />{lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <span className="text-gray-700 ml-1">Sources: FRED · BLS · NY Fed · ECB</span>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
        {filtered.map(ind => {
          const d = data[ind.id];
          const latest = d?.latest;
          const prev = d?.prev;
          const change = latest && prev ? latest.value - prev.value : null;
          const isSelected = selected === ind.id;
          const ok = statusOk[ind.id];

          return (
            <button key={ind.id}
              onClick={() => setSelected(isSelected ? null : ind.id)}
              className={clsx(
                'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50 relative',
                isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
              )}>
              {/* Status dot */}
              {ok !== undefined && (
                <span className={clsx(
                  'absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full',
                  ok ? 'bg-emerald-500' : 'bg-red-500'
                )} />
              )}
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">
                {ind.category}
              </p>
              <p className="text-sm font-semibold text-gray-100 leading-snug mb-2 pr-3">{ind.name}</p>

              {latest ? (
                <>
                  <p className="text-xl font-bold text-white tabular-nums">
                    {formatMacroValue(latest.value, ind.unit)}
                  </p>
                  {change != null && (
                    <div className={clsx('flex items-center gap-1 mt-0.5 text-xs font-semibold', colorForChange(change))}>
                      {change > 0 ? <TrendingUp size={11} /> : change < 0 ? <TrendingDown size={11} /> : null}
                      {formatMacroChange(change, ind.unit)}
                      <span className="text-[10px] text-gray-600 font-normal">vs prev</span>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600 mt-0.5">{formatShortDate(latest.date)}</p>
                </>
              ) : (
                loading ? (
                  <div className="space-y-1.5 mt-2">
                    <div className="h-6 bg-border rounded animate-pulse w-20" />
                    <div className="h-3 bg-border rounded animate-pulse w-14" />
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 mt-2">No data</p>
                )
              )}
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && selectedIndicator && (
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white">{selectedIndicator.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedIndicator.isBuiltin ? `Series: ${selected} · ` : ''}{selectedIndicator.category} · Unit: {selectedIndicator.unit}
                {selectedIndicator.fetchUrl && (
                  <span className="ml-1 text-accent/70">· custom URL</span>
                )}
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300 shrink-0">
              <X size={16} />
            </button>
          </div>

          <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
            <TimeframeSelector
              value={timeframe}
              onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
              options={TF_OPTIONS}
              isCustom={!!customRange}
              onCustomRange={(from, to) => setCustomRange({ from, to })}
            />
          </div>

          {/* Stats row */}
          {data[selected]?.latest && selected !== 'BTC_HALVING' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Latest" value={formatMacroValue(data[selected].latest!.value, selectedIndicator.unit)} />
              {data[selected].prev && (
                <Stat label="Previous" value={formatMacroValue(data[selected].prev!.value, selectedIndicator.unit)} />
              )}
              {data[selected].latest && data[selected].prev && (
                <Stat
                  label="Change"
                  value={formatMacroChange(data[selected].latest!.value - data[selected].prev!.value, selectedIndicator.unit)}
                  color={colorForChange(data[selected].latest!.value - data[selected].prev!.value)}
                />
              )}
              {cagrData && (
                <Stat label={`Change (${timeframe})`} value={formatPercent(cagrData.return)} color={cagrData.return >= 0 ? 'text-up-text' : 'text-down-text'} />
              )}
            </div>
          )}

          {selected === 'BTC_HALVING' ? (
            <HalvingChart height={240} />
          ) : histLoading ? (
            <div className="flex items-center justify-center h-44">
              <LoadingSpinner size={28} />
            </div>
          ) : historical.length > 0 ? (
            <PriceChart
              data={extendToToday(
                selectedIndicator?.unit === '%' ? dedupStepSeries(historical) : historical
              )}
              color="auto"
              height={220}
              isCurrency={false}
              interpolationType={selectedIndicator?.unit === '%' ? 'stepAfter' : 'monotone'}
              toolsOverlay={activeTools}
            />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-600 text-sm">
              No historical data
            </div>
          )}

          {historical.length > 0 && selected !== 'BTC_HALVING' && (
            <ChartTools data={historical} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && selected !== 'BTC_HALVING' && (
            <ChartDataTable data={historical} unit={selectedIndicator?.unit} />
          )}
          {selected && <ChartNotes chartId={selected} />}

          <p className="text-[10px] text-gray-700">
            Data: Federal Reserve (FRED), BLS, NY Fed, ECB, DBnomics · Not financial advice
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
      <p className={clsx('text-sm font-bold', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}
