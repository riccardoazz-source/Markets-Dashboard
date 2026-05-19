'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import clsx from 'clsx';
import { SECTORS } from '@/lib/config';
import { formatPercent, formatMarketCap } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RefreshCw, X, ArrowDown, ArrowUp } from 'lucide-react';

// -------------- Types from the new APIs ----------------------------------

interface Sp500Row {
  symbol: string;
  name: string;
  sector: string;
  subIndustry: string;
  price: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  changePercent: number | null;
}

interface Holding {
  symbol: string;
  name: string;
  weight: number | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  changePercent: number | null;
  trailingPE: number | null;
  marketCap: number | null;
}

// -------------- Heatmap color scale --------------------------------------
// Sorted-by-PE ranks map to a green→red gradient. We bucket by absolute PE
// value (not rank) so the colors stay comparable across refreshes:
//   PE ≤ 8   → very-dark-green (deep value)
//   PE 8-15  → green
//   PE 15-22 → lime
//   PE 22-30 → yellow
//   PE 30-45 → orange
//   PE 45-80 → red
//   PE > 80  → very-dark-red
// Stocks without PE (no earnings / negative) get neutral gray.
function colorForPE(pe: number | null): string {
  if (pe == null || !isFinite(pe) || pe <= 0) return 'bg-slate-700/50 text-slate-400';
  if (pe <= 8)   return 'bg-emerald-700 text-emerald-50';
  if (pe <= 15)  return 'bg-emerald-600 text-emerald-50';
  if (pe <= 22)  return 'bg-lime-600 text-lime-50';
  if (pe <= 30)  return 'bg-amber-500 text-amber-50';
  if (pe <= 45)  return 'bg-orange-600 text-orange-50';
  if (pe <= 80)  return 'bg-red-600 text-red-50';
  return 'bg-red-800 text-red-50';
}

// -------------- Section --------------------------------------------------

type SortMode = 'pe-asc' | 'pe-desc' | 'mcap-desc';
type PeMode = 'trailing' | 'forward';

export function GeneralSection() {
  const [rows, setRows] = useState<Sp500Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>('pe-desc');
  const [peMode, setPeMode] = useState<PeMode>('trailing');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedEtf, setSelectedEtf] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch('/api/sp500');
      const data = await res.json() as Sp500Row[];
      if (Array.isArray(data)) {
        setRows(data);
        setLastUpdate(new Date());
      }
    } catch (e) {
      console.error('sp500 fetch', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
    const t = setInterval(fetchRows, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchRows]);

  const peKey: 'trailingPE' | 'forwardPE' = peMode === 'forward' ? 'forwardPE' : 'trailingPE';

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortMode === 'mcap-desc') {
      copy.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    } else {
      const dir = sortMode === 'pe-desc' ? -1 : 1;
      copy.sort((a, b) => {
        const av = a[peKey];
        const bv = b[peKey];
        const aN = av == null || av <= 0;
        const bN = bv == null || bv <= 0;
        if (aN && bN) return 0;
        if (aN) return 1;
        if (bN) return -1;
        return dir * ((av as number) - (bv as number));
      });
    }
    return copy;
  }, [rows, sortMode, peKey]);

  const validPECount = rows.filter(r => {
    const v = r[peKey];
    return v != null && v > 0;
  }).length;

  return (
    <div className="space-y-6">
      {/* HEATMAP -------------------------------------------------------- */}
      <div className="bg-card border border-border rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">
              S&P 500 · P/E {peMode === 'forward' ? 'Forward' : 'Trailing'} Heatmap
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {rows.length > 0
                ? `${rows.length} constituents · ${validPECount} with ${peMode} P/E`
                : 'Loading constituents...'}
              {lastUpdate && ` · updated ${lastUpdate.toLocaleTimeString()}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-bg border border-border rounded-md overflow-hidden text-[11px]">
              {([
                ['trailing', 'TTM'],
                ['forward',  'Fwd'],
              ] as const).map(([v, l]) => (
                <button key={v} onClick={() => setPeMode(v)}
                  className={clsx('px-2.5 py-1 font-medium transition',
                    peMode === v ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex bg-bg border border-border rounded-md overflow-hidden text-[11px]">
              {([
                ['pe-desc', 'P/E ↓'],
                ['pe-asc',  'P/E ↑'],
                ['mcap-desc', 'MCap'],
              ] as const).map(([v, l]) => (
                <button key={v} onClick={() => setSortMode(v)}
                  className={clsx('px-2.5 py-1 font-medium transition',
                    sortMode === v ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={fetchRows}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-border transition"
              aria-label="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Color legend */}
        <div className="flex items-center gap-1 mb-2 text-[10px] text-gray-500 flex-wrap">
          <span className="mr-1">P/E:</span>
          {[
            ['≤8', 'bg-emerald-700'],
            ['8-15', 'bg-emerald-600'],
            ['15-22', 'bg-lime-600'],
            ['22-30', 'bg-amber-500'],
            ['30-45', 'bg-orange-600'],
            ['45-80', 'bg-red-600'],
            ['>80', 'bg-red-800'],
            ['n/a', 'bg-slate-700/50'],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1">
              <span className={clsx('w-3 h-3 rounded-sm', color)} />
              {label}
            </span>
          ))}
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : (
          <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-14 gap-1">
            {sorted.map(r => {
              const pe = r[peKey];
              return (
                <div key={r.symbol}
                  title={`${r.name}\n${r.sector} · ${r.subIndustry}\nP/E ${peMode === 'forward' ? 'Fwd' : 'TTM'}: ${pe != null && pe > 0 ? pe.toFixed(1) : 'n/a'}${r.marketCap ? `\nMCap: ${formatMarketCap(r.marketCap)}` : ''}${r.changePercent != null ? `\nDay: ${formatPercent(r.changePercent)}` : ''}`}
                  className={clsx(
                    'rounded-md px-1.5 py-1 flex flex-col items-center justify-center text-center min-h-[44px] transition hover:scale-105 hover:z-10 cursor-default',
                    colorForPE(pe),
                  )}>
                  <span className="text-[10px] sm:text-[11px] font-bold leading-tight truncate w-full">
                    {r.symbol}
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-semibold leading-tight">
                    {pe != null && pe > 0 ? pe.toFixed(0) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTORS GRID --------------------------------------------------- */}
      <div className="bg-card border border-border rounded-xl p-3 sm:p-4">
        <div className="mb-3">
          <h2 className="text-sm sm:text-base font-bold text-white">Sectors · Value Chains</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Click any sector to see its live value chain (top constituents grouped by industry).
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {SECTORS.map(s => (
            <button key={s.symbol}
              onClick={() => setSelectedEtf(selectedEtf === s.symbol ? null : s.symbol)}
              className={clsx(
                'border rounded-lg p-2.5 text-left transition',
                selectedEtf === s.symbol
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg hover:border-gray-600',
              )}>
              <div className="flex items-baseline justify-between gap-1">
                <span className="font-bold text-white text-xs">{s.symbol}</span>
                <span className="text-[10px] text-gray-500 uppercase">{s.category}</span>
              </div>
              <div className="text-[11px] text-gray-300 truncate mt-0.5">{s.name}</div>
            </button>
          ))}
        </div>

        {selectedEtf && (
          <ValueChain etf={selectedEtf} onClose={() => setSelectedEtf(null)} />
        )}
      </div>
    </div>
  );
}

// -------------- Value Chain panel ---------------------------------------

function ValueChain({ etf, onClose }: { etf: string; onClose: () => void }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setHoldings([]);
    fetch(`/api/etf-holdings?etf=${encodeURIComponent(etf)}`)
      .then(r => r.json() as Promise<Holding[] | { error?: string }>)
      .then(d => {
        if (Array.isArray(d)) {
          if (!d.length) setError('No holdings data available for this ETF.');
          setHoldings(d);
        } else {
          setError(d?.error ?? 'Failed to load holdings.');
        }
      })
      .catch(() => setError('Failed to load holdings.'))
      .finally(() => setLoading(false));
  }, [etf]);

  const sector = SECTORS.find(s => s.symbol === etf);

  // Group by `industry` (GICS sub-industry from assetProfile). This produces
  // the "layered" view like the Data Centre value chain — companies stack into
  // rows by their role/sub-industry, which evolves as Yahoo reclassifies them.
  const groups = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const h of holdings) {
      const key = h.industry ?? 'Other';
      const arr = map.get(key) ?? [];
      arr.push(h);
      map.set(key, arr);
    }
    // Sort layers by total weight (largest layer first)
    return Array.from(map.entries())
      .map(([industry, items]) => ({
        industry,
        items: items.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
        totalWeight: items.reduce((s, i) => s + (i.weight ?? 0), 0),
      }))
      .sort((a, b) => b.totalWeight - a.totalWeight);
  }, [holdings]);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-white">
            {sector?.name ?? etf} Value Chain
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Live top holdings of <span className="font-mono text-gray-400">{etf}</span> grouped by GICS industry · refreshes with the ETF&apos;s composition
          </p>
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-border transition"
          aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : error ? (
        <p className="text-sm text-gray-500 py-4">{error}</p>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <div key={g.industry} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-bg px-3 py-1.5 flex items-baseline justify-between">
                <span className="text-xs font-bold text-white uppercase tracking-wide">
                  {g.industry}
                </span>
                <span className="text-[10px] text-gray-500">
                  {g.items.length} {g.items.length === 1 ? 'company' : 'companies'} · {(g.totalWeight * 100).toFixed(1)}% of {etf}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 p-2">
                {g.items.map(h => (
                  <div key={h.symbol} className="border border-border rounded-md p-2 bg-bg/40">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="font-bold text-white text-sm">{h.symbol}</span>
                      {h.changePercent != null && (
                        <span className={clsx(
                          'text-[10px] font-semibold flex items-center gap-0.5',
                          h.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400',
                        )}>
                          {h.changePercent >= 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                          {Math.abs(h.changePercent).toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate" title={h.name}>{h.name}</div>
                    <div className="flex items-baseline justify-between mt-1.5 text-[10px]">
                      <span className="text-gray-500">P/E</span>
                      <span className={clsx('font-semibold', h.trailingPE != null && h.trailingPE > 0 ? 'text-sky-400' : 'text-gray-600')}>
                        {h.trailingPE != null && h.trailingPE > 0 ? h.trailingPE.toFixed(1) : '—'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-[10px]">
                      <span className="text-gray-500">Weight</span>
                      <span className="font-semibold text-gray-300">
                        {h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    {h.marketCap != null && (
                      <div className="flex items-baseline justify-between text-[10px]">
                        <span className="text-gray-500">MCap</span>
                        <span className="font-semibold text-gray-300">{formatMarketCap(h.marketCap)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
