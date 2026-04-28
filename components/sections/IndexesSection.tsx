'use client';

import { useState, useEffect, useCallback } from 'react';
import { INDEXES } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent, calculateCAGR } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X } from 'lucide-react';

const REGIONS = ['All', 'America', 'EU', 'Asia', 'Global', 'EM'];

export function IndexesSection() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchQuotes = useCallback(async () => {
    const symbols = INDEXES.map(i => i.symbol).join(',');
    try {
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const data = await res.json() as QuoteData[];
      const map: Record<string, QuoteData> = {};
      data.forEach(q => { map[q.symbol] = q; });
      setQuotes(map);
      setLastUpdate(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistorical = useCallback(async (symbol: string, tf: Timeframe) => {
    setHistLoading(true);
    try {
      const res = await fetch(`/api/historical?symbol=${symbol}&timeframe=${tf}`);
      const data = await res.json() as HistoricalPoint[];
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe);
  }, [selected, timeframe, fetchHistorical]);

  const filtered = INDEXES.filter(
    i => selectedRegion === 'All' || i.region === selectedRegion
  );

  const selectedConfig = INDEXES.find(i => i.symbol === selected);
  const selectedQuote = selected ? quotes[selected] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {REGIONS.map(r => (
            <button
              key={r}
              onClick={() => setSelectedRegion(r)}
              className={clsx(
                'px-3 py-1 text-xs font-semibold rounded-full transition-all whitespace-nowrap shrink-0',
                selectedRegion === r
                  ? 'bg-accent text-white'
                  : 'text-gray-400 border border-border hover:border-border-light hover:text-gray-200'
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {lastUpdate && (
          <div className="flex items-center gap-1 text-[10px] text-gray-600 shrink-0">
            <RefreshCw size={10} />
            {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {loading ? (
        <LoadingGrid count={INDEXES.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {filtered.map(idx => {
            const q = quotes[idx.symbol];
            const day = q?.changePercent ?? 0;
            const oneY = q?.fiftyTwoWeekChangePercent;
            const isUp = day >= 0;
            const isSelected = selected === idx.symbol;
            return (
              <button
                key={idx.symbol}
                onClick={() => setSelected(isSelected ? null : idx.symbol)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}
              >
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none mb-1">
                  {idx.category}
                </p>
                <p className="text-sm font-semibold text-gray-100 leading-snug mb-2">
                  {idx.name}
                </p>
                {q && q.price > 0 ? (
                  <>
                    <p className="text-lg font-bold text-white tabular-nums">
                      {q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(day))}>
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(day)} <span className="text-[10px] font-medium opacity-70">day</span>
                    </div>
                    {oneY != null && (
                      <p className={clsx('text-[10px] mt-0.5', colorForPercent(oneY))}>
                        1Y: {formatPercent(oneY, 1)}
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
            <div className="flex items-center gap-2 shrink-0">
              <TimeframeSelector value={timeframe} onChange={setTimeframe} />
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Price" value={selectedQuote.price.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            <Stat
              label="Day Change"
              value={formatPercent(selectedQuote.changePercent)}
              color={colorForPercent(selectedQuote.changePercent)}
            />
            {selectedQuote.fiftyTwoWeekChangePercent != null && (
              <Stat
                label="1Y Change"
                value={formatPercent(selectedQuote.fiftyTwoWeekChangePercent)}
                color={colorForPercent(selectedQuote.fiftyTwoWeekChangePercent)}
              />
            )}
            {cagrData && (
              <Stat
                label={`CAGR ${timeframe}`}
                value={formatPercent(cagrData.cagr)}
                color={colorForPercent(cagrData.cagr)}
              />
            )}
            {selectedQuote.trailingPE != null && (
              <Stat label="P/E" value={selectedQuote.trailingPE.toFixed(1)} />
            )}
            {selectedQuote.forwardPE != null && (
              <Stat label="Fwd P/E" value={selectedQuote.forwardPE.toFixed(1)} />
            )}
            {selectedQuote.high52w != null && (
              <Stat label="52W High" value={selectedQuote.high52w.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            )}
            {selectedQuote.low52w != null && (
              <Stat label="52W Low" value={selectedQuote.low52w.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            )}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40">
              <LoadingSpinner size={28} />
            </div>
          ) : (
            <PriceChart data={historical} color="auto" height={200} />
          )}

          {cagrData && (
            <p className="text-[10px] text-gray-600">
              {cagrData.startDate} → {cagrData.endDate} · {formatPrice(cagrData.startPrice)} → {formatPrice(cagrData.endPrice)}
            </p>
          )}
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
