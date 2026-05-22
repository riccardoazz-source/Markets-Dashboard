'use client';

import { useState, useEffect, useCallback } from 'react';
import { INDEXES } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent, calculateCAGR, dataAvailabilityMessage } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
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

  const fetchQuotes = useCallback(async () => {
    const symbols = INDEXES.map(i => i.symbol).join(',');
    try {
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const data = await res.json() as QuoteData[];
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

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

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
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}>
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none mb-1">
                  {idx.category}
                </p>
                <p className="text-sm font-semibold text-gray-100 leading-snug mb-2">{idx.name}</p>
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
            {selectedQuote.high52w != null && <Stat label="52W High" value={formatPrice(selectedQuote.high52w)} />}
            {selectedQuote.low52w != null && <Stat label="52W Low" value={formatPrice(selectedQuote.low52w)} />}
            {selectedQuote.trailingPE != null && <Stat label="P/E" value={selectedQuote.trailingPE.toFixed(1)} />}
            {selectedQuote.forwardPE != null && <Stat label="Fwd P/E" value={selectedQuote.forwardPE.toFixed(1)} />}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : (
            <PriceChart data={historical} color="auto" height={200} toolsOverlay={activeTools} />
          )}

          {cagrData && (
            <p className="text-[10px] text-gray-600">
              {cagrData.startDate} → {cagrData.endDate} · {formatPrice(cagrData.startPrice)} → {formatPrice(cagrData.endPrice)}
            </p>
          )}
          {historical.length > 0 && (
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
