'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import {
  rankEms, DalioInput, EmsEval, CyclePhase,
  EMS_W_V, EMS_W_M, EMS_W_C, EMS_VOL_FLOOR, DALIO_BENCHMARK,
} from '@/lib/dalioModel';

// ─────────────────────────────────────────────────────────────────────────────
// Dalio EMS panel — the Early-Momentum Composite Score, rendered side-by-side
// with the quantitative model (which stays untouched). Fully removable:
// delete this file + lib/dalioModel.ts + the render line in RotationSection
// (the rvol5/rvol20/r20 route fields are harmless extras).
// ─────────────────────────────────────────────────────────────────────────────

const fmtX = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}×`);
const fmtPct = (v: number | null, digits = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);
const pctColor = (v: number | null) => (v == null ? 'text-gray-600' : v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400');

const PHASE_STYLE: Record<CyclePhase, string> = {
  'bottoming': 'bg-blue-500/15 text-blue-300',
  'recovering': 'bg-sky-500/15 text-sky-300',
  'early trend': 'bg-green-500/15 text-green-300',
  'stretched': 'bg-amber-500/15 text-amber-300',
  'blow-off': 'bg-red-500/15 text-red-300',
};
const PHASE_HINT: Record<CyclePhase, string> = {
  'bottoming': 'Below the 200-day MA — early/bottoming part of the cycle',
  'recovering': 'Above trend but still >5% below the 52-week high',
  'early trend': 'Above trend (<15% over the 200D MA) and within 5% of the 52w high — the C = 1 zone',
  'stretched': '15–20% above the 200-day MA — late-cycle warning zone',
  'blow-off': '>20% above the 200-day MA — blow-off risk',
};

export function DalioPanel({ items, pins, groupFilter }: {
  items: DalioInput[];
  pins: Set<string>;
  groupFilter: string; // 'all' or a group name — display filter only (evaluation is universe-wide)
}) {
  const [open, setOpen] = useState(false);
  const [showRest, setShowRest] = useState(false);

  // Score the WHOLE universe (the benchmark RS context needs everything),
  // then filter what is displayed by the active group.
  const scored = useMemo(() => rankEms(items, pins), [items, pins]);
  const visible = groupFilter === 'all' ? scored : scored.filter(e => e.group === groupFilter);
  const ranked = visible.filter(e => e.ranked);
  const rest = visible.filter(e => !e.ranked);

  const phaseBadge = (e: EmsEval) => e.phase && (
    <span className={clsx('px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap', PHASE_STYLE[e.phase])}
      title={PHASE_HINT[e.phase]}>
      {e.phase}
    </span>
  );

  const row = (e: EmsEval, i: number, dim: boolean) => (
    <tr key={e.symbol} className={clsx('border-t border-border/60', dim ? 'opacity-50' : 'hover:bg-border/20')}>
      <td className="px-2 py-1.5 text-[11px] text-gray-600 tabular-nums">{dim ? '' : i + 1}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className="text-xs font-medium text-gray-200">{e.name}</span>
        {e.macroFlagged && <Star size={10} className="inline ml-1 -mt-0.5 fill-amber-300 text-amber-300" />}
        <span className="block text-[9px] text-gray-600">{e.group}{e.hasVolume ? '' : ' · momentum-only (no volume → V = 0)'}</span>
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums font-semibold', e.ems == null ? 'text-gray-600' : e.ems > 0.1 ? 'text-green-300' : 'text-gray-300')}>
        {e.ems == null ? '—' : e.ems.toFixed(3)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.V > 0 ? 'text-green-400' : 'text-gray-400')}
        title={`V = max(0, VolRatio − ${EMS_VOL_FLOOR}) = ${e.V.toFixed(3)}`}>
        {fmtX(e.volRatio)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.ret20))}
        title={`M = ${e.M.toFixed(3)}`}>
        {fmtPct(e.ret20)}
      </td>
      <td className={clsx('px-2 py-1.5 text-center text-xs tabular-nums', e.C === 1 ? 'text-green-400 font-semibold' : e.C === 0 ? 'text-red-400' : 'text-gray-600')}>
        {e.C ?? '—'}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.distMA != null && e.distMA >= 0.15 ? (e.distMA > 0.20 ? 'text-red-400' : 'text-amber-400') : 'text-gray-400')}>
        {e.distMA == null ? '—' : fmtPct(e.distMA * 100, 0)}
      </td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-gray-400">
        {e.highDist == null ? '—' : `${(e.highDist * 100).toFixed(1)}%`}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.rs20))}>
        {e.rs20 == null ? '—' : `${e.rs20 >= 0 ? '+' : ''}${e.rs20.toFixed(1)}pp`}
      </td>
      <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">
        {dim
          ? <span className="text-gray-600" title={e.reasons.join(' · ')}>{e.reasons.find(r => !r.startsWith('no volume')) ?? e.reasons[0] ?? '—'}</span>
          : phaseBadge(e)}
      </td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-sky-500/25 bg-bg-card overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover/20 transition text-left">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          <span className="text-sm font-semibold text-sky-300">🌊 Dalio EMS — Early-Momentum Score</span>
          <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
            {ranked.length} ranked
          </span>
        </div>
        <span className="text-[10px] text-gray-600 hidden sm:inline">EMS = {EMS_W_V}·V + {EMS_W_M}·M + {EMS_W_C}·C — volume surge × momentum × cycle gate</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug px-1">
            V = max(0, VolRatio − {EMS_VOL_FLOOR}) where VolRatio = 5d ADV ÷ 60d ADV (5-day smoothed) ·
            M = 20d return if &gt; 0 ·
            C = 1 when &lt;15% above the 200D MA <em>and</em> within 5% of the 52-week high.
            Assets with C = 0 are dropped from the ranking; ties break by VolRatio, then 20d return.
            Cycle phase per asset: bottoming → recovering → early trend → stretched → blow-off.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-[10px] text-gray-600 font-medium">
                  <th className="w-8 px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Asset</th>
                  <th className="px-2 py-1.5 text-right" title={`EMS = ${EMS_W_V}·V + ${EMS_W_M}·M + ${EMS_W_C}·C`}>EMS</th>
                  <th className="px-2 py-1.5 text-right" title="5-day ADV ÷ 60-day baseline, 5-day smoothed (feeds V)">VolRatio</th>
                  <th className="px-2 py-1.5 text-right" title="20 trading-day price return (feeds M)">20d ret</th>
                  <th className="px-2 py-1.5 text-center" title="Cycle gate: 1 when <15% above the 200D MA and within 5% of the 52w high">C</th>
                  <th className="px-2 py-1.5 text-right" title="Distance from the 200-day moving average (DistMA)">vs 200D</th>
                  <th className="px-2 py-1.5 text-right" title="Distance from the 52-week high (HighDist)">vs 52w high</th>
                  <th className="px-2 py-1.5 text-right" title={`20d return minus ${DALIO_BENCHMARK} (context only — not in the EMS formula)`}>RS vs S&P</th>
                  <th className="px-2 py-1.5 text-left">Cycle phase</th>
                </tr>
              </thead>
              <tbody>
                {ranked.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-4 text-center text-xs text-gray-600 border-t border-border/60">
                    No asset currently passes the cycle gate with a positive signal.
                  </td></tr>
                )}
                {ranked.map((e, i) => row(e, i, false))}
              </tbody>
            </table>
          </div>

          <button onClick={() => setShowRest(v => !v)} className="text-[11px] text-gray-500 hover:text-gray-300 px-1">
            {showRest ? '▾ Hide' : '▸ Show'} unranked assets ({rest.length}) with the reason each one is out
          </button>
          {showRest && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <tbody>{rest.map((e, i) => row(e, i, true))}</tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            Weekly/monthly re-rank recommended (the score updates live here). ⭐ = human macro flag (display only — not in the formula).
            Assets without reliable volume (futures, indices, some foreign listings) are scored with V = 0, i.e. on momentum + cycle gate only.
            RS vs {DALIO_BENCHMARK} is shown for context but is not part of the written EMS formula. SeasonFactor deliberately deferred.
          </p>
        </div>
      )}
    </div>
  );
}
