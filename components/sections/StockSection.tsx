'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import {
  calculateCAGR, formatPercent, formatPrice, colorForPercent,
  buildTotalReturnSeries, computeAssetIRR, DividendEvent,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';

const TF_OPTIONS: Timeframe[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface SearchHit { symbol: string; name: string; exchange: string; type: string }
interface StockData {
  symbol: string;
  meta: { price: number; previousClose: number; currency: string; high52w: number | null; low52w: number | null } | null;
  prices: HistoricalPoint[];
  dividends: DividendEvent[];
}

function formatXDate(dateStr: string, data: HistoricalPoint[]) {
  try {
    const d = parseISO(dateStr);
    if (data.length < 2) return format(d, 'MMM d');
    const span = (new Date(data[data.length - 1].date).getTime() - new Date(data[0].date).getTime()) / (365.25 * 86400 * 1000);
    if (span < 0.5) return format(d, 'MMM d');
    if (span < 4) return format(d, "MMM ''yy");
    return format(d, 'yyyy');
  } catch { return dateStr; }
}

function DualChart({ prices, totalReturn, currency }: { prices: HistoricalPoint[]; totalReturn: HistoricalPoint[]; currency: string }) {
  if (!prices.length) return null;
  const hasDivs = totalReturn !== prices && totalReturn.length > 0 &&
    Math.abs((totalReturn[totalReturn.length - 1]?.close ?? 0) - (prices[prices.length - 1]?.close ?? 0)) > 0.0001;

  // Align on same date union
  const allDates = Array.from(new Set([...prices, ...totalReturn].map(d => d.date))).sort();
  const priceMap = new Map(prices.map(d => [d.date, d.close]));
  const trMap = new Map(totalReturn.map(d => [d.date, d.close]));
  const chartData = allDates.map(date => ({
    date,
    price: priceMap.get(date) ?? null,
    tr: hasDivs ? (trMap.get(date) ?? null) : undefined,
  }));

  const decimals = (prices[prices.length - 1]?.close ?? 0) < 10 ? 2 : 2;
  const isUp = (prices[prices.length - 1]?.close ?? 0) >= (prices[0]?.close ?? 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis dataKey="date" tickFormatter={d => formatXDate(d as string, prices)}
          tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={50} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={64}
          tickFormatter={v => {
            const n = v as number;
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return n.toFixed(decimals);
          }}
          domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
          formatter={(value: number, name: string) => {
            const label = name === 'price' ? 'Price' : 'Total Return (incl. div.)';
            return [formatPrice(value, currency), label];
          }}
          labelFormatter={label => { try { return format(parseISO(label as string), 'MMM d, yyyy'); } catch { return label as string; } }}
        />
        <Line type="monotone" dataKey="price" stroke={isUp ? '#10b981' : '#ef4444'}
          strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls name="price" />
        {hasDivs && (
          <Line type="monotone" dataKey="tr" stroke={isUp ? '#34d399' : '#f87171'}
            strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4 }} connectNulls name="tr" />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StockSection() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('5Y');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || selected) { setHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stock?mode=search&q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setHits(Array.isArray(json) ? json as SearchHit[] : []);
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, selected]);

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
      setData(await res.json() as StockData);
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

  const clearSelection = () => { setSelected(null); setData(null); setQuery(''); setHits([]); };

  const prices = data?.prices ?? [];
  const dividends = data?.dividends ?? [];
  const totalReturn = dividends.length > 0 ? buildTotalReturnSeries(prices, dividends) : prices;
  const cagrPrice = calculateCAGR(prices, timeframe);
  // IRR = annualized total-return CAGR (CAGR of the total-return series)
  const cagrTR = calculateCAGR(totalReturn, timeframe);
  // Newton-Raphson IRR (only shown when dividends exist and period > 1 Y)
  const nrIRR = dividends.length > 0 ? computeAssetIRR(prices, dividends) : null;
  const currency = data?.meta?.currency ?? 'USD';
  const totalDivs = dividends.reduce((s, d) => d.date >= (prices[0]?.date ?? '') ? s + d.amount : s, 0);

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 bg-bg-card border border-border rounded-xl px-3 py-2">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input type="text" value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search by ticker (AAPL, KO, ENI.MI), ISIN (US0378331005) or name…"
            className="bg-transparent outline-none text-gray-100 placeholder-gray-600 text-sm flex-1" />
          {selected && <button onClick={clearSelection} className="p-0.5 text-gray-500 hover:text-gray-300 shrink-0"><X size={14} /></button>}
          {searching && <span className="text-[10px] text-gray-500 animate-pulse shrink-0">…</span>}
        </div>
        {showDropdown && hits.length > 0 && !selected && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-lg shadow-xl z-30 max-h-72 overflow-y-auto">
            {hits.map(h => (
              <button key={h.symbol} onClick={() => pickHit(h)}
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
      </div>

      {!selected && (
        <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-gray-500">
          Search a stock by ticker (e.g. <span className="text-gray-300 font-mono">AAPL</span>,{' '}
          <span className="text-gray-300 font-mono">KO</span>,{' '}
          <span className="text-gray-300 font-mono">ENI.MI</span>) or by ISIN
          (e.g. <span className="text-gray-300 font-mono">US0378331005</span>).
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
                {data?.meta?.currency ? ` · ${data.meta.currency}` : ''}
              </p>
            </div>
            <TimeframeSelector value={timeframe} onChange={setTimeframe} options={TF_OPTIONS} />
          </div>

          {/* Legend for dual lines */}
          {dividends.length > 0 && !loading && prices.length > 0 && (
            <div className="flex items-center gap-4 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="w-6 h-0.5 bg-emerald-400 inline-block" />
                <span className="text-gray-400">Price</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-6 border-t-2 border-dashed border-emerald-300 inline-block" />
                <span className="text-gray-400">Total Return (reinvested div.)</span>
              </div>
            </div>
          )}

          {/* Stats */}
          {data?.meta && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <Stat label="Price" value={formatPrice(data.meta.price, currency)} />
              {cagrPrice && (
                <Stat label={`Return (${timeframe})`} value={formatPercent(cagrPrice.return)} color={colorForPercent(cagrPrice.return)} />
              )}
              {cagrPrice && (
                <Stat label={`CAGR (${timeframe})`} value={formatPercent(cagrPrice.cagr)} color={colorForPercent(cagrPrice.cagr)} />
              )}
              {cagrTR && dividends.length > 0 && (
                <Stat label={`IRR (${timeframe})`} value={formatPercent(cagrTR.cagr)} color={colorForPercent(cagrTR.cagr)} />
              )}
              {nrIRR != null && (
                <Stat label="IRR (cash flow)" value={formatPercent(nrIRR * 100)} color={colorForPercent(nrIRR * 100)} />
              )}
              {data.meta.high52w != null && <Stat label="52W High" value={formatPrice(data.meta.high52w, currency)} />}
              {data.meta.low52w != null && <Stat label="52W Low" value={formatPrice(data.meta.low52w, currency)} />}
              {dividends.length > 0 && (
                <Stat label="Dividends (period)" value={`${dividends.length} (${formatPrice(totalDivs, currency)})`} />
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-56"><LoadingSpinner size={32} /></div>
          ) : prices.length > 0 ? (
            <DualChart prices={prices} totalReturn={totalReturn} currency={currency} />
          ) : (
            <div className="flex items-center justify-center h-44 text-gray-500 text-sm">
              No data found. Try a different ticker.
            </div>
          )}

          {dividends.length > 0 && (
            <details className="bg-bg-input rounded-lg px-3 py-2">
              <summary className="text-xs text-gray-300 cursor-pointer">
                {dividends.length} dividends in period — total {formatPrice(totalDivs, currency)}
              </summary>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-400 max-h-32 overflow-y-auto">
                {dividends.slice().reverse().map(d => (
                  <div key={d.date + d.amount} className="flex justify-between">
                    <span>{d.date}</span>
                    <span className="text-gray-200">{d.amount.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[10px] text-gray-700">
            Solid line = price · Dashed line = total return (dividends reinvested at ex-date).
            IRR ({timeframe}) = CAGR of the total-return series · IRR (cash flow) = rate that zeros the NPV of discrete cashflows.
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
