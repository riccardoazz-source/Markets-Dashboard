'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ALL_COMPARABLE_ASSETS } from '@/lib/config';
import { CompareAsset, HistoricalPoint, Timeframe } from '@/lib/types';
import {
  normalizeData, calculateCAGR, formatPercent, colorForPercent,
  CHART_COLORS, getTimeframeStart, buildTotalReturnSeries, computeAssetIRR,
  correlationMatrix,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { CompareChart } from '@/components/charts/CompareChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { X, Search } from 'lucide-react';

const PRESETS = [
  { label: 'Indexes', symbols: ['^GSPC', '^NDX', '^STOXX50E', 'URTH'] },
  { label: 'Crypto', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'] },
  { label: 'Commodities', symbols: ['GC=F', 'SI=F', 'CL=F'] },
  { label: 'Tech Sectors', symbols: ['XLK', 'SOXX', 'AIQ', 'CIBR'] },
];

const TF_OPTIONS: Timeframe[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

interface StockApiResp {
  symbol: string;
  meta: unknown;
  prices: HistoricalPoint[];
  dividends: { date: string; amount: number }[];
}

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
      let data: HistoricalPoint[] = [];
      let dividends: { date: string; amount: number }[] = [];
      if (config?.type === 'crypto') {
        const daysMap: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650 };
        const days = daysMap[tf] ?? 365;
        const coinId = symbol.replace('-USD', '').toLowerCase();
        const coinMap: Record<string, string> = {
          btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
          xrp: 'ripple', ada: 'cardano', avax: 'avalanche-2', link: 'chainlink',
        };
        const id = coinMap[coinId] ?? coinId;
        const cgRes = await fetch(`/api/crypto?mode=historical&id=${id}&days=${days}`);
        if (cgRes.ok) {
          const json = await cgRes.json();
          if (Array.isArray(json) && json.length > 0) data = json as HistoricalPoint[];
        }
        if (!data || data.length === 0) {
          const yhRes = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`);
          if (yhRes.ok) {
            const json = await yhRes.json();
            if (Array.isArray(json) && json.length > 0) data = json as HistoricalPoint[];
          }
        }
        if (!data || data.length === 0) return null;
      } else if (config?.type === 'macro') {
        const from = getTimeframeStart(tf);
        const res = await fetch(`/api/macro?mode=history&id=${encodeURIComponent(symbol)}&from=${from}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) return null;
        data = json as HistoricalPoint[];
      } else {
        // Use the stock endpoint to also pull dividends for stocks/ETFs/sectors
        const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`);
        if (res.ok) {
          const json = await res.json() as StockApiResp;
          if (Array.isArray(json.prices) && json.prices.length > 0) {
            data = json.prices;
            dividends = Array.isArray(json.dividends) ? json.dividends : [];
          }
        }
        if (!data || data.length === 0) {
          const fallback = await fetch(`/api/historical?symbol=${symbol}&timeframe=${tf}`);
          if (fallback.ok) {
            const json = await fallback.json();
            if (Array.isArray(json) && json.length > 0) data = json as HistoricalPoint[];
          }
        }
        if (!data || data.length === 0) return null;
      }

      const cagr = calculateCAGR(data, tf);
      const totalReturnData = dividends.length > 0 ? buildTotalReturnSeries(data, dividends) : data;
      const cagrTR = calculateCAGR(totalReturnData, tf);
      const irr = computeAssetIRR(data, dividends);
      const displayData = normalized
        ? normalizeData(totalReturnData)
        : totalReturnData;

      return {
        symbol,
        name: config?.name ?? symbol,
        type: config?.type ?? 'index',
        color,
        data: displayData,
        rawData: data,
        totalReturnData,
        cagr: cagr?.cagr,
        totalReturn: cagr?.return,
        cagrWithDiv: cagrTR?.cagr,
        irr: irr != null ? irr * 100 : undefined,
        dividends,
      };
    } catch {
      return null;
    }
  }, [normalized]);

  const fetchAll = useCallback(async () => {
    if (selectedSymbols.length === 0) { setAssets([]); return; }
    setLoading(true);
    const results: (CompareAsset | null)[] = [];
    for (let i = 0; i < selectedSymbols.length; i++) {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      let asset = await fetchAsset(selectedSymbols[i], color, timeframe);
      if (!asset) {
        await new Promise(r => setTimeout(r, 1500));
        asset = await fetchAsset(selectedSymbols[i], color, timeframe);
      }
      results.push(asset);
    }
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

  // Build correlation matrix from raw price series
  const correl = useMemo(() => {
    const series = assets
      .filter(a => a.rawData && a.rawData.length > 1)
      .map(a => ({ symbol: a.symbol, data: a.rawData! }));
    return correlationMatrix(series);
  }, [assets]);

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
                className="rounded-xl border p-3 bg-bg-card"
                style={{ borderColor: CHART_COLORS[i % CHART_COLORS.length] + '66' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />
                  <p className="text-sm font-semibold text-gray-100 truncate">{a.name}</p>
                </div>
                {a.totalReturn != null && (
                  <div>
                    <p className="text-[10px] text-gray-500">Return ({timeframe})</p>
                    <p className={clsx('text-base font-bold', colorForPercent(a.totalReturn))}>
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
                {a.cagrWithDiv != null && a.dividends && a.dividends.length > 0 && (
                  <div className="mt-1">
                    <p className="text-[10px] text-gray-500">CAGR + Div</p>
                    <p className={clsx('text-sm font-semibold', colorForPercent(a.cagrWithDiv))}>
                      {formatPercent(a.cagrWithDiv)}
                    </p>
                  </div>
                )}
                {a.irr != null && (
                  <div className="mt-1">
                    <p className="text-[10px] text-gray-500">IRR</p>
                    <p className={clsx('text-sm font-semibold', colorForPercent(a.irr))}>
                      {formatPercent(a.irr)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {correl.labels.length >= 2 && (
            <CorrelationMatrix
              labels={correl.labels}
              matrix={correl.matrix}
              names={Object.fromEntries(assets.map(a => [a.symbol, a.name]))}
            />
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          Select assets to compare
        </div>
      )}
    </div>
  );
}

function corrColor(v: number | null): string {
  if (v == null) return '#1f2233';
  const a = Math.min(1, Math.abs(v));
  if (v >= 0) return `rgba(16, 185, 129, ${0.15 + 0.55 * a})`;
  return `rgba(239, 68, 68, ${0.15 + 0.55 * a})`;
}

function CorrelationMatrix({
  labels, matrix, names,
}: {
  labels: string[];
  matrix: (number | null)[][];
  names: Record<string, string>;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Correlation matrix</h3>
        <p className="text-[10px] text-gray-500">
          Pearson correlation of daily log-returns over the selected timeframe ·
          <span className="text-up-text"> +1 perfectly correlated</span> ·
          <span className="text-down-text"> −1 perfectly inverted</span> · 0 unrelated
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5 min-w-full">
          <thead>
            <tr>
              <th className="text-left text-gray-500 font-medium pr-2"></th>
              {labels.map(l => (
                <th key={l} className="px-2 py-1 text-gray-400 font-mono text-[10px] text-center" title={names[l]}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((row, i) => (
              <tr key={row}>
                <td className="text-gray-300 font-medium pr-2 py-1 whitespace-nowrap" title={row}>
                  {names[row] ?? row}
                </td>
                {labels.map((col, j) => {
                  const v = matrix[i]?.[j];
                  return (
                    <td key={col}
                      className="text-center font-mono text-[11px] tabular-nums px-2 py-1 rounded text-gray-100"
                      style={{ backgroundColor: corrColor(v ?? null), minWidth: 56 }}>
                      {v == null ? '—' : v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
