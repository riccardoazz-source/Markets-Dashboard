'use client';

import { useState, useEffect, useCallback } from 'react';
import { SECTORS } from '@/lib/config';
import { HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPercent, formatPrice, colorForPercent, calculateCAGR, dataAvailabilityMessage } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, Flame, RefreshCw, X } from 'lucide-react';

interface SectorLiveData {
  price: number | null;
  changePercent: number | null;
  oneYearReturn: number | null;
  ytdReturn: number | null;
  mtdReturn: number | null;
  high52w: number | null;
  low52w: number | null;
}

// Seed grid immediately from static config — never empty
const INITIAL: SectorLiveData = {
  price: null, changePercent: null, oneYearReturn: null, ytdReturn: null, mtdReturn: null,
  high52w: null, low52w: null,
};

type SectorSortKey = 'changePercent' | 'mtdReturn' | 'ytdReturn';

const SORT_OPTIONS: { value: SectorSortKey; label: string }[] = [
  { value: 'changePercent', label: 'Day' },
  { value: 'mtdReturn',     label: 'MTD' },
  { value: 'ytdReturn',     label: 'YTD' },
];

export function SectorsSection({ jumpTo }: { jumpTo?: string | null }) {
  const [live, setLive] = useState<Record<string, SectorLiveData>>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SectorSortKey>('changePercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  const fetchSectors = useCallback(async () => {
    try {
      const res = await fetch('/api/sectors');
      const data = await res.json() as Array<{
        symbol: string;
        price: number | null;
        changePercent: number | null;
        oneYearReturn: number | null;
        ytdReturn: number | null;
        mtdReturn: number | null;
        high52w: number | null;
        low52w: number | null;
      }>;
      if (Array.isArray(data) && data.length > 0) {
        const map: Record<string, SectorLiveData> = {};
        data.forEach(d => { map[d.symbol] = d; });
        setLive(map);
        setLastUpdate(new Date());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistorical = useCallback(async (
    symbol: string, tf: Timeframe, override?: { from: string; to: string }
  ) => {
    setHistLoading(true);
    try {
      const url = override
        ? `/api/historical?symbol=${symbol}&timeframe=${tf}&from=${override.from}&to=${override.to}`
        : `/api/historical?symbol=${symbol}&timeframe=${tf}`;
      const raw = await fetch(url).then(r => r.json()) as HistoricalPoint[];
      const data = Array.isArray(raw) ? raw : [];
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
      setDataMsg(dataAvailabilityMessage(data, tf));
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSectors();
    const id = setInterval(fetchSectors, 60_000);
    return () => clearInterval(id);
  }, [fetchSectors]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchHistorical]);

  useEffect(() => {
    if (jumpTo) setSelected(jumpTo);
  }, [jumpTo]);

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

  // Merge static config with live data — always renders every sector
  const merged = SECTORS.map(s => ({
    symbol: s.symbol,
    name: s.name,
    category: s.category,
    ...(live[s.symbol] ?? INITIAL),
  }));

  const getValue = (s: typeof merged[0]) =>
    (s as unknown as Record<string, number | null>)[sortBy] ?? null;

  const sorted = [...merged]
    .sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    })
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const selectedSector = merged.find(s => s.symbol === selected);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-600">{SECTORS.length} sectors</span>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex gap-1 bg-bg-input rounded-lg p-1">
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'
                )}>
                {opt.label}
              </button>
            ))}
          </div>
          {loading && <span className="text-accent animate-pulse text-[10px]">updating…</span>}
          {lastUpdate && !loading && (
            <span className="flex items-center gap-1 text-[10px] text-gray-600">
              <RefreshCw size={9} />{lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
        {sorted.map(sector => {
          const day = sector.changePercent;
          const ytd = sector.ytdReturn;
          const primary = getValue(sector);
          const isHot = sector.rank <= 2 && (day ?? 0) > 0;
          const isSelected = selected === sector.symbol;

          return (
            <button key={sector.symbol}
              onClick={() => setSelected(isSelected ? null : sector.symbol)}
              className={clsx(
                'relative rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
              )}>
              {isHot && (
                <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-hot text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  <Flame size={8} />HOT
                </span>
              )}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-bold text-gray-600">#{sector.rank}</span>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">{sector.category}</span>
              </div>
              <p className="text-sm font-semibold text-gray-100 leading-snug mb-2">{sector.name}</p>

              {sector.price != null ? (
                <>
                  <p className="text-lg font-bold text-white tabular-nums">${sector.price.toFixed(2)}</p>
                  <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold',
                    day != null ? colorForPercent(day) : 'text-gray-500')}>
                    {day != null
                      ? <>{(day >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>)} {formatPercent(day)} <span className="text-[10px] font-medium opacity-70">day</span></>
                      : '—'
                    }
                  </div>
                  {sector.mtdReturn != null && (
                    <p className={clsx('text-[10px] mt-0.5', colorForPercent(sector.mtdReturn))}>
                      MTD: {formatPercent(sector.mtdReturn, 1)}
                    </p>
                  )}
                  {ytd != null && (
                    <p className={clsx('text-[10px] mt-0.5', colorForPercent(ytd))}>
                      YTD: {formatPercent(ytd, 1)}
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-2 space-y-1.5">
                  <div className="h-5 bg-border rounded animate-pulse w-16" />
                  <div className="h-3 bg-border rounded animate-pulse w-12" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selected && selectedSector && (
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white">{selectedSector.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{selectedSector.symbol} · {selectedSector.category}</p>
            </div>
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300 shrink-0"><X size={16} /></button>
          </div>
          <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
            <TimeframeSelector
              value={timeframe}
              onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
              isCustom={!!customRange}
              onCustomRange={(from, to) => setCustomRange({ from, to })}
            />
          </div>

          {dataMsg && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              ⚠ {dataMsg}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {selectedSector.price != null && <Stat label="Price" value={`$${selectedSector.price.toFixed(2)}`} />}
            {selectedSector.changePercent != null && <Stat label="Day" value={formatPercent(selectedSector.changePercent)} color={colorForPercent(selectedSector.changePercent)} />}
            {selectedSector.ytdReturn != null && <Stat label="YTD" value={formatPercent(selectedSector.ytdReturn)} color={colorForPercent(selectedSector.ytdReturn)} />}
            {cagrData && <>
              <Stat label={`Return ${timeframe}`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
              <Stat label={`CAGR ${timeframe}`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
            </>}
            {selectedSector.high52w != null && <Stat label="52W High" value={formatPrice(selectedSector.high52w)} />}
            {selectedSector.low52w != null && <Stat label="52W Low" value={formatPrice(selectedSector.low52w)} />}
          </div>
          {histLoading
            ? <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
            : <PriceChart data={historical} color="auto" height={200} toolsOverlay={activeTools} />
          }
          {historical.length > 0 && (
            <ChartTools data={historical} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && <ChartDataTable data={historical} />}
          {selected && <ChartNotes chartId={selected} />}
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
