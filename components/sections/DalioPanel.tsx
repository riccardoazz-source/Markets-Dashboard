'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import {
  rankEms, DalioInput, EmsEval, CyclePhase,
  DALIO_W_V, DALIO_W_M, DALIO_W_P, DALIO_VOL_FLOOR, DALIO_VOL_SPIKE, DALIO_BENCHMARK,
} from '@/lib/dalioModel';

// ─────────────────────────────────────────────────────────────────────────────
// Dalio EMS panel — the transparency view of the LIVE model (M31): the same
// formula that drives the Accelerating list, the Quadrant Y-axis and the
// backtest (MODEL_MODE = 'dalio' in lib/rotationModel.ts). This panel shows the
// full V / M / C decomposition and the cycle phase for every asset.
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
  'recovering': 'Above trend, >5% below the 52-week high, volume normal',
  'early trend': 'Within 5% of the 52w high and ≤15% above the 200D MA — healthy momentum (C = 1)',
  'stretched': '15–20% above the 200-day MA near the high — late-cycle warning zone',
  'blow-off': '>20% above the 200D MA, or >5% below the high on a volume spike — over-extension',
};

export function DalioPanel({ items, pins, groupFilter }: {
  items: DalioInput[];
  pins: Set<string>;
  groupFilter: string; // 'all' or a group name — display filter only (evaluation is universe-wide)
}) {
  const [open, setOpen] = useState(false);
  const [showRest, setShowRest] = useState(false);

  // Score the WHOLE universe (the M percentile and the RelStr benchmark need
  // everything), then filter what is displayed by the active group.
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
        <span className="block text-[9px] text-gray-600">{e.group}{e.hasVolume ? '' : ' · no volume → VolRatio 1.0 neutral'}</span>
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums font-semibold', e.ems == null ? 'text-gray-600' : e.ems > 0.2 ? 'text-green-300' : 'text-gray-300')}>
        {e.ems == null ? '—' : e.ems.toFixed(3)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.V > 0 ? 'text-green-400' : 'text-gray-400')}
        title={e.hasVolume ? `V = max(0, VolRatio − ${DALIO_VOL_FLOOR}) = ${e.V.toFixed(3)}` : `no volume → V = 0.2·range-expansion = ${e.V.toFixed(3)}`}>
        {e.hasVolume ? fmtX(e.volRatio) : `~${e.V.toFixed(2)}`}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.ret20))}
        title={`M_final = blend(20d/3M/6M) × confirmed × (1−blow-off) = ${e.mFinal.toFixed(2)}${e.confirmed ? '' : ' · UNCONFIRMED (need Price>MA200 & 3M>0)'}`}>
        {e.mFinal.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-sky-300"
        title="Persistence = percentile of (3-month return ÷ 20-day return) — trend-quality axis">
        {e.persistPct.toFixed(2)}
      </td>
      <td className={clsx('px-2 py-1.5 text-center text-xs tabular-nums', e.C === 1 ? 'text-green-400 font-semibold' : e.C === 0 ? 'text-red-400' : 'text-gray-600')}>
        {e.C ?? '—'}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.distMA != null && e.distMA > 0.15 ? (e.distMA > 0.20 ? 'text-red-400' : 'text-amber-400') : 'text-gray-400')}>
        {e.distMA == null ? '—' : fmtPct(e.distMA * 100, 0)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.rs20))}
        title={`Hard pre-filter: RelStr > 0 vs ${DALIO_BENCHMARK} required to enter the ranking`}>
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
          <span className="text-sm font-semibold text-sky-300">🌊 Dalio EMS — the live model (M31)</span>
          <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
            {ranked.length} ranked
          </span>
        </div>
        <span className="text-[10px] text-gray-600 hidden sm:inline">EMS = C · ({DALIO_W_V}·V + {DALIO_W_M}·M + {DALIO_W_P}·Persist) — flow × momentum × trend-quality</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug px-1">
            V = max(0, VolRatio − {DALIO_VOL_FLOOR}) (volume-blind → 0.2·range-expansion) ·
            M_final = [0.5·pctile(20d) + 0.3·pctile(3M) + 0.2·pctile(6M)] × confirmed(Price&gt;MA200 &amp; 3M&gt;0) × (1 − blow-off) ·
            Persistence = pctile(3M ÷ 20d return) ·
            C = 1 when <em>near the 52w high &amp; ≤15% over MA200</em>, or <em>a rebound &gt;5% off the high on a ≥{DALIO_VOL_SPIKE}× volume surge above MA200</em>, or <em>above MA200 in a 6-month uptrend</em>.
            Hard pre-filter: RelStr vs {DALIO_BENCHMARK} &gt; 0. Ties break by VolRatio, then 20d return.
            This IS the live rotation model — the same ranking drives the Accelerating list, the Quadrant and the Backtest.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-[10px] text-gray-600 font-medium">
                  <th className="w-8 px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Asset</th>
                  <th className="px-2 py-1.5 text-right" title={`EMS = C · (${DALIO_W_V}·V + ${DALIO_W_M}·M_final + ${DALIO_W_P}·Persistence)`}>EMS</th>
                  <th className="px-2 py-1.5 text-right" title="Flow: VolRatio (5d÷60d ADV, smoothed) for volume assets; range-expansion proxy (~x) for volume-blind">V</th>
                  <th className="px-2 py-1.5 text-right" title="M_final = blend(20d/3M/6M return percentiles) × confirmed(Price>MA200 & 3M>0) × (1−blow-off)">M_final</th>
                  <th className="px-2 py-1.5 text-right" title="Persistence = percentile of 3M÷20d return — trend-quality (durable vs one-month pop)">Persist</th>
                  <th className="px-2 py-1.5 text-center" title="3-branch cycle gate — see the formula line above">C</th>
                  <th className="px-2 py-1.5 text-right" title="Distance from the 200-day moving average (DistMA)">vs 200D</th>
                  <th className="px-2 py-1.5 text-right" title={`20d return minus ${DALIO_BENCHMARK} — HARD pre-filter (> 0) + tie-break`}>RelStr</th>
                  <th className="px-2 py-1.5 text-left">Cycle phase</th>
                </tr>
              </thead>
              <tbody>
                {ranked.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-4 text-center text-xs text-gray-600 border-t border-border/60">
                    No asset currently passes the cycle gate + RelStr pre-filter with a positive signal.
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
              <table className="w-full text-sm min-w-[860px]">
                <tbody>{rest.map((e, i) => row(e, i, true))}</tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            Assets without reliable volume (futures, indices, some foreign listings) carry the NEUTRAL VolRatio 1.0 per the directive —
            they rank on momentum + cycle gate and are never penalised for missing data. ⭐ = human macro flag (display only — not in the formula).
            SeasonFactor deliberately deferred. Run the Backtest panel to compare M31 against the previous models.
          </p>
        </div>
      )}
    </div>
  );
}
