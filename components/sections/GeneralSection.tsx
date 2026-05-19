'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import clsx from 'clsx';
import { SECTORS } from '@/lib/config';
import { SECTOR_FILTERS, tidyLayerName } from '@/lib/sectorValueChain';
import { formatPercent, formatMarketCap } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RefreshCw, X, ArrowDown, ArrowUp } from 'lucide-react';

// -------------- Types ----------------------------------------------------

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

// -------------- Heatmap color scale --------------------------------------
// Bucketed by absolute P/E so colors stay comparable across refreshes.
// Negative or null PE → neutral gray (loss-making / no earnings).
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
            Click a sector to see its value chain — companies are filtered from the live S&P 500 list and stacked by GICS sub-industry. Layers and constituents evolve as the index rebalances.
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

        {selectedEtf && rows.length > 0 && (
          <ValueChain etf={selectedEtf} allRows={rows} onClose={() => setSelectedEtf(null)} />
        )}
      </div>
    </div>
  );
}

// -------------- Value Chain panel ---------------------------------------

interface Layer {
  industry: string;
  items: Sp500Row[];
  totalMCap: number;
}

function buildLayers(etf: string, rows: Sp500Row[]): Layer[] {
  const filter = SECTOR_FILTERS[etf];
  if (!filter) return [];

  let matching: Sp500Row[];
  if (filter.gicsSector) {
    const target = filter.gicsSector.toLowerCase();
    matching = rows.filter(r => r.sector?.toLowerCase() === target);
  } else if (filter.subIndustryMatch?.length) {
    const needles = filter.subIndustryMatch.map(s => s.toLowerCase());
    matching = rows.filter(r => {
      const si = r.subIndustry?.toLowerCase() ?? '';
      return needles.some(n => si.includes(n));
    });
  } else {
    matching = [];
  }

  const groups = new Map<string, Sp500Row[]>();
  for (const r of matching) {
    const key = r.subIndustry || 'Other';
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  return Array.from(groups.entries())
    .map(([industry, items]) => ({
      industry,
      items: items.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)),
      totalMCap: items.reduce((s, i) => s + (i.marketCap ?? 0), 0),
    }))
    .sort((a, b) => b.totalMCap - a.totalMCap);
}

function ValueChain({ etf, allRows, onClose }: { etf: string; allRows: Sp500Row[]; onClose: () => void }) {
  const sector = SECTORS.find(s => s.symbol === etf);
  const filter = SECTOR_FILTERS[etf];
  const layers = useMemo(() => buildLayers(etf, allRows), [etf, allRows]);
  const totalCompanies = layers.reduce((s, l) => s + l.items.length, 0);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-white">
            {sector?.name ?? etf} · Value Chain
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {filter?.description ?? `${sector?.name ?? etf} companies grouped by GICS sub-industry`}
            {totalCompanies > 0 && ` · ${totalCompanies} S&P 500 companies in ${layers.length} layer${layers.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-border transition"
          aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {!filter ? (
        <p className="text-sm text-gray-500 py-4">No value-chain definition for {etf} yet.</p>
      ) : layers.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No matching S&P 500 companies for this filter.</p>
      ) : (
        <div className="space-y-3">
          {layers.map(g => (
            <div key={g.industry} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-bg px-3 py-1.5 flex items-baseline justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-white uppercase tracking-wide">
                  {tidyLayerName(g.industry)}
                </span>
                <span className="text-[10px] text-gray-500">
                  {g.items.length} {g.items.length === 1 ? 'company' : 'companies'} · {formatMarketCap(g.totalMCap)} combined MCap
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
                      <span className="text-gray-500">P/E TTM</span>
                      <span className={clsx('font-semibold', h.trailingPE != null && h.trailingPE > 0 ? 'text-sky-400' : 'text-gray-600')}>
                        {h.trailingPE != null && h.trailingPE > 0 ? h.trailingPE.toFixed(1) : '—'}
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
