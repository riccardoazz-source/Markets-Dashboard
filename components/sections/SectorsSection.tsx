'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SECTORS } from '@/lib/config';
import { HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPercent, formatPrice, colorForPercent, calculateCAGR, dataAvailabilityMessage, computeAssetIRR, type DividendEvent } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea } from 'recharts';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore } from '@/lib/useChartDragSelect';
import { DividendsPanel } from '@/components/charts/DividendsBarChart';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X, BarChart2 } from 'lucide-react';

interface SectorLiveData {
  price: number | null;
  changePercent: number | null;
  oneYearReturn: number | null;
  ytdReturn: number | null;
  mtdReturn: number | null;
  fiveYearReturn: number | null;
  high52w: number | null;
  low52w: number | null;
  dividendYield?: number | null;
  currency?: string | null;
}

// Seed grid immediately from static config — never empty
const INITIAL: SectorLiveData = {
  price: null, changePercent: null, oneYearReturn: null, ytdReturn: null, mtdReturn: null, fiveYearReturn: null,
  high52w: null, low52w: null, dividendYield: null, currency: null,
};

type SectorSortKey = 'changePercent' | 'mtdReturn' | 'ytdReturn' | 'fiveYearReturn';

const SORT_OPTIONS: { value: SectorSortKey; label: string }[] = [
  { value: 'changePercent',  label: 'Day' },
  { value: 'mtdReturn',      label: 'MTD' },
  { value: 'ytdReturn',      label: 'YTD' },
  { value: 'fiveYearReturn', label: '5Y' },
];

// Distinct categories from the SECTORS config, plus an 'All' option.
const SECTOR_CATEGORIES = ['All', ...Array.from(new Set(SECTORS.map(s => s.category)))];

export function SectorsSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [live, setLive] = useState<Record<string, SectorLiveData>>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SectorSortKey>('changePercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [divData, setDivData] = useState<{ adjPrices: HistoricalPoint[]; dividends: DividendEvent[] } | null>(null);

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
        fiveYearReturn: number | null;
        high52w: number | null;
        low52w: number | null;
        dividendYield: number | null;
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

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); setDivData(null); }, [selected]);

  // Fetch adjusted-price + dividend data for distributing ETFs
  useEffect(() => {
    if (!selected || !live[selected]?.dividendYield) return;
    const params = customRange
      ? `symbol=${encodeURIComponent(selected)}&timeframe=${timeframe}&from=${customRange.from}&to=${customRange.to}`
      : `symbol=${encodeURIComponent(selected)}&timeframe=${timeframe}`;
    fetch(`/api/stock?${params}`)
      .then(r => r.json())
      .then((raw: { adjPrices?: HistoricalPoint[]; dividends?: DividendEvent[] }) => {
        const adj = raw.adjPrices ?? [];
        const divs = raw.dividends ?? [];
        if (adj.length > 0 || divs.length > 0) setDivData({ adjPrices: adj, dividends: divs });
      })
      .catch(() => {});
  }, [selected, timeframe, customRange, live]);

  // Merge static config with live data — always renders every sector
  const merged = SECTORS.map(s => ({
    symbol: s.symbol,
    name: s.name,
    category: s.category,
    ...(live[s.symbol] ?? INITIAL),
  }));

  const filteredSectors = selectedCategory === 'All'
    ? merged
    : merged.filter(s => s.category === selectedCategory);

  const getValue = (s: typeof merged[0]) =>
    (s as unknown as Record<string, number | null>)[sortBy] ?? null;

  const sorted = [...filteredSectors]
    .sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    })
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const selectedSector = merged.find(s => s.symbol === selected);

  // Dual-line chart data: price vs total return, normalized to 0% at period start
  const divChartData = useMemo(() => {
    if (!historical.length || !divData?.adjPrices.length) return null;
    const adjMap = new Map<string, number>(divData.adjPrices.map(p => [p.date, p.close]));
    const priceBase = historical[0].close;
    const adjBase = divData.adjPrices[0].close;
    return historical.map(p => {
      const adj = adjMap.get(p.date);
      return {
        date: p.date,
        price: ((p.close - priceBase) / priceBase) * 100,
        totalReturn: adj != null ? ((adj - adjBase) / adjBase) * 100 : undefined,
      };
    });
  }, [historical, divData]);

  const irr = useMemo(() => {
    if (!divData?.dividends.length || !historical.length) return null;
    return computeAssetIRR(historical, divData.dividends);
  }, [historical, divData]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {filteredSectors.length} sectors
        </span>
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

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {SECTOR_CATEGORIES.map(c => (
          <button key={c} onClick={() => setSelectedCategory(c)}
            className={clsx(
              'px-3 py-1 text-xs font-semibold rounded-full transition-all whitespace-nowrap shrink-0',
              selectedCategory === c
                ? 'bg-accent text-white'
                : 'text-gray-400 border border-border hover:border-border-light hover:text-gray-200'
            )}>
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
        {sorted.map(sector => {
          const day = sector.changePercent;
          const ytd = sector.ytdReturn;
          const isSelected = selected === sector.symbol;

          return (
            <button key={sector.symbol}
              onClick={() => setSelected(isSelected ? null : sector.symbol)}
              className={clsx(
                'relative rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
              )}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-gray-600">#{sector.rank}</span>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{sector.category}</span>
                </div>
                {sector.currency && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    {sector.currency}
                  </span>
                )}
              </div>
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-sm font-semibold text-gray-100 leading-snug">{sector.name}</p>
                {sector.dividendYield != null && sector.dividendYield > 0 && (
                  <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 leading-none">
                    DIV
                  </span>
                )}
              </div>

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
                  {sector.fiveYearReturn != null && (
                    <p className={clsx('text-[10px] mt-0.5', colorForPercent(sector.fiveYearReturn))}>
                      5Y: {formatPercent(sector.fiveYearReturn, 1)}
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
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                {selectedSector.symbol} · {selectedSector.category}
                {selectedSector.currency && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    {selectedSector.currency}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onCompare && (
                <button
                  onClick={() => onCompare(selected!)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  Compare
                </button>
              )}
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
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
            {selectedSector.price != null && <Stat label="Price" value={formatPrice(selectedSector.price)} />}
            {selectedSector.changePercent != null && <Stat label="Day" value={formatPercent(selectedSector.changePercent)} color={colorForPercent(selectedSector.changePercent)} />}
            {selectedSector.ytdReturn != null && <Stat label="YTD" value={formatPercent(selectedSector.ytdReturn)} color={colorForPercent(selectedSector.ytdReturn)} />}
            {cagrData && <>
              <Stat label={`Return ${timeframe}`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
              <Stat label={`CAGR ${timeframe}`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
            </>}
            {irr != null && (
              /* computeAssetIRR returns a decimal (0.085 = 8.5%) — multiply by 100 for display */
              <Stat label={`IRR (${timeframe})`} value={formatPercent(irr * 100)} color={colorForPercent(irr * 100)} />
            )}
            {selectedSector.high52w != null && <Stat label="52W High" value={formatPrice(selectedSector.high52w)} />}
            {selectedSector.low52w != null && <Stat label="52W Low" value={formatPrice(selectedSector.low52w)} />}
          </div>
          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : divChartData ? (
            <DualLineDragChart data={divChartData} onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          ) : (
            <PriceChart data={historical} color="auto" height={200} toolsOverlay={activeTools}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          )}

          {/* Dividends — same bar chart + collapsible list as StockSection */}
          {divData && divData.dividends.length > 0 && (
            <DividendsPanel
              dividends={divData.dividends}
              currency="USD"
              periodStartDate={historical[0]?.date}
            />
          )}

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

interface DualLinePoint { date: string; price: number; totalReturn?: number }

function DualLineDragChart({ data, onSetRange }: { data: DualLinePoint[]; onSetRange?: (from: string, to: string) => void }) {
  const { handlers, range, area, clear } = useChartDragSelect();
  const last = data[data.length - 1];
  const isUp = (last?.price ?? 0) >= 0;
  const priceColor = isUp ? '#10b981' : '#ef4444';
  const trColor    = isUp ? '#34d399' : '#f87171';

  let selStats: { left: string; right: string; priceDelta: number; trDelta: number | null } | null = null;
  if (range) {
    const pL = valueAtOrAfter(data, range.left, 'price');
    const pR = valueAtOrBefore(data, range.right, 'price');
    const tL = valueAtOrAfter(data, range.left, 'totalReturn');
    const tR = valueAtOrBefore(data, range.right, 'totalReturn');
    if (pL != null && pR != null) {
      selStats = {
        left: range.left,
        right: range.right,
        priceDelta: pR - pL,
        trDelta: tL != null && tR != null ? tR - tL : null,
      };
    }
  }

  return (
    <div className="space-y-1 select-none">
      {selStats && (
        <div className="flex items-center justify-between bg-bg-input rounded-lg px-3 py-1.5 text-xs flex-wrap gap-2">
          <span className="text-gray-400">{selStats.left} → {selStats.right}</span>
          <div className="flex items-center gap-3">
            <span className={clsx('font-bold tabular-nums', selStats.priceDelta >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              Price {selStats.priceDelta >= 0 ? '+' : ''}{selStats.priceDelta.toFixed(2)}%
            </span>
            {selStats.trDelta != null && (
              <span className={clsx('font-bold tabular-nums', selStats.trDelta >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                TR {selStats.trDelta >= 0 ? '+' : ''}{selStats.trDelta.toFixed(2)}%
              </span>
            )}
            {onSetRange && (
              <button
                onClick={() => { onSetRange(selStats!.left, selStats!.right); clear(); }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
              >
                Set period
              </button>
            )}
            <button onClick={clear} className="text-gray-600 hover:text-gray-300 text-[10px] ml-1">✕</button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: priceColor }}/>Price</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed" style={{ borderColor: trColor }}/>Total Return</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
          {...handlers} style={{ cursor: 'crosshair' }}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
            interval="preserveStartEnd"
            tickFormatter={d => {
              const date = new Date(d);
              const n = data.length;
              if (n < 60)  return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
              if (n < 700) return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
              return String(date.getFullYear());
            }} />
          <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
            tickFormatter={v => `${v >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: 11, padding: '6px 10px' }}
            labelStyle={{ color: '#94a3b8', fontSize: 10, marginBottom: 2 }}
            formatter={(val: number, name: string) => [`${val >= 0 ? '+' : ''}${val.toFixed(2)}%`, name]}
          />
          <Line dataKey="price" name="Price" stroke={priceColor} dot={false} strokeWidth={2} connectNulls />
          <Line dataKey="totalReturn" name="Total Return" stroke={trColor} dot={false} strokeWidth={2} strokeDasharray="6 3" connectNulls />
          {area && (
            <ReferenceArea x1={area.left} x2={area.right}
              fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} strokeWidth={1} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
