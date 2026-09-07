'use client';

import { useState, useEffect, useCallback } from 'react';
import { PhaseBadge } from '@/components/ui/PhaseBadge';
import { PanelClose } from '@/components/ui/PanelClose';
import { Stat, StatGrid } from '@/components/ui/StatCard';
import { COMMODITIES } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData } from '@/lib/types';
import { formatPrice, formatPercent, formatCagr, colorForPercent, calculateCAGR, dataAvailabilityMessage } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { useChartFit, paneCountOf } from '@/lib/useChartFit';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Sma200wLine, Ma200dLine, MaSpreadLine } from '@/components/ui/Sma200wLine';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, BarChart2 } from 'lucide-react';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { summarizeTools } from '@/lib/toolsSummary';
import { ReturnsTableButton } from '@/components/ui/ReturnsTableButton';
import { QuadrantButton } from '@/components/ui/QuadrantButton';
import { MonthlyRecapButton } from '@/components/ui/MonthlyRecapButton';
import { TradingViewButton } from '@/components/ui/TradingViewButton';
import { DetailModal } from '@/components/ui/DetailModal';
import { useAvgYearly } from '@/lib/useAvgYearly';
import { usePins } from '@/lib/gist';
import { useRotationPhases } from '@/lib/useRotationPhases';
import { PhaseChip, PinButton, RotationFilterBar, MAFilterChips, PhaseFilter, isBelowMA, VolatilityLine, VolFilterChips, VolFilter, PeriodVolatility } from '@/components/ui/RotationControls';
import { useVolatility } from '@/lib/useVolatility';
import { volBand } from '@/lib/volatility';

type SortKey = 'changePercent' | 'oneMonthChangePercent' | 'threeMonthChangePercent' | 'sixMonthChangePercent' | 'mtdChangePercent' | 'ytdChangePercent' | 'fiveYearChangePercent' | 'fiveYearCagrPercent' | 'avgYearly';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'changePercent',            label: 'Day' },
  { value: 'oneMonthChangePercent',    label: '1M' },
  { value: 'threeMonthChangePercent',  label: '3M' },
  { value: 'sixMonthChangePercent',    label: '6M' },
  { value: 'mtdChangePercent',         label: 'MTD' },
  { value: 'ytdChangePercent',         label: 'YTD' },
  { value: 'fiveYearChangePercent',    label: '5Y' },
  { value: 'fiveYearCagrPercent',      label: 'CAGR' },
  { value: 'avgYearly',                label: 'Avg Yr' },
];

const COMMODITY_CATEGORIES = ['All', ...Array.from(new Set(COMMODITIES.map(c => c.category)))];

export function CommoditiesSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('changePercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [volFilter, setVolFilter] = useState<VolFilter>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [below200d, setBelow200d] = useState(false);
  const [below200w, setBelow200w] = useState(false);
  const { pins, togglePin } = usePins();
  const phases = useRotationPhases();
  // Whole-history volatility, for the card line and the band filter. Cached hard —
  // a figure built from thousands of bars does not move when one more arrives.
  const vols = useVolatility(COMMODITIES.map(c => c.symbol));
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    try {
      const symbols = COMMODITIES.map(c => c.symbol).join(',');
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const rawQ = await res.json();
      const data: QuoteData[] = Array.isArray(rawQ) ? (rawQ as QuoteData[]) : [];
      const map: Record<string, QuoteData> = {};
      data.forEach(q => { map[q.symbol] = q; });
      setQuotes(map);
      setLastUpdate(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
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
    } catch (e) { console.error(e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchHistorical]);

  useEffect(() => {
    if (jumpTo) setSelected(jumpTo);
  }, [jumpTo]);

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

  const avgYearlyMap = useAvgYearly(COMMODITIES.map(c => c.symbol));

  const getValue = (q: QuoteData | undefined, key: SortKey): number | null => {
    if (!q) return null;
    if (key === 'changePercent') return q.changePercent ?? null;
    if (key === 'oneMonthChangePercent') return q.oneMonthChangePercent ?? null;
    if (key === 'threeMonthChangePercent') return q.threeMonthChangePercent ?? null;
    if (key === 'sixMonthChangePercent') return q.sixMonthChangePercent ?? null;
    if (key === 'mtdChangePercent') return q.mtdChangePercent ?? null;
    if (key === 'ytdChangePercent') return q.ytdChangePercent ?? null;
    if (key === 'fiveYearCagrPercent') return q.fiveYearCagrPercent ?? null;
    if (key === 'avgYearly') return avgYearlyMap[q.symbol] ?? null;
    return q.fiveYearChangePercent ?? null;
  };

  const filteredCommodities = COMMODITIES.filter(c => {
    const q = quotes[c.symbol];
    return (selectedCategory === 'All' || c.category === selectedCategory)
      && (phaseFilter === 'all' || phases.get(c.symbol) === phaseFilter)
      && (!pinnedOnly || pins.has(c.symbol))
      && (!below200d || isBelowMA(q?.price, q?.sma200d))
      && (!below200w || isBelowMA(q?.price, q?.sma200w))
      && (volFilter === 'all' || volBand(vols.get(c.symbol)?.total) === volFilter);
  });

  const sorted = [...filteredCommodities].sort((a, b) => {
    const av = getValue(quotes[a.symbol], sortBy);
    const bv = getValue(quotes[b.symbol], sortBy);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  const selectedConfig = COMMODITIES.find(c => c.symbol === selected);
  const selectedQuote = selected ? quotes[selected] : null;

  // Panes the active tools open push the panel taller; this keeps it inside the
  // window by measuring it rather than guessing (see lib/useChartFit).
  const { ref: fitRef, height: chartH, paneHeight } = useChartFit(paneCountOf(activeTools));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {filteredCommodities.length} commodities
        </span>
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          <div className="flex gap-1 bg-bg-input rounded-lg p-1 overflow-x-auto scrollbar-hide min-w-0">
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={clsx('px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                {opt.label}
              </button>
            ))}
            <MAFilterChips below200d={below200d} setBelow200d={setBelow200d} below200w={below200w} setBelow200w={setBelow200w} />
          <VolFilterChips value={volFilter} setValue={setVolFilter} />
          </div>
          {lastUpdate && (
            <div className="flex items-center gap-1 text-[10px] text-gray-600">
              <RefreshCw size={10} />
              {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {/* Rotation phase + pinned filter */}
      <RotationFilterBar phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter}
        pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} pinnedCount={COMMODITIES.filter(c => pins.has(c.symbol)).length} />
      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {COMMODITY_CATEGORIES.map(c => (
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

      {loading ? (
        <LoadingGrid count={COMMODITIES.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sorted.map(com => {
            const q = quotes[com.symbol];
            const day = q?.changePercent ?? 0;
            const mtd = q?.mtdChangePercent;
            const ytd = q?.ytdChangePercent;
            const fiveYear = q?.fiveYearChangePercent;
            const isUp = day >= 0;
            const isSelected = selected === com.symbol;
            return (
              <button key={com.symbol}
                onClick={() => setSelected(isSelected ? null : com.symbol)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none">{com.category}</p>
                  <div className="flex items-center gap-1">
                    {q?.currency && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                        {q.currency}
                      </span>
                    )}
                    <PinButton pinned={pins.has(com.symbol)} onToggle={() => togglePin(com.symbol)} />
                  </div>
                </div>
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-sm font-semibold text-gray-100 leading-snug">{com.name}</p>
                  <PhaseChip phase={phases.get(com.symbol)} />
                </div>
                {q && q.price > 0 ? (
                  <>
                    <p className="text-lg font-bold text-white tabular-nums">{formatPrice(q.price)}</p>
                    <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(day))}>
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(day)} <span className="text-[10px] font-medium opacity-70">day</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 mt-1.5">
                      {([
                        { k: '1M', v: q.oneMonthChangePercent },
                        { k: '3M', v: q.threeMonthChangePercent },
                        { k: '6M', v: q.sixMonthChangePercent },
                        { k: 'MTD', v: mtd },
                        { k: 'YTD', v: ytd },
                        { k: '5Y', v: fiveYear },
                        { k: 'CAGR', v: q.fiveYearCagrPercent, cagr: true },
                        { k: 'Avg Yr', v: avgYearlyMap[q.symbol] ?? null },
                      ] as { k: string; v: number | null | undefined; cagr?: boolean }[])
                        .filter(s => s.v != null)
                        .map(s => (
                          <p key={s.k} className={clsx('text-[9px] leading-[1.35] tabular-nums', colorForPercent(s.v as number))}>
                            <span className="text-gray-500">{s.k}:</span> {s.cagr ? formatCagr(s.v as number, q.fiveYearFull) : formatPercent(s.v as number, 1)}
                          </p>
                        ))}
                    </div>
                    <Ma200dLine price={q.price} sma200d={q.sma200d} currency={q.currency} />
                    <Sma200wLine price={q.price} sma200w={q.sma200w} currency={q.currency} />
                    <MaSpreadLine sma200d={q.sma200d} sma200w={q.sma200w} />
                    <VolatilityLine vol={vols.get(com.symbol)} />
                  </>
                ) : (
                  <p className="text-xs text-gray-600">Loading…</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedQuote && (
        <DetailModal onClose={() => setSelected(null)}>
        <div ref={fitRef} className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <PanelClose onClose={() => setSelected(null)} />
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                {selectedConfig?.name}
                <PhaseBadge symbol={selected} />
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                {selected} · {selectedConfig?.category}
                {selectedQuote?.currency && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                    {selectedQuote.currency}
                  </span>
                )}
              </p>
            </div>
            <PeriodVolatility points={historical} label={customRange ? 'Custom' : timeframe} />
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
              <ReturnsTableButton name={selectedConfig?.name ?? selected!} symbol={selected!} />
              <MonthlyRecapButton symbol={selected!} name={selectedConfig?.name ?? selected!} assetClass="Commodities" />
              <QuadrantButton name={selectedConfig?.name ?? selected!} symbol={selected!} group="Commodities" />
              <TradingViewButton symbol={selected!} name={selectedConfig?.name ?? selected!} group="Commodities" />
              <GeminiCommentButton
                key={selected!}
                name={selectedConfig?.name ?? selected!}
                symbol={selected!}
                assetClass="Commodities"
                price={selectedQuote?.price}
                dayPct={selectedQuote?.changePercent}
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
            <Stat label="Price" value={formatPrice(selectedQuote.price)} />
            <Stat label="Day Change" value={formatPercent(selectedQuote.changePercent)} color={colorForPercent(selectedQuote.changePercent)} />
            {selectedQuote.mtdChangePercent != null && (
              <Stat label="MTD Return" value={formatPercent(selectedQuote.mtdChangePercent)} color={colorForPercent(selectedQuote.mtdChangePercent)} />
            )}
            {selectedQuote.ytdChangePercent != null && (
              <Stat label="YTD Return" value={formatPercent(selectedQuote.ytdChangePercent)} color={colorForPercent(selectedQuote.ytdChangePercent)} />
            )}
            {/* For 1D use the authoritative quote day change (futures' daily price
                series from Yahoo has contract-roll artifacts, so the series-based
                return would disagree with the corrected Day Change). */}
            {timeframe === '1D' && !customRange ? (
              <>
                <Stat label="Return (1D)" value={formatPercent(selectedQuote.changePercent)} color={colorForPercent(selectedQuote.changePercent)} />
                <Stat label="CAGR (1D)" value={formatPercent(selectedQuote.changePercent)} color={colorForPercent(selectedQuote.changePercent)} />
              </>
            ) : cagrData && (
              <>
                <Stat label={`Return (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
                <Stat label={`CAGR (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
              </>
            )}
            {selectedQuote.high52w != null && selectedQuote.high52w > 0 && <Stat label="52W High" value={formatPrice(selectedQuote.high52w)} />}
            {selectedQuote.low52w != null && selectedQuote.low52w > 0 && <Stat label="52W Low" value={formatPrice(selectedQuote.low52w)} />}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : (
            <PriceChart data={historical} symbol={selected ?? undefined} color="auto" toolsOverlay={activeTools}
              syncId="commodities-detail" height={chartH} subChartHeight={paneHeight}
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

