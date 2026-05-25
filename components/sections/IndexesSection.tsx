'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { INDEXES } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent, calculateCAGR, dataAvailabilityMessage, computeAssetIRR, type DividendEvent } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { DividendsPanel } from '@/components/charts/DividendsBarChart';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X, BarChart2 } from 'lucide-react';

const REGIONS = ['All', 'America', 'EU', 'Asia', 'Global', 'EM'];

type SortKey = 'changePercent' | 'mtdChangePercent' | 'ytdChangePercent';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'changePercent',    label: 'Day' },
  { value: 'mtdChangePercent', label: 'MTD' },
  { value: 'ytdChangePercent', label: 'YTD' },
];

export function IndexesSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [sortBy, setSortBy] = useState<SortKey>('changePercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [divData, setDivData] = useState<{ adjPrices: HistoricalPoint[]; dividends: DividendEvent[] } | null>(null);

  const fetchQuotes = useCallback(async () => {
    const symbols = INDEXES.map(i => i.symbol).join(',');
    try {
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const rawQ = await res.json();
      const data: QuoteData[] = Array.isArray(rawQ) ? (rawQ as QuoteData[]) : [];
      const map: Record<string, QuoteData> = {};
      data.forEach(q => { map[q.symbol] = q; });
      setQuotes(map);
      setLastUpdate(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchHistorical = useCallback(async (
    symbol: string, tf: Timeframe, override?: { from: string; to: string }
  ) => {
    setHistLoading(true);
    try {
      const url = override
        ? `/api/historical?symbol=${symbol}&timeframe=${tf}&from=${override.from}&to=${override.to}`
        : `/api/historical?symbol=${symbol}&timeframe=${tf}`;
      const raw = await fetch(url).then(r => r.json()) as HistoricalPoint[];
      const data = Array.isArray(raw) ? raw : [];
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
      setDataMsg(dataAvailabilityMessage(data, tf));
    } catch (e) { console.error(e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchHistorical]);

  useEffect(() => {
    if (jumpTo) setSelected(jumpTo);
  }, [jumpTo]);

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); setDivData(null); }, [selected]);

  // Fetch adjusted-price + dividend data for distributing ETFs
  useEffect(() => {
    if (!selected || !quotes[selected]?.dividendYield) return;
    const params = customRange
      ? `symbol=${encodeURIComponent(selected)}&timeframe=${timeframe}&from=${customRange.from}&to=${customRange.to}`
      : `symbol=${encodeURIComponent(selected)}&timeframe=${timeframe}`;
    fetch(`/api/stock?${params}`)
      .then(r => r.json())
      .then((raw: { adjPrices?: HistoricalPoint[]; dividends?: DividendEvent[] }) => {
        const adj = raw.adjPrices ?? [];
        const divs = raw.dividends ?? [];
        if (adj.length > 0 || divs.length > 0) setDivData({ adjPrices: adj, dividends: divs });
      })
      .catch(() => {});
  }, [selected, timeframe, customRange, quotes]);

  // Dual-line chart data: price vs total return, normalized to 0% at period start
  const divChartData = useMemo(() => {
    if (!historical.length || !divData?.adjPrices.length) return null;
    const adjMap = new Map<string, number>(divData.adjPrices.map(p => [p.date, p.close]));
    const priceBase = historical[0].close;
    const adjBase = divData.adjPrices[0].close;
    return historical.map(p => {
      const adj = adjMap.get(p.date);
      return {
        date: p.date,
        price: ((p.close - priceBase) / priceBase) * 100,
        totalReturn: adj != null ? ((adj - adjBase) / adjBase) * 100 : undefined,
      };
    });
  }, [historical, divData]);

  const irr = useMemo(() => {
    if (!divData?.dividends.length || !historical.length) return null;
    return computeAssetIRR(historical, divData.dividends);
  }, [historical, divData]);

  const filtered = INDEXES.filter(
    i => selectedRegion === 'All' || i.region === selectedRegion
  );

  const getValue = (q: QuoteData | undefined, key: SortKey) => {
    if (!q) return null;
    if (key === 'changePercent') return q.changePercent ?? null;
    if (key === 'mtdChangePercent') return q.mtdChangePercent ?? null;
    return q.ytdChangePercent ?? null;
  };

  const sortedFiltered = [...filtered].sort((a, b) => {
    const qa = quotes[a.symbol];
    const qb = quotes[b.symbol];
    const av = getValue(qa, sortBy);
    const bv = getValue(qb, sortBy);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  const selectedConfig = INDEXES.find(i => i.symbol === selected);
  const selectedQuote = selected ? quotes[selected] : null;

  return (
    <div className="space-y-3">
      {/* Count chip */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {INDEXES.length} indexes
        </span>
      </div>
      {/* Filters row */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {REGIONS.map(r => (
          <button key={r} onClick={() => setSelectedRegion(r)}
            className={clsx(
              'px-3 py-1 text-xs font-semibold rounded-full transition-all whitespace-nowrap shrink-0',
              selectedRegion === r
                ? 'bg-accent text-white'
                : 'text-gray-400 border border-border hover:border-border-light hover:text-gray-200'
            )}>
            {r}
          </button>
        ))}
      </div>
      {/* Sort row — always right-aligned */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          {SORT_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setSortBy(opt.value)}
              className={clsx('px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
              {opt.label}
            </button>
          ))}
        </div>
        {lastUpdate && (
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <RefreshCw size={10} />
            {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {loading ? (
        <LoadingGrid count={INDEXES.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {sortedFiltered.map(idx => {
            const q = quotes[idx.symbol];
            const day = q?.changePercent ?? 0;
            const ytd = q?.ytdChangePercent;
            const isUp = day >= 0;
            const isSelected = selected === idx.symbol;
            return (
              <button key={idx.symbol}
                onClick={() => setSelected(isSelected ? null : idx.symbol)}
                className={clsx(
                  'relative rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}>
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none mb-1">
                  {idx.category}
                </p>
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-sm font-semibold text-gray-100 leading-snug">{idx.name}</p>
                  {q?.dividendYield != null && q.dividendYield > 0 && (
                    <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 leading-none">
                      DIV
                    </span>
                  )}
                </div>
                {q && q.price > 0 ? (
                  <>
                    <p className="text-lg font-bold text-white tabular-nums">
                      {q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(day))}>
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(day)} <span className="text-[10px] font-medium opacity-70">day</span>
                    </div>
                    {q.mtdChangePercent != null && (
                      <p className={clsx('text-[10px] mt-0.5', colorForPercent(q.mtdChangePercent))}>
                        MTD: {formatPercent(q.mtdChangePercent, 1)}
                      </p>
                    )}
                    {ytd != null && (
                      <p className={clsx('text-[10px] mt-0.5', colorForPercent(ytd))}>
                        YTD: {formatPercent(ytd, 1)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-600">Loading…</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedQuote && (
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white leading-tight">{selectedConfig?.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{selected} · {selectedConfig?.region}</p>
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
              isCustom={!!customRange}
              onCustomRange={(from, to) => setCustomRange({ from, to })}
            />
          </div>

          {dataMsg && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              ⚠ {dataMsg}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <Stat label="Price" value={selectedQuote.price.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            <Stat label="Day Change" value={formatPercent(selectedQuote.changePercent)} color={colorForPercent(selectedQuote.changePercent)} />
            {selectedQuote.ytdChangePercent != null && (
              <Stat label="YTD Return" value={formatPercent(selectedQuote.ytdChangePercent)} color={colorForPercent(selectedQuote.ytdChangePercent)} />
            )}
            {cagrData && (
              <>
                <Stat label={`Return (${timeframe})`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
                <Stat label={`CAGR (${timeframe})`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
              </>
            )}
            {irr != null && (
              /* computeAssetIRR returns a decimal (0.085 = 8.5%) — multiply by 100 for display */
              <Stat label={`IRR (${timeframe})`} value={formatPercent(irr * 100)} color={colorForPercent(irr * 100)} />
            )}
            {selectedQuote.high52w != null && <Stat label="52W High" value={formatPrice(selectedQuote.high52w)} />}
            {selectedQuote.low52w != null && <Stat label="52W Low" value={formatPrice(selectedQuote.low52w)} />}
            {selectedQuote.trailingPE != null && <Stat label="P/E" value={selectedQuote.trailingPE.toFixed(1)} />}
            {selectedQuote.forwardPE != null && <Stat label="Fwd P/E" value={selectedQuote.forwardPE.toFixed(1)} />}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : divChartData ? (
            /* Dual-line: price vs total return (normalized % from period start) */
            (() => {
              const last = divChartData[divChartData.length - 1];
              const isUp = (last?.price ?? 0) >= 0;
              const priceColor = isUp ? '#10b981' : '#ef4444';
              const trColor    = isUp ? '#34d399' : '#f87171';
              return (
                <div className="space-y-1">
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: priceColor }}/>Price</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed" style={{ borderColor: trColor }}/>Total Return</span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={divChartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                        interval="preserveStartEnd"
                        tickFormatter={d => {
                          const date = new Date(d);
                          const n = divChartData.length;
                          if (n < 60)  return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
                          if (n < 700) return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
                          return String(date.getFullYear());
                        }} />
                      <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                        tickFormatter={v => `${v >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`} />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: 11, padding: '6px 10px' }}
                        labelStyle={{ color: '#94a3b8', fontSize: 10, marginBottom: 2 }}
                        formatter={(val: number, name: string) => [`${val >= 0 ? '+' : ''}${val.toFixed(2)}%`, name]}
                      />
                      <Line dataKey="price" name="Price" stroke={priceColor} dot={false} strokeWidth={2} connectNulls />
                      <Line dataKey="totalReturn" name="Total Return" stroke={trColor} dot={false} strokeWidth={2} strokeDasharray="6 3" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()
          ) : (
            <PriceChart data={historical} color="auto" height={200} toolsOverlay={activeTools} />
          )}

          {/* Dividends — same bar chart + collapsible list as StockSection */}
          {divData && divData.dividends.length > 0 && (
            <DividendsPanel
              dividends={divData.dividends}
              currency={selectedQuote.currency ?? 'USD'}
              periodStartDate={historical[0]?.date}
            />
          )}

          {cagrData && !divChartData && (
            <p className="text-[10px] text-gray-600">
              {cagrData.startDate} → {cagrData.endDate} · {formatPrice(cagrData.startPrice)} → {formatPrice(cagrData.endPrice)}
            </p>
          )}
          {!divChartData && historical.length > 0 && (
            <ChartTools data={historical} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && <ChartDataTable data={historical} />}
          {selected && <ChartNotes chartId={selected} />}
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
