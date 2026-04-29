'use client';

import { useState, useEffect, useCallback } from 'react';
import { COMMODITIES } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent, calculateCAGR } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X } from 'lucide-react';

export function CommoditiesSection() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchQuotes = useCallback(async () => {
    try {
      const symbols = COMMODITIES.map(c => c.symbol).join(',');
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const data = await res.json() as QuoteData[];
      const map: Record<string, QuoteData> = {};
      data.forEach(q => { map[q.symbol] = q; });
      setQuotes(map);
      setLastUpdate(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchHistorical = useCallback(async (symbol: string, tf: Timeframe) => {
    setHistLoading(true);
    try {
      const res = await fetch(`/api/historical?symbol=${symbol}&timeframe=${tf}`);
      const data = await res.json() as HistoricalPoint[];
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
    } catch (e) { console.error(e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe);
  }, [selected, timeframe, fetchHistorical]);

  const selectedConfig = COMMODITIES.find(c => c.symbol === selected);
  const selectedQuote = selected ? quotes[selected] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {lastUpdate && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <RefreshCw size={11} />
            {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {loading ? (
        <LoadingGrid count={COMMODITIES.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {COMMODITIES.map(com => {
            const q = quotes[com.symbol];
            const day = q?.changePercent ?? 0;
            const isUp = day >= 0;
            const isSelected = selected === com.symbol;
            return (
              <button
                key={com.symbol}
                onClick={() => setSelected(isSelected ? null : com.symbol)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}
              >
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">
                  {com.category}
                </p>
                <p className="text-sm font-semibold text-gray-100 leading-snug mb-2">
                  {com.name}
                </p>
                {q && q.price > 0 ? (
                  <>
                    <p className="text-lg font-bold text-white tabular-nums">
                      {formatPrice(q.price)}
                    </p>
                    <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(day))}>
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(day)} <span className="text-[10px] font-medium opacity-70">day</span>
                    </div>
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
              <p className="text-xs text-gray-500 mt-0.5">{selected} · {selectedConfig?.category}</p>
            </div>
            <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300 shrink-0">
              <X size={16} />
            </button>
          </div>
          <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Price" value={formatPrice(selectedQuote.price)} />
            <Stat label="Day Change" value={formatPercent(selectedQuote.changePercent)} color={colorForPercent(selectedQuote.changePercent)} />
            {selectedQuote.high52w != null && <Stat label="52W High" value={formatPrice(selectedQuote.high52w)} />}
            {selectedQuote.low52w != null && <Stat label="52W Low" value={formatPrice(selectedQuote.low52w)} />}
            {cagrData && (
              <>
                <Stat label={`Return (${timeframe})`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
                <Stat label={`CAGR (${timeframe})`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
              </>
            )}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : (
            <PriceChart data={historical} color="auto" height={200} />
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
