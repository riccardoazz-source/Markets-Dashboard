'use client';

import { useState, useEffect, useCallback } from 'react';
import { HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPercent, colorForPercent, calculateCAGR } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, Flame, RefreshCw, X } from 'lucide-react';

interface SectorAPIData {
  symbol: string;
  name: string;
  category: string;
  price: number | null;
  changePercent: number | null;
  ytdReturn: number | null;
  oneMonthReturn: number | null;
  threeMonthReturn: number | null;
  oneWeekReturn: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  rank: number;
}

const SORT_OPTIONS = [
  { value: 'ytdReturn',        label: 'YTD'     },
  { value: 'oneMonthReturn',   label: '1M'      },
  { value: 'threeMonthReturn', label: '3M'      },
  { value: 'oneWeekReturn',    label: '1W'      },
  { value: 'cagr3y',           label: '3Y CAGR' },
  { value: 'cagr5y',           label: '5Y CAGR' },
];

export function SectorsSection() {
  const [sectors, setSectors] = useState<SectorAPIData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>('ytdReturn');
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchSectors = useCallback(async () => {
    try {
      const res = await fetch('/api/sectors');
      const data = await res.json() as SectorAPIData[];
      setSectors(Array.isArray(data) ? data : []);
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

  useEffect(() => { fetchSectors(); }, [fetchSectors]);
  useEffect(() => { if (selected) fetchHistorical(selected, timeframe); }, [selected, timeframe, fetchHistorical]);

  const getValue = (s: SectorAPIData) =>
    (s as unknown as Record<string, number | null>)[sortBy] ?? null;

  const sorted = [...sectors]
    .sort((a, b) => (getValue(b) ?? -Infinity) - (getValue(a) ?? -Infinity))
    .map((s, i) => ({ ...s, displayRank: i + 1 }));

  const selectedSector = sectors.find(s => s.symbol === selected);
  const sortLabel = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? sortBy;

  return (
    <div className="space-y-3">
      {/* Sort bar — scrollable on mobile */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
          <p className="text-xs text-gray-500 font-medium shrink-0">Sort:</p>
          <div className="flex gap-1 bg-bg-input rounded-lg p-1 shrink-0">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-600 shrink-0">
          <span>20 sectors · {sortLabel}</span>
          {lastUpdate && (
            <span className="flex items-center gap-1">
              <RefreshCw size={9} />
              {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingGrid count={20} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {sorted.map(sector => {
            const key = getValue(sector);
            const isSelected = selected === sector.symbol;
            const isHot = sector.displayRank <= 2 && (key ?? 0) > 0;

            return (
              <button
                key={sector.symbol}
                onClick={() => setSelected(isSelected ? null : sector.symbol)}
                className={clsx(
                  'relative rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}
              >
                {isHot && (
                  <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-hot text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    <Flame size={8} />HOT
                  </span>
                )}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-bold text-gray-600">#{sector.displayRank}</span>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{sector.category}</span>
                </div>
                <p className="text-sm font-semibold text-gray-100 leading-snug mb-2">{sector.name}</p>

                {/* Primary metric — big and bold */}
                <div className={clsx('flex items-center gap-1 text-base font-bold', colorForPercent(key ?? 0))}>
                  {(key ?? 0) >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {key != null ? formatPercent(key) : 'N/A'}
                </div>

                {/* Secondary metrics */}
                <div className="mt-2 pt-2 border-t border-border grid grid-cols-2 gap-x-2 text-[10px]">
                  {sector.ytdReturn != null && sortBy !== 'ytdReturn' && (
                    <div>
                      <span className="text-gray-600">YTD </span>
                      <span className={colorForPercent(sector.ytdReturn)}>{formatPercent(sector.ytdReturn, 1)}</span>
                    </div>
                  )}
                  {sector.oneMonthReturn != null && sortBy !== 'oneMonthReturn' && (
                    <div>
                      <span className="text-gray-600">1M </span>
                      <span className={colorForPercent(sector.oneMonthReturn)}>{formatPercent(sector.oneMonthReturn, 1)}</span>
                    </div>
                  )}
                  {sector.cagr3y != null && sortBy !== 'cagr3y' && (
                    <div>
                      <span className="text-gray-600">3Y </span>
                      <span className={colorForPercent(sector.cagr3y)}>{formatPercent(sector.cagr3y, 1)}</span>
                    </div>
                  )}
                  {sector.cagr5y != null && sortBy !== 'cagr5y' && (
                    <div>
                      <span className="text-gray-600">5Y </span>
                      <span className={colorForPercent(sector.cagr5y)}>{formatPercent(sector.cagr5y, 1)}</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedSector && (
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white">{selectedSector.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{selectedSector.symbol} · {selectedSector.category}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <TimeframeSelector value={timeframe} onChange={setTimeframe} />
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {selectedSector.price != null && (
              <Stat label="Price" value={`$${selectedSector.price.toFixed(2)}`} />
            )}
            {selectedSector.ytdReturn != null && (
              <Stat label="YTD" value={formatPercent(selectedSector.ytdReturn)} color={colorForPercent(selectedSector.ytdReturn)} />
            )}
            {selectedSector.oneWeekReturn != null && (
              <Stat label="1W" value={formatPercent(selectedSector.oneWeekReturn)} color={colorForPercent(selectedSector.oneWeekReturn)} />
            )}
            {selectedSector.oneMonthReturn != null && (
              <Stat label="1M" value={formatPercent(selectedSector.oneMonthReturn)} color={colorForPercent(selectedSector.oneMonthReturn)} />
            )}
            {selectedSector.threeMonthReturn != null && (
              <Stat label="3M" value={formatPercent(selectedSector.threeMonthReturn)} color={colorForPercent(selectedSector.threeMonthReturn)} />
            )}
            {selectedSector.cagr3y != null && (
              <Stat label="3Y CAGR" value={formatPercent(selectedSector.cagr3y)} color={colorForPercent(selectedSector.cagr3y)} />
            )}
            {selectedSector.cagr5y != null && (
              <Stat label="5Y CAGR" value={formatPercent(selectedSector.cagr5y)} color={colorForPercent(selectedSector.cagr5y)} />
            )}
            {cagrData && (
              <Stat label={`CAGR ${timeframe}`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
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
