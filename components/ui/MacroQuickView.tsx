'use client';

// The detail for one Dashboard tile, opened OVER the Dashboard.
//
// The tiles used to hand over to the Macro or Currencies tab. That works, but closing the
// detail leaves you on the tab you were sent to rather than where you started, so a glance
// at the dollar quietly relocated you. Everything the tiles show is a single series, so
// the detail opens in place like the pinned cards do, and closing it returns you to the
// page you were on. The full tab is still one click away for anything more.

import { useState, useEffect, useCallback } from 'react';
import { ArrowUpRight, BarChart2 } from 'lucide-react';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';
import { TimeframeSelector } from './TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingSpinner } from './LoadingSpinner';
import { Stat } from './StatCard';
import { MACRO_INDICATORS } from '@/lib/config';
import { formatMacroValue } from '@/lib/macroDerived';
import { getTimeframeStart } from '@/lib/utils';
import type { HistoricalPoint, Timeframe } from '@/lib/types';

export interface QuickViewTarget {
  kind: 'macro' | 'fx';
  /** Indicator id for macro ('DXY'), or the pair for FX ('USD/EUR'). */
  key: string;
  label: string;
}

export function MacroQuickView({ target, onClose, onOpenFull, onCompare }: {
  target: QuickViewTarget;
  onClose: () => void;
  onOpenFull?: () => void;
  /** Load this series into the Compare tab — the same control the Macro and Currencies
   *  tabs offer on their own detail panels. */
  onCompare?: (symbol: string) => void;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<HistoricalPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const indicator = target.kind === 'macro' ? MACRO_INDICATORS.find(m => m.id === target.key) : undefined;
  const unit = indicator?.unit ?? 'idx';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (target.kind === 'macro') {
        // The macro endpoint windows by date, not by timeframe name, and returns the
        // {date, close} shape every chart here already consumes.
        const from = customRange?.from ?? getTimeframeStart(timeframe);
        const res = await fetch(`/api/macro?mode=history&id=${target.key}&from=${from}`);
        const json = await res.json();
        setData(Array.isArray(json) ? json : []);
      } else {
        const [a, b] = target.key.split('/');
        const base = `/api/currencies?mode=historical&from=${a}&to=${b}&timeframe=${timeframe}`;
        const url = customRange ? `${base}&fromDate=${customRange.from}&toDate=${customRange.to}` : base;
        const json = await fetch(url).then(r => r.json()) as { points?: { date: string; rate: number }[] };
        setData((json.points ?? []).map(p => ({ date: p.date, close: p.rate })));
      }
    } catch { setData([]); } finally { setLoading(false); }
  }, [target.kind, target.key, timeframe, customRange]);

  useEffect(() => { load(); }, [load]);

  // "Previous" is the START of the selected window, not the observation before last.
  //
  // The tiles on the Dashboard compare against a year ago, and opening one has to show
  // the same comparison or the panel contradicts the card that opened it. The
  // previous-observation reading was also the less useful of the two here: on a monthly
  // series it is last month, and on a policy rate it is almost always the identical
  // number, so the panel opened on "unchanged" for a rate that had moved 75bp over the
  // window its own chart was drawing.
  const first = data[0]?.close ?? null;
  const firstDate = data[0]?.date ?? null;
  const last = data[data.length - 1]?.close ?? null;
  const fmt = (v: number | null) =>
    v == null ? '—' : target.kind === 'fx' ? v.toFixed(4) : formatMacroValue(v, unit);
  const change = last != null && first != null ? last - first : null;
  const overPeriod = last != null && first != null && first !== 0 ? (last / first - 1) * 100 : null;
  const windowLabel = customRange ? 'Custom' : timeframe;

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <PanelClose onClose={onClose} />
        <div className="flex items-start justify-between gap-2 flex-wrap pr-7">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">{target.label}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {target.kind === 'macro'
                ? `${indicator?.name ?? target.key} · ${indicator?.source.label ?? 'Macro'}`
                : `${target.key} · Currencies`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {onCompare && (
              // The Compare symbol is not the tile key: Compare addresses macro series by
              // indicator id but currencies by their Yahoo pair ticker, which is how the
              // Currencies tab hands one over.
              <button onClick={() => onCompare(
                target.kind === 'macro' ? target.key : `${target.key.replace('/', '')}=X`)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] font-medium">
                <BarChart2 size={12} /> Compare
              </button>
            )}
            {onOpenFull && (
              <button onClick={onOpenFull}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] font-medium">
                Open in {target.kind === 'macro' ? 'Macro' : 'Currencies'} <ArrowUpRight size={12} />
              </button>
            )}
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <Stat label="Latest" value={fmt(last)} />
          {/* The date is spelled out rather than left as "previous": on a monthly or
              quarterly series the start of a 1Y window is not exactly a year back, and
              the reader should see which observation the change is against. */}
          <Stat label={firstDate ? `Previous (${firstDate})` : `Previous (${windowLabel} ago)`}
            value={fmt(first)} />
          <Stat label={`Change (${windowLabel})`}
            value={change == null ? '—' : `${change >= 0 ? '+' : ''}${Math.abs(change) < 1 ? change.toFixed(3) : change.toFixed(2)}`}
            color={change == null ? undefined : change >= 0 ? 'text-up-text' : 'text-down-text'} />
          <Stat label={`Change % (${windowLabel})`}
            value={overPeriod == null ? '—' : `${overPeriod >= 0 ? '+' : ''}${overPeriod.toFixed(2)}%`}
            color={overPeriod == null ? undefined : overPeriod >= 0 ? 'text-up-text' : 'text-down-text'} />
        </div>

        {loading ? (
          <div className="h-[220px] flex items-center justify-center"><LoadingSpinner /></div>
        ) : data.length > 1 ? (
          <PriceChart data={data} symbol={target.key} height={220}
            isCurrency={target.kind === 'fx'}
            onSetRange={(from, to) => setCustomRange({ from, to })} />
        ) : (
          <p className="h-[220px] flex items-center justify-center text-xs text-gray-600">
            No data for this window.
          </p>
        )}
      </div>
    </DetailModal>
  );
}
