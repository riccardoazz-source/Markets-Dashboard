'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, BarChart2 } from 'lucide-react';
import { DetailModal } from './DetailModal';
import { TimeframeSelector } from './TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ReturnsTableButton } from './ReturnsTableButton';
import { GeminiCommentButton } from './GeminiCommentButton';
import { ChartNotes } from './ChartNotes';
import { LoadingSpinner } from './LoadingSpinner';
import { HistoricalPoint, QuoteData, Timeframe } from '@/lib/types';
import { formatPrice, formatPercent, colorForPercent } from '@/lib/utils';

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
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [histLoading, setHistLoading] = useState(false);

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
    try {
      const url = override
        ? `/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&from=${override.from}&to=${override.to}`
        : `/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
      const raw = await fetch(url).then(r => r.json());
      setHistorical(Array.isArray(raw) ? raw : []);
    } catch { setHistorical([]); } finally { setHistLoading(false); }
  }, [symbol]);

  useEffect(() => { fetchHist(timeframe, customRange ?? undefined); }, [timeframe, customRange, fetchHist]);

  const q = quote;
  return (
    <DetailModal onClose={onClose}>
      <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white">{name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{symbol} · {group}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {onCompare && (
              <button onClick={() => onCompare(symbol)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium">
                <BarChart2 size={13} /> Compare
              </button>
            )}
            <ReturnsTableButton name={name} symbol={symbol} />
            <GeminiCommentButton key={symbol} name={name} symbol={symbol} assetClass={group}
              price={q?.price} dayPct={q?.changePercent} />
            <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300" aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        <TimeframeSelector
          value={timeframe}
          onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
          isCustom={!!customRange}
          onCustomRange={(from, to) => setCustomRange({ from, to })}
        />

        {q && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {q.price != null && <Stat label="Price" value={formatPrice(q.price)} />}
            {q.changePercent != null && <Stat label="Day" value={formatPercent(q.changePercent)} color={colorForPercent(q.changePercent)} />}
            {q.mtdChangePercent != null && <Stat label="MTD" value={formatPercent(q.mtdChangePercent)} color={colorForPercent(q.mtdChangePercent)} />}
            {q.ytdChangePercent != null && <Stat label="YTD" value={formatPercent(q.ytdChangePercent)} color={colorForPercent(q.ytdChangePercent)} />}
            {q.fiveYearChangePercent != null && <Stat label="5Y" value={formatPercent(q.fiveYearChangePercent)} color={colorForPercent(q.fiveYearChangePercent)} />}
            {q.high52w != null && <Stat label="52W High" value={formatPrice(q.high52w)} />}
            {q.low52w != null && <Stat label="52W Low" value={formatPrice(q.low52w)} />}
          </div>
        )}

        {histLoading ? (
          <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
        ) : (
          <PriceChart data={historical} color="auto" height={200}
            onSetRange={(from, to) => setCustomRange({ from, to })} />
        )}
        <ChartNotes chartId={symbol} />
      </div>
    </DetailModal>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${color ?? 'text-gray-200'}`}>{value}</p>
    </div>
  );
}
