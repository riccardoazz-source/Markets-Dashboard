'use client';

import { useState, useEffect, useCallback } from 'react';
import { ALL_COMPARABLE_ASSETS } from '@/lib/config';
import { CompareAsset, HistoricalPoint, Timeframe } from '@/lib/types';
import { normalizeData, calculateCAGR, formatPercent, colorForPercent, CHART_COLORS } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { CompareChart } from '@/components/charts/CompareChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { Plus, X, Search } from 'lucide-react';

const PRESETS = [
  { label: 'Indexes', symbols: ['^GSPC', '^NDX', '^STOXX50E', 'URTH'] },
  { label: 'Crypto', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'] },
  { label: 'Commodities', symbols: ['GC=F', 'SI=F', 'CL=F'] },
  { label: 'Tech Sectors', symbols: ['XLK', 'SOXX', 'AIQ', 'CIBR'] },
];

const TF_OPTIONS: Timeframe[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y'];

export function CompareSection() {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(['^GSPC', '^NDX', 'GC=F']);
  const [assets, setAssets] = useState<CompareAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [normalized, setNormalized] = useState(true);

  const fetchAsset = useCallback(async (symbol: string, color: string, tf: Timeframe): Promise<CompareAsset | null> => {
    const config = ALL_COMPARABLE_ASSETS.find(a => a.symbol === symbol);

    try {
      let data: HistoricalPoint[];
      if (config?.type === 'crypto') {
        const daysMap: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650 };
        const days = daysMap[tf] ?? 365;
        const coinId = symbol.replace('-USD', '').toLowerCase();
        const coinMap: Record<string, string> = {
          btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
          xrp: 'ripple', ada: 'cardano', avax: 'avalanche-2', link: 'chainlink',
        };
        const id = coinMap[coinId] ?? coinId;
        const res = await fetch(`/api/crypto?mode=historical&id=${id}&days=${days}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) return null;
        data = json as HistoricalPoint[];
      } else {
        const res = await fetch(`/api/historical?symbol=${symbol}&timeframe=${tf}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) return null;
        data = json as HistoricalPoint[];
      }

      const cagr = calculateCAGR(data, tf);
      const displayData = normalized ? normalizeData(data) : data;

      return {
        symbol,
        name: config?.name ?? symbol,
        type: config?.type ?? 'index',
        color,
        data: displayData,
        cagr: cagr?.cagr,
        totalReturn: cagr?.return,
      };
    } catch {
      return null;
    }
  }, [normalized]);

  const fetchAll = useCallback(async () => {
    if (selectedSymbols.length === 0) { setAssets([]); return; }
    setLoading(true);
    const results = await Promise.all(
      selectedSymbols.map((s, i) => fetchAsset(s, CHART_COLORS[i % CHART_COLORS.length], timeframe))
    );
    setAssets(results.filter(Boolean) as CompareAsset[]);
    setLoading(false);
  }, [selectedSymbols, timeframe, fetchAsset]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addSymbol = (symbol: string) => {
    if (selectedSymbols.includes(symbol) || selectedSymbols.length >= 8) return;
    setSelectedSymbols(prev => [...prev, symbol]);
    setSearch('');
  };

  const removeSymbol = (symbol: string) => {
    setSelectedSymbols(prev => prev.filter(s => s !== symbol));
  };

  const loadPreset = (preset: typeof PRESETS[0]) => {
    setSelectedSymbols(preset.symbols);
  };

  const filteredAssets = ALL_COMPARABLE_ASSETS.filter(a =>
    !selectedSymbols.includes(a.symbol) &&
    (a.name.toLowerCase().includes(search.toLowerCase()) ||
     a.symbol.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => loadPreset(p)}
              className="px-3 py-1 text-xs font-medium rounded-full border border-border text-gray-400 hover:text-gray-100 hover:border-border-light transition-all">
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNormalized(n => !n)}
            className={clsx('px-3 py-1 text-xs font-medium rounded-full transition-all border',
              normalized ? 'border-accent text-accent bg-accent/10' : 'border-border text-gray-400 hover:text-gray-200'
            )}>
            {normalized ? 'Normalized (Base 100)' : 'Absolute Price'}
          </button>
          <TimeframeSelector value={timeframe} onChange={setTimeframe} options={TF_OPTIONS} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {selectedSymbols.map((s, i) => {
          const conf = ALL_COMPARABLE_ASSETS.find(a => a.symbol === s);
          return (
            <div key={s} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '33', border: `1px solid ${CHART_COLORS[i % CHART_COLORS.length]}66` }}>
              <span style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>●</span>
              {conf?.name ?? s}
              <button onClick={() => removeSymbol(s)} className="ml-1 opacity-70 hover:opacity-100">
                <X size={11} />
              </button>
            </div>
          );
        })}
        {selectedSymbols.length < 8 && (
          <div className="relative">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-border text-xs text-gray-500">
              <Search size={11} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Add asset…"
                className="bg-transparent outline-none text-gray-200 w-24"
              />
            </div>
            {search.length > 0 && filteredAssets.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-bg-card border border-border rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                {filteredAssets.map(a => (
                  <button key={a.symbol} onClick={() => addSymbol(a.symbol)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-bg-hover text-left">
                    <span className="text-gray-100">{a.name}</span>
                    <span className="text-gray-500 ml-2">{a.symbol}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-3">
            <LoadingSpinner size={36} />
            <p className="text-xs text-gray-500">Loading comparison data…</p>
          </div>
        </div>
      ) : assets.length > 0 ? (
        <>
          <div className="rounded-xl border border-border bg-bg-card p-4">
            <CompareChart assets={assets} height={360} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {assets.map((a, i) => (
              <div key={a.symbol}
                className="rounded-xl border p-4 bg-bg-card"
                style={{ borderColor: CHART_COLORS[i % CHART_COLORS.length] + '66' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />
                  <p className="text-sm font-semibold text-gray-100 truncate">{a.name}</p>
                </div>
                {a.totalReturn != null && (
                  <div>
                    <p className="text-[10px] text-gray-500">Return ({timeframe})</p>
                    <p className={clsx('text-lg font-bold', colorForPercent(a.totalReturn))}>
                      {formatPercent(a.totalReturn)}
                    </p>
                  </div>
                )}
                {a.cagr != null && (
                  <div className="mt-1">
                    <p className="text-[10px] text-gray-500">CAGR</p>
                    <p className={clsx('text-sm font-semibold', colorForPercent(a.cagr))}>
                      {formatPercent(a.cagr)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          Select assets to compare
        </div>
      )}
    </div>
  );
}
