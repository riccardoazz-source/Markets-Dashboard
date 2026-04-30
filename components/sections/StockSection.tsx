'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import {
  calculateCAGR,
  formatPercent,
  formatPrice,
  colorForPercent,
  buildTotalReturnSeries,
  computeAssetIRR,
  DividendEvent,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';

const TF_OPTIONS: Timeframe[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

interface StockData {
  symbol: string;
  meta: {
    price: number;
    previousClose: number;
    currency: string;
    high52w: number | null;
    low52w: number | null;
  } | null;
  prices: HistoricalPoint[];
  dividends: DividendEvent[];
}

type ChartMode = 'price' | 'totalReturn';

export function StockSection() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('5Y');
  const [chartMode, setChartMode] = useState<ChartMode>('totalReturn');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced ticker / ISIN / name search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 1) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stock?mode=search&q=${encodeURIComponent(query)}`);
        const json = await res.json() as SearchHit[];
        setHits(Array.isArray(json) ? json : []);
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const fetchAsset = useCallback(async (sym: string, tf: Timeframe) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&timeframe=${tf}`);
      const json = await res.json() as StockData;
      setData(json);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selected) fetchAsset(selected.symbol, timeframe);
  }, [selected, timeframe, fetchAsset]);

  const pickHit = (h: SearchHit) => {
    setSelected(h);
    setQuery(`${h.symbol} — ${h.name}`);
    setHits([]);
    setShowDropdown(false);
  };

  const clearSelection = () => {
    setSelected(null);
    setData(null);
    setQuery('');
    setHits([]);
  };

  // Derived metrics
  const prices = data?.prices ?? [];
  const dividends = data?.dividends ?? [];
  const totalReturnSeries = buildTotalReturnSeries(prices, dividends);
  const cagrPrice = calculateCAGR(prices, timeframe);
  const cagrTR = calculateCAGR(totalReturnSeries, timeframe);
  const irr = computeAssetIRR(prices, dividends);
  const irrPct = irr != null ? irr * 100 : null;
  const totalDivs = dividends.reduce((s, d) =>
    d.date >= (prices[0]?.date ?? '0000-00-00') ? s + d.amount : s, 0);

  const chartData = chartMode === 'totalReturn' ? totalReturnSeries : prices;

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 bg-bg-card border border-border rounded-xl px-3 py-2">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search by ticker (AAPL, KO, ENI.MI), ISIN (US0378331005), or name…"
            className="bg-transparent outline-none text-gray-100 placeholder-gray-600 text-sm flex-1"
          />
          {selected && (
            <button onClick={clearSelection} className="p-0.5 text-gray-500 hover:text-gray-300 shrink-0">
              <X size={14} />
            </button>
          )}
          {searching && <span className="text-[10px] text-gray-500 animate-pulse">…</span>}
        </div>
        {showDropdown && hits.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-lg shadow-xl z-30 max-h-72 overflow-y-auto">
            {hits.map(h => (
              <button
                key={h.symbol}
                onClick={() => pickHit(h)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-bg-hover text-left border-b border-border last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-gray-100 font-medium truncate">{h.name}</p>
                  <p className="text-gray-500 text-[10px]">{h.exchange}{h.type ? ` · ${h.type}` : ''}</p>
                </div>
                <span className="text-gray-400 ml-3 font-mono shrink-0">{h.symbol}</span>
              </button>
            ))}
          </div>
        )}
        {showDropdown && query.length >= 1 && hits.length === 0 && !searching && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-lg shadow-xl z-30 px-3 py-2 text-xs text-gray-500">
            No matches. Try a ticker like AAPL, KO, ENI.MI, or an ISIN (e.g. US0378331005).
          </div>
        )}
      </div>

      {!selected && (
        <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-gray-500">
          Search for a stock by ticker (e.g. <span className="text-gray-300 font-mono">AAPL</span>,{' '}
          <span className="text-gray-300 font-mono">KO</span>,{' '}
          <span className="text-gray-300 font-mono">ENI.MI</span>) or by ISIN
          (e.g. <span className="text-gray-300 font-mono">US0378331005</span>) to view its
          price-only and total-return (with dividends) performance, plus CAGR and IRR.
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">{selected.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                <span className="font-mono">{selected.symbol}</span>
                {selected.exchange ? ` · ${selected.exchange}` : ''}
                {selected.type ? ` · ${selected.type}` : ''}
                {data?.meta?.currency ? ` · ${data.meta.currency}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1 bg-bg-input rounded-lg p-1">
                <button onClick={() => setChartMode('price')}
                  className={clsx('px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all',
                    chartMode === 'price' ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                  Price only
                </button>
                <button onClick={() => setChartMode('totalReturn')}
                  className={clsx('px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all',
                    chartMode === 'totalReturn' ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                  Total return
                </button>
              </div>
              <TimeframeSelector value={timeframe} onChange={setTimeframe} options={TF_OPTIONS} />
            </div>
          </div>

          {/* Stats row */}
          {data?.meta && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <Stat label="Price" value={formatPrice(data.meta.price, data.meta.currency)} />
              {cagrPrice && (
                <Stat label={`Return (${timeframe})`}
                  value={formatPercent(cagrPrice.return)}
                  color={colorForPercent(cagrPrice.return)} />
              )}
              {cagrPrice && (
                <Stat label={`CAGR (${timeframe})`}
                  value={formatPercent(cagrPrice.cagr)}
                  color={colorForPercent(cagrPrice.cagr)} />
              )}
              {cagrTR && (
                <Stat label={`CAGR + Div (${timeframe})`}
                  value={formatPercent(cagrTR.cagr)}
                  color={colorForPercent(cagrTR.cagr)} />
              )}
              {irrPct != null && (
                <Stat label={`IRR (${timeframe})`}
                  value={formatPercent(irrPct)}
                  color={colorForPercent(irrPct)} />
              )}
              {data.meta.high52w != null && (
                <Stat label="52W High" value={formatPrice(data.meta.high52w, data.meta.currency)} />
              )}
              {data.meta.low52w != null && (
                <Stat label="52W Low" value={formatPrice(data.meta.low52w, data.meta.currency)} />
              )}
              {dividends.length > 0 && (
                <Stat label="Dividends in window"
                  value={`${dividends.length} (${formatPrice(totalDivs, data.meta.currency)})`} />
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-56"><LoadingSpinner size={32} /></div>
          ) : chartData.length > 0 ? (
            <PriceChart data={chartData} color="auto" height={260} isCurrency />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-500 text-sm">
              No price data found. Try a different ticker.
            </div>
          )}

          {/* Dividends list */}
          {dividends.length > 0 && (
            <details className="bg-bg-input rounded-lg px-3 py-2">
              <summary className="text-xs text-gray-300 cursor-pointer">
                {dividends.length} dividend payment{dividends.length === 1 ? '' : 's'} in window
              </summary>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-400 max-h-32 overflow-y-auto">
                {dividends.slice().reverse().map(d => (
                  <div key={d.date} className="flex justify-between">
                    <span>{d.date}</span>
                    <span className="text-gray-200">{d.amount.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[10px] text-gray-700">
            Price-only series excludes dividends; the total-return series reinvests cash dividends on the ex-date.
            IRR treats the start as a buy (cash out) and dividends + final price as cash inflows.
            Source: Yahoo Finance · Not financial advice.
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
      <p className={clsx('text-sm font-bold tabular-nums', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}
