'use client';

import { useState, useEffect, useCallback } from 'react';
import { PhaseBadge } from '@/components/ui/PhaseBadge';
import { PeriodVolatility } from '@/components/ui/RotationControls';
import { PanelClose } from '@/components/ui/PanelClose';
import { Stat, StatGrid } from '@/components/ui/StatCard';
import { BarChart2 } from 'lucide-react';
import { DetailModal } from './DetailModal';
import { TimeframeSelector } from './TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ReturnsTableButton } from './ReturnsTableButton';
import { QuadrantButton } from '@/components/ui/QuadrantButton';
import { MonthlyRecapButton } from '@/components/ui/MonthlyRecapButton';
import { TradingViewButton } from '@/components/ui/TradingViewButton';
import { GeminiCommentButton } from './GeminiCommentButton';
import { ChartNotes } from './ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from './ChartTools';
import { useChartFit, paneCountOf } from '@/lib/useChartFit';
import { LoadingSpinner } from './LoadingSpinner';
import { HistoricalPoint, QuoteData, Timeframe } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent, calculateCAGR, buildTotalReturnSeries, computeAssetIRR } from '@/lib/utils';

// Generic asset pop-up used where there is no full section panel (the Rotation list
// and the Quadrant): clicking an asset opens its chart + key stats + the usual
// controls (timeframe, Compare/Returns/AI, notes) RIGHT THERE, instead of navigating
// to another tab. Self-contained: fetches its own quote + history by symbol.
export function AssetQuickView({ symbol, name, group, onClose, onCompare }: {
  symbol: string; name: string; group: string; onClose: () => void; onCompare?: (s: string) => void;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [dividends, setDividends] = useState<{ date: string; amount: number }[]>([]);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quotes?symbols=${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then((d: QuoteData[]) => { if (!cancelled) setQuote(Array.isArray(d) ? d[0] ?? null : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  const fetchHist = useCallback(async (tf: Timeframe, override?: { from: string; to: string }) => {
    setHistLoading(true);
    const params = override
      ? `symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&from=${override.from}&to=${override.to}`
      : `symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
    try {
      // Prefer /api/stock — it returns dividends (for the total-return line + IRR).
      const res = await fetch(`/api/stock?${params}`);
      const json = res.ok ? await res.json() : null;
      if (json && Array.isArray(json.prices) && json.prices.length) {
        setHistorical(json.prices);
        setDividends(Array.isArray(json.dividends) ? json.dividends : []);
      } else {
        const raw = await fetch(`/api/historical?${params}`).then(r => r.json());
        setHistorical(Array.isArray(raw) ? raw : []);
        setDividends([]);
      }
    } catch { setHistorical([]); setDividends([]); } finally { setHistLoading(false); }
  }, [symbol]);

  useEffect(() => { fetchHist(timeframe, customRange ?? undefined); }, [timeframe, customRange, fetchHist]);

  const q = quote;
  // Dividend-inclusive figures (only when the asset actually pays dividends).
  const totalReturn = dividends.length > 0 ? buildTotalReturnSeries(historical, dividends) : undefined;
  const cagr = historical.length > 1 ? calculateCAGR(historical, timeframe) : null;
  const irr = dividends.length > 0 ? computeAssetIRR(historical, dividends) : null;
  const tfLabel = customRange ? 'Custom' : timeframe;
  // Panes the active tools open push the panel taller; this keeps it inside the
  // window by measuring it rather than guessing (see lib/useChartFit).
  const { ref: fitRef, height: chartH, paneHeight } = useChartFit(paneCountOf(activeTools));

  return (
    <DetailModal onClose={onClose}>
      <div ref={fitRef} className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <PanelClose onClose={onClose} />
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              {name}
              <PhaseBadge symbol={symbol} />
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{symbol} · {group}</p>
          </div>
          <PeriodVolatility points={historical} label={tfLabel} />
          <div className="flex items-center gap-1.5 flex-wrap justify-end pr-7 min-w-0">
            {onCompare && (
              <button onClick={() => onCompare(symbol)}
                className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium">
                <BarChart2 size={13} /> <span className="hidden sm:inline">Compare</span>
              </button>
            )}
            <ReturnsTableButton name={name} symbol={symbol} />
              <MonthlyRecapButton symbol={symbol} name={name} assetClass={group} />
              <QuadrantButton name={name} symbol={symbol} group={group} />
            <TradingViewButton symbol={symbol} name={name} group={group} />
            <GeminiCommentButton key={symbol} name={name} symbol={symbol} assetClass={group}
              price={q?.price} dayPct={q?.changePercent} />
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

        {q && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
            {q.price != null && <Stat label="Price" value={formatPrice(q.price)} />}
            {q.changePercent != null && <Stat label="Day" value={formatPercent(q.changePercent)} color={colorForPercent(q.changePercent)} />}
            {q.mtdChangePercent != null && <Stat label="MTD" value={formatPercent(q.mtdChangePercent)} color={colorForPercent(q.mtdChangePercent)} />}
            {q.ytdChangePercent != null && <Stat label="YTD" value={formatPercent(q.ytdChangePercent)} color={colorForPercent(q.ytdChangePercent)} />}
            {q.fiveYearChangePercent != null && <Stat label="5Y" value={formatPercent(q.fiveYearChangePercent)} color={colorForPercent(q.fiveYearChangePercent)} />}
            {q.high52w != null && <Stat label="52W High" value={formatPrice(q.high52w)} />}
            {q.low52w != null && <Stat label="52W Low" value={formatPrice(q.low52w)} />}
            {q.trailingPE != null && q.trailingPE > 0 && <Stat label="P/E" value={`${q.trailingPE.toFixed(1)}x`} color="text-sky-400" />}
            {q.forwardPE != null && q.forwardPE > 0 && <Stat label="Fwd P/E" value={`${q.forwardPE.toFixed(1)}x`} color="text-sky-400" />}
          </div>
        )}

        {/* Return / CAGR / IRR — computed over the selected window, dividend-aware. */}
        {historical.length > 1 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
            {cagr && <Stat label={`Return (${tfLabel})`} value={formatPercent(cagr.return)} color={colorForPercent(cagr.return)} />}
            {cagr && <Stat label="CAGR" value={formatPercent(cagr.cagr)} color={colorForPercent(cagr.cagr)} />}
            {irr != null && <Stat label="IRR (w/ div.)" value={formatPercent(irr * 100)} color={colorForPercent(irr * 100)} />}
            {dividends.length > 0 && <Stat label="Dividends (period)" value={`${dividends.length}`} />}
          </div>
        )}

        {dividends.length > 0 && (
          <div className="flex items-center gap-3 text-[10px] text-gray-500 px-1">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-emerald-400" /> Price</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-emerald-400" /> Total Return (reinvested div.)</span>
          </div>
        )}

        {histLoading ? (
          <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
        ) : (
          <PriceChart data={historical} symbol={symbol} color="auto" height={chartH} subChartHeight={paneHeight}
            totalReturnData={totalReturn} toolsOverlay={activeTools} syncId="quickview-detail"
            onSetRange={(from, to) => setCustomRange({ from, to })} />
        )}
        {historical.length > 1 && (
          <ChartTools data={historical} activeTools={activeTools} onChange={setActiveTools} symbol={symbol} />
        )}
        <ChartNotes chartId={symbol} />
      </div>
    </DetailModal>
  );
}

