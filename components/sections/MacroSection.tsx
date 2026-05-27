'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MACRO_INDICATORS, MacroUnit, RECESSION_SERIES, FOMC_MEETING_DATES, BTC_HALVING_DATES } from '@/lib/config';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import { getTimeframeStart, calculateCAGR, formatPercent, dedupStepSeries, extendToToday, dataAvailabilityMessage } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { HalvingChart } from '@/components/charts/HalvingChart';
import { FOMCChart } from '@/components/charts/FOMCChart';
import { RecessionChart } from '@/components/charts/RecessionChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { loadSourcesConfig, SourcesConfig } from '@/lib/userSources';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X, BarChart2, Layers } from 'lucide-react';

const BUILTIN_CATS = ['All', 'Rates', 'Inflation', 'Growth', 'Employment', 'Real Estate', 'Money', 'Commodities', 'Sentiment', 'Crypto', 'Debt', 'Market Value', 'Recessions'];

const RECESSION_SET = new Set(RECESSION_SERIES);
const TF_OPTIONS: Timeframe[] = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface MacroLatest {
  id: string;
  latest: { date: string; value: number } | null;
  prev:   { date: string; value: number } | null;
  fromGist?: boolean; // true when live APIs failed and the Gist cloud cache was used
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
  if (unit === '$') {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
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
  if (unit === '$') {
    if (Math.abs(change) >= 1_000) return `${sign}$${(change / 1_000).toFixed(0)}K`;
    return `${sign}$${change.toFixed(0)}`;
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

export function MacroSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [mounted, setMounted] = useState(false);
  const [sourcesConfig, setSourcesConfig] = useState<SourcesConfig>({ overrides: {}, custom: [], hidden: [] });
  const [btcNextHalvingDate, setBtcNextHalvingDate] = useState<string | null>(null);
  const [category, setCategory] = useState('All');
  const [data, setData] = useState<Record<string, MacroLatest>>({});
  const [statusOk, setStatusOk] = useState<Record<string, boolean>>({});
  const [statusGist, setStatusGist] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('5Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setSourcesConfig(loadSourcesConfig());
    const handler = () => setSourcesConfig(loadSourcesConfig());
    window.addEventListener('mkt-sources-changed', handler);
    // Fetch dynamic next halving estimate from block height API
    fetch('/api/macro?mode=btc-next-halving')
      .then(r => r.json() as Promise<{ estimatedDate: string }>)
      .then(d => setBtcNextHalvingDate(d.estimatedDate))
      .catch(() => null);
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
    const gistUpdates: Record<string, boolean> = {};

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
          json.forEach(d => {
            dataUpdates[d.id] = d;
            okUpdates[d.id] = d.latest !== null;
            gistUpdates[d.id] = d.latest !== null && d.fromGist === true;
          });
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
    setStatusGist(prev => ({ ...prev, ...gistUpdates }));
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
      let hist: HistoricalPoint[] = [];
      if (ind?.fetchUrl) {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(ind.fetchUrl)}&from=${from}`);
        const json = await res.json();
        hist = json.success && Array.isArray(json.data) ? scrapeToHist(json.data) : [];
      } else {
        const res = await fetch(`/api/macro?mode=history&id=${id}&from=${from}${toParam}`);
        const json = await res.json() as HistoricalPoint[];
        hist = Array.isArray(json) ? json : [];
      }
      // Client-side range clip: the API may return data beyond override.to (server
      // does not enforce the upper bound), and extendToToday would add today's date
      // even when a custom end date was requested.  Clip both bounds here so the
      // chart shows exactly what was drag-selected.
      if (override) {
        hist = hist.filter(p => p.date >= override.from && p.date <= override.to);
      }
      setHistorical(hist);
      setDataMsg(dataAvailabilityMessage(hist, tf));
    } catch { setHistorical([]); setDataMsg(null); }
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

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

  const filtered = allIndicators.filter(
    ind => category === 'All' || ind.category === category
  );

  const selectedIndicator = allIndicators.find(ind => ind.id === selected);
  const cagrData = selectedIndicator ? calculateCAGR(historical, timeframe) : null;
  const selIsRec = selected ? RECESSION_SET.has(selected) : false;
  const selIsFOMC = selected === 'FOMC_MEETINGS';

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
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
            {filtered.length} indicator{filtered.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            {loading && <span className="text-accent animate-pulse">loading…</span>}
            {lastUpdate && !loading && (
              <span className="flex items-center gap-1">
                <RefreshCw size={9} />{lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="text-gray-700 ml-1">FRED · BLS · NY Fed · ECB</span>
          </div>
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
          const snap = statusGist[ind.id];
          const isRec = RECESSION_SET.has(ind.id);
          const isFOMC = ind.id === 'FOMC_MEETINGS';
          // Overlay series (recession bands, halving/meeting markers) behave differently
          // from normal indicators — flag them so they are easy to spot.
          const isSpecial = isRec || ind.id === 'BTC_HALVING' || isFOMC;

          return (
            <button key={ind.id}
              onClick={() => setSelected(isSelected ? null : ind.id)}
              className={clsx(
                'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50 relative',
                isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
              )}>
              {/* Status dot: green = live data, amber = snapshot fallback, red = no data */}
              {ok !== undefined && (
                <span
                  title={snap ? 'Cloud cache — live source unavailable' : ok ? 'Live data' : 'No data'}
                  className={clsx(
                    'absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full',
                    !ok ? 'bg-red-500' : snap ? 'bg-amber-400' : 'bg-emerald-500'
                  )}
                />
              )}
              <div className="flex items-center justify-between mb-1 pr-3">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider flex items-center gap-1">
                  {isSpecial && (
                    <span title="Special overlay — shown as reference lines or shaded bands on charts">
                      <Layers size={10} className="text-violet-400 shrink-0" />
                    </span>
                  )}
                  {ind.category}
                </p>
                {(ind.unit === '$' || ind.unit === 'B$') && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    USD
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-gray-100 leading-snug mb-2 pr-3">{ind.name}</p>

              {latest ? (
                <>
                  {isFOMC ? (
                    (() => {
                      const today = new Date().toISOString().slice(0, 10);
                      const past = FOMC_MEETING_DATES.filter(d => d <= today);
                      const future = FOMC_MEETING_DATES.filter(d => d > today);
                      const lastMeeting = past[past.length - 1];
                      const nextMeeting = future[0];
                      const fmt = (d: string) => {
                        try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
                        catch { return d; }
                      };
                      return (
                        <div className="space-y-0.5">
                          <p className="text-xs text-gray-500">Last</p>
                          <p className="text-sm font-bold text-gray-100">{lastMeeting ? fmt(lastMeeting) : '—'}</p>
                          <p className="text-xs text-gray-500 mt-1">Next</p>
                          <p className="text-sm font-bold text-blue-300">{nextMeeting ? fmt(nextMeeting) : '—'}</p>
                        </div>
                      );
                    })()
                  ) : ind.id === 'BTC_HALVING' ? (
                    (() => {
                      const today = new Date().toISOString().slice(0, 10);
                      const past = BTC_HALVING_DATES.filter(d => d <= today);
                      const lastHalving = past[past.length - 1];
                      // Use dynamic block-height estimate if available, else +4y fallback
                      const nextHalvingLabel = btcNextHalvingDate
                        ? new Date(btcNextHalvingDate + 'T12:00:00Z')
                            .toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
                        : lastHalving
                          ? (() => {
                              const d = new Date(lastHalving + 'T12:00:00Z');
                              d.setFullYear(d.getFullYear() + 4);
                              return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
                            })()
                          : '~2028';
                      const fmt = (d: string) => {
                        try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
                        catch { return d; }
                      };
                      return (
                        <div className="space-y-0.5">
                          <p className="text-xs text-gray-500">Last</p>
                          <p className="text-sm font-bold text-gray-100">{lastHalving ? fmt(lastHalving) : '—'}</p>
                          <p className="text-xs text-gray-500 mt-1">Next (est.)</p>
                          <p className="text-sm font-bold text-violet-300">{nextHalvingLabel}</p>
                        </div>
                      );
                    })()
                  ) : isRec ? (
                    <p className={clsx('text-lg font-bold tabular-nums',
                      latest.value >= 0.5 ? 'text-down-text' : 'text-up-text')}>
                      {latest.value >= 0.5 ? 'In recession' : 'No recession'}
                    </p>
                  ) : (
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
                    </>
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
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                {selectedIndicator.isBuiltin ? `Series: ${selected} · ` : ''}{selectedIndicator.category} · Unit: {selectedIndicator.unit}
                {(selectedIndicator.unit === '$' || selectedIndicator.unit === 'B$') && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    USD
                  </span>
                )}
                {selectedIndicator.fetchUrl && (
                  <span className="text-accent/70">· custom URL</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onCompare && (
                <button
                  onClick={() => onCompare(selected!)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  Compare
                </button>
              )}
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
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

          {statusGist[selected] && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              🟡 Live source unavailable — showing data from cloud cache. Historical chart may have limited data.
            </p>
          )}

          {dataMsg && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              ⚠ {dataMsg}
            </p>
          )}

          {/* Stats row */}
          {data[selected]?.latest && selected !== 'BTC_HALVING' && !selIsRec && !selIsFOMC && (
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
          ) : selIsFOMC ? (
            <FOMCChart height={240} />
          ) : histLoading ? (
            <div className="flex items-center justify-center h-44">
              <LoadingSpinner size={28} />
            </div>
          ) : selIsRec ? (
            historical.length > 0 ? (
              <RecessionChart datasets={[{ symbol: selected, data: historical }]} height={240} />
            ) : (
              <div className="flex items-center justify-center h-44 text-gray-600 text-sm">
                No recession data
              </div>
            )
          ) : historical.length > 0 ? (
            <PriceChart
              data={(() => {
                // Step-function indicators (e.g. interest rates): remove consecutive
                // duplicates so Recharts renders clean staircase lines.
                const base = selectedIndicator?.unit === '%'
                  ? dedupStepSeries(historical) : historical;
                // When a custom drag-selection is active, respect its end date exactly.
                // extendToToday would append a synthetic "today" point past the range.
                return customRange ? base : extendToToday(base);
              })()}
              color="auto"
              height={220}
              isCurrency={false}
              interpolationType={selectedIndicator?.unit === '%' ? 'stepAfter' : 'monotone'}
              toolsOverlay={activeTools}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }}
            />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-600 text-sm">
              No historical data
            </div>
          )}

          {historical.length > 0 && selected !== 'BTC_HALVING' && !selIsRec && !selIsFOMC && (
            <ChartTools data={historical} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && selected !== 'BTC_HALVING' && !selIsRec && !selIsFOMC && (
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
