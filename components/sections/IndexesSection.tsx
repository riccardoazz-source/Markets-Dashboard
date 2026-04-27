'use client';

import { useState, useEffect, useCallback } from 'react';
import { INDEXES } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent, calculateCAGR } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, ChevronRight } from 'lucide-react';

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
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {REGIONS.map(r => (
            <button
              key={r}
              onClick={() => setSelectedRegion(r)}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-full transition-all',
                selectedRegion === r
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-gray-200 border border-border hover:border-border-light'
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {lastUpdate && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <RefreshCw size={11} />
            {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {loading ? (
        <LoadingGrid count={INDEXES.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map(idx => {
            const q = quotes[idx.symbol];
            const isUp = (q?.changePercent ?? 0) >= 0;
            const isSelected = selected === idx.symbol;
            return (
              <button
                key={idx.symbol}
                onClick={() => setSelected(isSelected ? null : idx.symbol)}
                className={clsx(
                  'rounded-xl border p-4 text-left transition-all duration-150 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/5',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-0.5">
                      {idx.category}
                    </p>
                    <p className="text-sm font-semibold text-gray-100 leading-tight">{idx.name}</p>
                  </div>
                  {isSelected && <ChevronRight size={14} className="text-accent mt-0.5" />}
                </div>
                {q ? (
                  <>
                    <p className="text-xl font-bold text-white mt-2">
                      {q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className={clsx('flex items-center gap-1 mt-1 text-sm font-semibold', colorForPercent(q.changePercent))}>
                      {isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                      {formatPercent(q.changePercent)}
                    </div>
                    <div className="mt-2 pt-2 border-t border-border flex gap-3 text-[10px]">
                      {q.trailingPE != null && (
                        <div>
                          <span className="text-gray-500">P/E </span>
                          <span className="text-gray-300 font-medium">{q.trailingPE.toFixed(1)}</span>
                        </div>
                      )}
                      {q.forwardPE != null && (
                        <div>
                          <span className="text-gray-500">Fwd </span>
                          <span className="text-gray-300 font-medium">{q.forwardPE.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-gray-500 text-sm">Loading…</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedQuote && (
        <div className="rounded-xl border border-border bg-bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-bold text-white">{selectedConfig?.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{selected} · {selectedConfig?.region}</p>
            </div>
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Price" value={selectedQuote.price.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            <Stat
              label="Change"
              value={formatPercent(selectedQuote.changePercent)}
              color={colorForPercent(selectedQuote.changePercent)}
            />
            {cagrData && (
              <>
                <Stat
                  label={`Return (${timeframe})`}
                  value={formatPercent(cagrData.return)}
                  color={colorForPercent(cagrData.return)}
                />
                <Stat
                  label={`CAGR (${timeframe})`}
                  value={formatPercent(cagrData.cagr)}
                  color={colorForPercent(cagrData.cagr)}
                />
              </>
            )}
            {selectedQuote.trailingPE != null && (
              <Stat label="P/E (TTM)" value={selectedQuote.trailingPE.toFixed(2)} />
            )}
            {selectedQuote.forwardPE != null && (
              <Stat label="Forward P/E" value={selectedQuote.forwardPE.toFixed(2)} />
            )}
            {selectedQuote.high52w != null && (
              <Stat label="52W High" value={selectedQuote.high52w.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            )}
            {selectedQuote.low52w != null && (
              <Stat label="52W Low" value={selectedQuote.low52w.toLocaleString('en-US', { minimumFractionDigits: 2 })} />
            )}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size={32} />
            </div>
          ) : (
            <PriceChart data={historical} color="auto" height={240} />
          )}

          {cagrData && (
            <div className="text-xs text-gray-500">
              {cagrData.startDate} → {cagrData.endDate} ·
              {' '}{formatPrice(cagrData.startPrice)} → {formatPrice(cagrData.endPrice)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-3 py-2.5">
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className={clsx('text-sm font-bold', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}
