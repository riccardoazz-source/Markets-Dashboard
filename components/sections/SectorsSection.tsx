'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PanelClose } from '@/components/ui/PanelClose';
import { Stat, StatGrid } from '@/components/ui/StatCard';
import { SECTORS } from '@/lib/config';
import { HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPercent, formatPrice, formatCagr, colorForPercent, calculateCAGR, dataAvailabilityMessage, computeAssetIRR, buildTotalReturnSeries, type DividendEvent } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { useChartFit, paneCountOf } from '@/lib/useChartFit';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea } from 'recharts';
import { useChartDragSelect, valueAtOrAfter, valueAtOrBefore, rangeDurationLabel } from '@/lib/useChartDragSelect';
import { DividendsPanel } from '@/components/charts/DividendsBarChart';
import { computeDivYield, computeDivCAGR } from '@/lib/dividends';
import { Sma200wLine, Ma200dLine, MaSpreadLine } from '@/components/ui/Sma200wLine';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, BarChart2 } from 'lucide-react';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { summarizeTools } from '@/lib/toolsSummary';
import { ReturnsTableButton } from '@/components/ui/ReturnsTableButton';
import { QuadrantButton } from '@/components/ui/QuadrantButton';
import { TradingViewButton } from '@/components/ui/TradingViewButton';
import { FundamentalsButton } from '@/components/ui/FundamentalsButton';
import { DetailModal } from '@/components/ui/DetailModal';
import { useAvgYearly } from '@/lib/useAvgYearly';
import { usePins } from '@/lib/gist';
import { useRotationPhases } from '@/lib/useRotationPhases';
import { PhaseChip, PinButton, RotationFilterBar, MAFilterChips, PhaseFilter, isBelowMA } from '@/components/ui/RotationControls';

interface SectorLiveData {
  price: number | null;
  changePercent: number | null;
  oneYearReturn: number | null;
  ytdReturn: number | null;
  mtdReturn: number | null;
  oneMonthReturn?: number | null;
  threeMonthReturn?: number | null;
  sixMonthReturn?: number | null;
  fiveYearReturn: number | null;
  fiveYearCagr?: number | null;
  fiveYearFull?: boolean;
  high52w: number | null;
  low52w: number | null;
  dividendYield?: number | null;
  sma200w?: number | null;
  sma200d?: number | null;
  currency?: string | null;
}

// Seed grid immediately from static config — never empty
const INITIAL: SectorLiveData = {
  price: null, changePercent: null, oneYearReturn: null, ytdReturn: null, mtdReturn: null, fiveYearReturn: null,
  fiveYearCagr: null, fiveYearFull: false,
  high52w: null, low52w: null, dividendYield: null, sma200w: null, sma200d: null, currency: null,
};

type SectorSortKey = 'changePercent' | 'oneMonthReturn' | 'threeMonthReturn' | 'sixMonthReturn' | 'mtdReturn' | 'ytdReturn' | 'fiveYearReturn' | 'fiveYearCagr' | 'avgYearly';

const SORT_OPTIONS: { value: SectorSortKey; label: string }[] = [
  { value: 'changePercent',    label: 'Day' },
  { value: 'oneMonthReturn',   label: '1M' },
  { value: 'threeMonthReturn', label: '3M' },
  { value: 'sixMonthReturn',   label: '6M' },
  { value: 'mtdReturn',        label: 'MTD' },
  { value: 'ytdReturn',        label: 'YTD' },
  { value: 'fiveYearReturn',   label: '5Y' },
  { value: 'fiveYearCagr',     label: 'CAGR' },
  { value: 'avgYearly',        label: 'Avg Yr' },
];

// Distinct categories from the SECTORS config, plus an 'All' option.
const SECTOR_CATEGORIES = ['All', ...Array.from(new Set(SECTORS.map(s => s.category)))];

export function SectorsSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [live, setLive] = useState<Record<string, SectorLiveData>>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SectorSortKey>('changePercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [below200d, setBelow200d] = useState(false);
  const [below200w, setBelow200w] = useState(false);
  const { pins, togglePin } = usePins();
  const phases = useRotationPhases();
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
        fiveYearCagr: number | null;
        fiveYearFull: boolean;
        high52w: number | null;
        low52w: number | null;
        dividendYield: number | null;
        sma200w: number | null;
        sma200d?: number | null;
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
      setDataMsg(dataAvailabilityMessage(data, tf, !!override));
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

  // Fetch adjusted-price + dividend data for distributing ETFs.
  // Don't gate on live dividendYield — some LSE/Euronext listings omit it from
  // the quote endpoint even though they distribute. The /api/stock response is
  // the source of truth: divData is only set below when real dividend events exist.
  useEffect(() => {
    if (!selected) return;
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
  }, [selected, timeframe, customRange]);

  // Full-history average yearly return (the Returns-table "Average"), loaded once & cached.
  const avgYearlyMap = useAvgYearly(SECTORS.map(s => s.symbol));

  // Merge static config with live data — always renders every sector
  const merged = SECTORS.map(s => ({
    symbol: s.symbol,
    name: s.name,
    category: s.category,
    ...(live[s.symbol] ?? INITIAL),
    avgYearly: avgYearlyMap[s.symbol] ?? null,
  }));

  const filteredSectors = merged.filter(s =>
    (selectedCategory === 'All' || s.category === selectedCategory)
    && (phaseFilter === 'all' || phases.get(s.symbol) === phaseFilter)
    && (!pinnedOnly || pins.has(s.symbol))
    && (!below200d || isBelowMA(s.price, s.sma200d))
    && (!below200w || isBelowMA(s.price, s.sma200w))
  );

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

  // When any chart tool is toggled, show the overlay-capable PriceChart instead
  // of the dividend dual-line chart (which can't draw SMA/EMA/Bollinger lines).
  const anyToolActive = Object.values(activeTools).some(Boolean);

  // Dual-line chart data: price vs total return, normalized to 0% at period start.
  // The total-return line is built by reinvesting the ACTUAL dividend cash flows into the
  // (split-adjusted) price series — so it always shows whenever dividends exist, and matches the
  // IRR and the dividend bars (Yahoo's adjClose is unreliable for some ETFs).
  const divChartData = useMemo(() => {
    if (!historical.length || !divData?.dividends.length) return null;
    const tr = buildTotalReturnSeries(historical, divData.dividends);
    const priceBase = historical[0].close;
    const trBase = tr[0]?.close ?? 0;
    return historical.map((p, i) => ({
      date: p.date,
      price: ((p.close - priceBase) / priceBase) * 100,
      totalReturn: trBase ? ((tr[i].close - trBase) / trBase) * 100 : undefined,
    }));
  }, [historical, divData]);

  // Total-return series (dividends reinvested) — passed to PriceChart so the cumulative line
  // is drawn even when a tool is active (the dual-line chart only renders with no tool active).
  const trSeries = useMemo(
    () => (divData?.dividends.length && historical.length ? buildTotalReturnSeries(historical, divData.dividends) : undefined),
    [historical, divData],
  );

  const irr = useMemo(() => {
    if (!divData?.dividends.length || !historical.length) return null;
    return computeAssetIRR(historical, divData.dividends);
  }, [historical, divData]);

  // Panes the active tools open push the panel taller; this keeps it inside the
  // window by measuring it rather than guessing (see lib/useChartFit).
  const { ref: fitRef, height: chartH, paneHeight } = useChartFit(paneCountOf(activeTools));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {filteredSectors.length} sectors
        </span>
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          <div className="flex gap-1 bg-bg-input rounded-lg p-1 overflow-x-auto scrollbar-hide min-w-0">
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'
                )}>
                {opt.label}
              </button>
            ))}
            <MAFilterChips below200d={below200d} setBelow200d={setBelow200d} below200w={below200w} setBelow200w={setBelow200w} />
          </div>
          {loading && <span className="text-accent animate-pulse text-[10px]">updating…</span>}
          {lastUpdate && !loading && (
            <span className="flex items-center gap-1 text-[10px] text-gray-600">
              <RefreshCw size={9} />{lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Rotation phase + pinned filter */}
      <RotationFilterBar phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter}
        pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} pinnedCount={SECTORS.filter(s => pins.has(s.symbol)).length} />
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
                <div className="flex items-center gap-1">
                  {sector.currency && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                      {sector.currency}
                    </span>
                  )}
                  <PinButton pinned={pins.has(sector.symbol)} onToggle={() => togglePin(sector.symbol)} />
                </div>
              </div>
              <div className="flex items-start justify-between gap-1 mb-2">
                <div className="flex items-center gap-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-100 leading-snug truncate">{sector.name}</p>
                  <PhaseChip phase={phases.get(sector.symbol)} />
                </div>
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
                  <div className="grid grid-cols-2 gap-x-2 mt-1.5">
                    {([
                      { k: '1M', v: sector.oneMonthReturn },
                      { k: '3M', v: sector.threeMonthReturn },
                      { k: '6M', v: sector.sixMonthReturn },
                      { k: 'MTD', v: sector.mtdReturn },
                      { k: 'YTD', v: ytd },
                      { k: '5Y', v: sector.fiveYearReturn },
                      { k: 'CAGR', v: sector.fiveYearCagr, cagr: true },
                      { k: 'Avg Yr', v: sector.avgYearly ?? null },
                    ] as { k: string; v: number | null | undefined; cagr?: boolean }[])
                      .filter(s => s.v != null)
                      .map(s => (
                        <p key={s.k} className={clsx('text-[9px] leading-[1.35] tabular-nums', colorForPercent(s.v as number))}>
                          <span className="text-gray-500">{s.k}:</span> {s.cagr ? formatCagr(s.v as number, sector.fiveYearFull) : formatPercent(s.v as number, 1)}
                        </p>
                      ))}
                  </div>
                  <Ma200dLine price={sector.price} sma200d={sector.sma200d} currency={sector.currency} />
                  <Sma200wLine price={sector.price} sma200w={sector.sma200w} currency={sector.currency} />
                  <MaSpreadLine sma200d={sector.sma200d} sma200w={sector.sma200w} />
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
        <DetailModal onClose={() => setSelected(null)}>
        <div ref={fitRef} className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <PanelClose onClose={() => setSelected(null)} />
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
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
            <div className="flex items-center gap-1.5 flex-wrap justify-end pr-7 min-w-0">
              {onCompare && (
                <button
                  onClick={() => onCompare(selected!)}
                  className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  <span className="hidden sm:inline">Compare</span>
                </button>
              )}
              <ReturnsTableButton name={selectedSector?.name ?? selected!} symbol={selected!} />
              <QuadrantButton name={selectedSector?.name ?? selected!} symbol={selected!} group="Sectors" />
              <TradingViewButton symbol={selected!} group="Sectors" />
              {/* Sector ETFs distribute, so this is where the drawer earns its place.
                  Offered only when there are dividends behind it. */}
              {divData && divData.dividends.length > 0 && (
                <FundamentalsButton
                  name={selectedSector?.name ?? selected!} symbol={selected!} subtitle="Sectors"
                >
                  <SectorFundamentals
                    timeframe={timeframe} setTimeframe={setTimeframe}
                    customRange={customRange} setCustomRange={setCustomRange}
                    symbol={selected!} historical={historical} trSeries={trSeries}
                    dividends={divData.dividends}
                    price={selectedSector?.price ?? null}
                  />
                </FundamentalsButton>
              )}
              <GeminiCommentButton
                key={selected!}
                name={selectedSector?.name ?? selected!}
                symbol={selected!}
                assetClass="Sectors"
                price={selectedSector?.price}
                dayPct={selectedSector?.changePercent}
                timeframe={timeframe}
                tools={historical.length > 0 ? summarizeTools(activeTools, historical) : undefined}
              />
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

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
            {selectedSector.price != null && <Stat label="Price" value={formatPrice(selectedSector.price)} />}
            {selectedSector.changePercent != null && <Stat label="Day" value={formatPercent(selectedSector.changePercent)} color={colorForPercent(selectedSector.changePercent)} />}
            {selectedSector.ytdReturn != null && <Stat label="YTD" value={formatPercent(selectedSector.ytdReturn)} color={colorForPercent(selectedSector.ytdReturn)} />}
            {cagrData && <>
              <Stat label={`Return ${timeframe}`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
              <Stat label={`CAGR ${timeframe}`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
            </>}
            {irr != null && (
              /* computeAssetIRR returns a decimal (0.085 = 8.5%) — multiply by 100 for display */
              <Stat label={`IRR (${customRange ? 'Custom' : timeframe})`} value={formatPercent(irr * 100)} color={colorForPercent(irr * 100)} />
            )}
            {selectedSector.high52w != null && selectedSector.high52w > 0 && <Stat label="52W High" value={formatPrice(selectedSector.high52w)} />}
            {selectedSector.low52w != null && selectedSector.low52w > 0 && <Stat label="52W Low" value={formatPrice(selectedSector.low52w)} />}
          </div>
          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : divChartData && !anyToolActive ? (
            <DualLineDragChart data={divChartData} onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          ) : (
            <PriceChart data={historical} symbol={selected ?? undefined} color="auto" toolsOverlay={activeTools}
              totalReturnData={trSeries} syncId="sectors-detail" height={chartH} subChartHeight={paneHeight}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          )}

          {historical.length > 0 && (
            <ChartTools data={historical} symbol={selected ?? undefined} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && <ChartDataTable data={historical} />}
          {selected && (
            <ChartNotes
              chartId={selected}
              captureView={() => ({ tools: { ...activeTools } as Record<string, boolean>, timeframe, customRange })}
              onRestoreView={v => {
                if (v.tools) setActiveTools({ ...DEFAULT_TOOLS, ...(v.tools as Partial<ActiveTools>) });
                if (v.timeframe) setTimeframe(v.timeframe as Timeframe);
                setCustomRange(v.customRange ?? null);
              }}
            />
          )}
        </div>
        </DetailModal>
      )}
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
          <span className="text-gray-400 flex items-center gap-2">
            {selStats.left} → {selStats.right}
            <span className="text-gray-500 border-l border-border pl-2">{rangeDurationLabel(selStats.left, selStats.right)}</span>
          </span>
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


// The same drawer the stocks tab has, with what a sector ETF actually carries:
// the price over the selected period, the dividend record, and the two rates that
// describe it. The timeframe selector drives the panel's own state, so the period
// here and the period behind can never disagree.
function SectorFundamentals({
  timeframe, setTimeframe, customRange, setCustomRange,
  symbol, historical, trSeries, dividends, price,
}: {
  timeframe: Timeframe;
  setTimeframe: (t: Timeframe) => void;
  customRange: { from: string; to: string } | null;
  setCustomRange: (r: { from: string; to: string } | null) => void;
  symbol: string;
  historical: HistoricalPoint[];
  trSeries?: HistoricalPoint[];
  dividends: DividendEvent[];
  price: number | null;
}) {
  const divYield = computeDivYield(dividends, price ?? 0);
  const divCagr = computeDivCAGR(dividends);
  const totalDivs = dividends.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <TimeframeSelector
          value={timeframe}
          onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
          isCustom={!!customRange}
          onCustomRange={(from, to) => setCustomRange({ from, to })}
        />
      </div>

      {historical.length > 1 && (
        <PriceChart data={historical} symbol={symbol} color="auto" height={220}
          totalReturnData={trSeries}
          onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
        <Stat label="Dividends (period)" value={`${dividends.length} (${formatPrice(totalDivs)})`} />
        <Stat label="Div. yield (TTM)" value={divYield != null ? formatPercent(divYield) : '—'}
          color={divYield != null ? colorForPercent(divYield) : 'text-gray-600'} />
        {divCagr ? (
          <Stat label={`Div. CAGR (${divCagr.years}y)`} value={formatPercent(divCagr.cagr)} color={colorForPercent(divCagr.cagr)} />
        ) : (
          <Stat label="Div. CAGR" value="—" color="text-gray-600" />
        )}
      </div>

      <DividendsPanel dividends={dividends} currency="USD" periodStartDate={historical[0]?.date} />
    </div>
  );
}
