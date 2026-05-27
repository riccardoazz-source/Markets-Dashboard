'use client';

import { useState, useEffect, useCallback } from 'react';
import { COMMODITIES } from '@/lib/config';
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

type SortKey = 'changePercent' | 'mtdChangePercent' | 'ytdChangePercent' | 'fiveYearChangePercent';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'changePercent',         label: 'Day' },
  { value: 'mtdChangePercent',      label: 'MTD' },
  { value: 'ytdChangePercent',      label: 'YTD' },
  { value: 'fiveYearChangePercent', label: '5Y' },
];

const COMMODITY_CATEGORIES = ['All', ...Array.from(new Set(COMMODITIES.map(c => c.category)))];

export function CommoditiesSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('changePercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    try {
      const symbols = COMMODITIES.map(c => c.symbol).join(',');
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

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

  const getValue = (q: QuoteData | undefined, key: SortKey): number | null => {
    if (!q) return null;
    if (key === 'changePercent') return q.changePercent ?? null;
    if (key === 'mtdChangePercent') return q.mtdChangePercent ?? null;
    if (key === 'ytdChangePercent') return q.ytdChangePercent ?? null;
    return q.fiveYearChangePercent ?? null;
  };

  const filteredCommodities = selectedCategory === 'All'
    ? COMMODITIES
    : COMMODITIES.filter(c => c.category === selectedCategory);

  const sorted = [...filteredCommodities].sort((a, b) => {
    const av = getValue(quotes[a.symbol], sortBy);
    const bv = getValue(quotes[b.symbol], sortBy);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  const selectedConfig = COMMODITIES.find(c => c.symbol === selected);
  const selectedQuote = selected ? quotes[selected] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {filteredCommodities.length} commodities
        </span>
        <div className="flex items-center gap-2 shrink-0">
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
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {COMMODITY_CATEGORIES.map(c => (
          <button key={c} onClick={() => setSelectedCategory(c)}
            className={clsx(
              'px-3 py-1 text-xs font-semibold rounded-full transition-all whitespace-nowrap shrink-0',
              selectedCategory === c
                ? 'bg-accent text-white'
                : 'text-gray-400 border border-border hover:border-border-light hover:text-gray-200'
            )}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingGrid count={COMMODITIES.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sorted.map(com => {
            const q = quotes[com.symbol];
            const day = q?.changePercent ?? 0;
            const mtd = q?.mtdChangePercent;
            const ytd = q?.ytdChangePercent;
            const fiveYear = q?.fiveYearChangePercent;
            const isUp = day >= 0;
            const isSelected = selected === com.symbol;
            return (
              <button key={com.symbol}
                onClick={() => setSelected(isSelected ? null : com.symbol)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none">{com.category}</p>
                  {q?.currency && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                      {q.currency}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-gray-100 leading-snug mb-2">{com.name}</p>
                {q && q.price > 0 ? (
                  <>
                    <p className="text-lg font-bold text-white tabular-nums">{formatPrice(q.price)}</p>
                    <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(day))}>
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(day)} <span className="text-[10px] font-medium opacity-70">day</span>
                    </div>
                    {mtd != null && (
                      <p className={clsx('text-[10px] mt-0.5', colorForPercent(mtd))}>
                        MTD: {formatPercent(mtd, 1)}
                      </p>
                    )}
                    {ytd != null && (
                      <p className={clsx('text-[10px] mt-0.5', colorForPercent(ytd))}>
                        YTD: {formatPercent(ytd, 1)}
                      </p>
                    )}
                    {fiveYear != null && (
                      <p className={clsx('text-[10px] mt-0.5', colorForPercent(fiveYear))}>
                        5Y: {formatPercent(fiveYear, 1)}
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
              <h3 className="text-base font-bold text-white">{selectedConfig?.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                {selected} · {selectedConfig?.category}
                {selectedQuote?.currency && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    {selectedQuote.currency}
                  </span>
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
            <Stat label="Price" value={formatPrice(selectedQuote.price)} />
            <Stat label="Day Change" value={formatPercent(selectedQuote.changePercent)} color={colorForPercent(selectedQuote.changePercent)} />
            {selectedQuote.mtdChangePercent != null && (
              <Stat label="MTD Return" value={formatPercent(selectedQuote.mtdChangePercent)} color={colorForPercent(selectedQuote.mtdChangePercent)} />
            )}
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
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : (
            <PriceChart data={historical} color="auto" height={200} toolsOverlay={activeTools}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
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
