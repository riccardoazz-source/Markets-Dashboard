'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import {
  rankEms, DalioInput, EmsEval, CyclePhase,
  DALIO_W_V, DALIO_W_M, DALIO_W_P, DALIO_W_TREND, DALIO_VOL_FLOOR, DALIO_DISTMA_KNEE, DALIO_R2_MIN, DALIO_BENCHMARK,
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
  'recovering': 'Above the 200D MA but the 12-month trend is not yet clean (R² ≤ 0.5)',
  'early trend': '≤15% above the 200D MA with a clean 12-month trend (R² > 0.5) — the C = 1 zone',
  'stretched': '15–20% above the 200-day MA — past the distance cap',
  'blow-off': '>20% above the 200-day MA — blow-off risk',
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
        <span className="block text-[9px] text-gray-600">{e.group}{e.hasVolume ? '' : ' · no volume → range-expansion flow'}</span>
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums font-semibold', e.ems == null ? 'text-gray-600' : e.ems > 0.2 ? 'text-green-300' : 'text-gray-300')}>
        {e.ems == null ? '—' : e.ems.toFixed(3)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.V > 0 ? 'text-green-400' : 'text-gray-400')}
        title={e.hasVolume ? `V = max(0, VolRatio − ${DALIO_VOL_FLOOR}) = ${e.V.toFixed(3)}` : `no volume → V = 0.2·range-expansion = ${e.V.toFixed(3)}`}>
        {e.hasVolume ? fmtX(e.volRatio) : `~${e.V.toFixed(2)}`}
      </td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-gray-300"
        title="M = 0.4·pctile(20d) + 0.3·pctile(3M) + 0.3·pctile(12M) return">
        {e.M.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-sky-300"
        title="Persistence = percentile of (20-day ÷ 3-month return) — acceleration (recent pace vs older)">
        {e.persistPct.toFixed(2)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums',
        e.r2_12m == null ? 'text-gray-600' : e.r2_12m > DALIO_R2_MIN ? 'text-green-400' : 'text-red-400')}
        title="R² of the trailing 12-month trend — a clean, durable trend (> 0.5) vs a spiky/volatile one">
        {e.r2_12m == null ? '—' : e.r2_12m.toFixed(2)}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.distMA != null && e.distMA > DALIO_DISTMA_KNEE ? (e.distMA > 0.20 ? 'text-red-400' : 'text-amber-400') : 'text-gray-400')}>
        {e.distMA == null ? '—' : fmtPct(e.distMA * 100, 0)}
      </td>
      <td className="px-2 py-1.5 text-center text-xs tabular-nums whitespace-nowrap"
        title={`accel overlay +${(e.accelBoost * 100).toFixed(0)}% · quiet-accumulation +${(e.drawdownQuality * 100).toFixed(0)}% · blow-off decay ${e.decay.toFixed(2)}× · commodity overheat ${(e.overheat * 100).toFixed(0)}% · ExitFactor ${e.exitFactor.toFixed(2)}`}>
        {e.drawdownQuality > 0 && <span className="text-emerald-400" title="quiet accumulation in a base">🟢</span>}
        {e.accelBoost > 0 && <span className="text-sky-400" title="accelerating (5d vs 20d)">⚡</span>}
        {e.decay < 1 && <span className="text-red-400">⤵</span>}
        {e.overheat > 0 && <span className="text-red-400">🔥</span>}
        {e.exitFactor < 1 && <span className="text-amber-400">↓</span>}
        {e.drawdownQuality === 0 && e.accelBoost === 0 && e.decay === 1 && e.overheat === 0 && e.exitFactor === 1 && <span className="text-gray-600">—</span>}
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.rs20))}
        title={`RelStr = 20d return − ${DALIO_BENCHMARK} — tie-break only in v3`}>
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
        <span className="text-[10px] text-gray-600 hidden sm:inline">Score = decay·({DALIO_W_V}·V + {DALIO_W_M}·M + {DALIO_W_P}·Persist)·(1−0.5·Overheat)·ExitFactor + {DALIO_W_TREND}·TrendQuality</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug px-1">
            V = max(0, VolRatio − {DALIO_VOL_FLOOR}) (volume-blind → 0.2·range-expansion) ·
            M = 0.4·pctile(20d) + 0.3·pctile(3M) + 0.3·pctile(12M) return ·
            Persistence = pctile(20d ÷ 3M return) (acceleration) ·
            TrendQuality = min(1, R²/0.8) added with weight {DALIO_W_TREND}.
            Two v5 boosts: <em>acceleration</em> (⚡, when 5-day pace &gt; 20-day) and <em>quiet accumulation</em> (🟢, a quality name in a base with volume building — the falling-winner catch).
            The blow-off <em>decay</em> (⤵) only bites when a name is &gt;{(DALIO_DISTMA_KNEE * 100).toFixed(0)}% above its MA <em>and</em> up &gt;30% in 20 days; commodity overheat (🔥) and an exhaustion ExitFactor (↓) also damp the score.
            A light class tilt (stocks ×1.2, indices ×0.8) favours the high-beta leaders. Ranked globally; ties break by VolRatio, then RelStr.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="text-[10px] text-gray-600 font-medium">
                  <th className="w-8 px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Asset</th>
                  <th className="px-2 py-1.5 text-right" title={`FinalScore = C · (${DALIO_W_V}·V + ${DALIO_W_M}·M + ${DALIO_W_P}·Persistence) · (1−0.5·Overheat) · ExitFactor`}>EMS</th>
                  <th className="px-2 py-1.5 text-right" title="Flow: VolRatio (5d÷60d ADV, smoothed) for volume assets; range-expansion proxy (~x) for volume-blind">V</th>
                  <th className="px-2 py-1.5 text-right" title="M = 0.4·pctile(20d) + 0.3·pctile(3M) + 0.3·pctile(12M) return">M</th>
                  <th className="px-2 py-1.5 text-right" title="Persistence = percentile of 20d÷3M return — acceleration (recent pace vs older)">Persist</th>
                  <th className="px-2 py-1.5 text-right" title="R² of the trailing 12-month trend — soft TrendQuality reward (not a gate)">R²</th>
                  <th className="px-2 py-1.5 text-right" title="Distance from the 200-day moving average (DistMA)">vs 200D</th>
                  <th className="px-2 py-1.5 text-center" title="Boosts/brakes: 🟢 quiet accumulation · ⚡ acceleration (5d/20d) · ⤵ blow-off decay · 🔥 commodity overheat · ↓ exhaustion">flags</th>
                  <th className="px-2 py-1.5 text-right" title={`20d return minus ${DALIO_BENCHMARK} — tie-break only in v3`}>RelStr</th>
                  <th className="px-2 py-1.5 text-left">Cycle phase</th>
                </tr>
              </thead>
              <tbody>
                {ranked.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-4 text-center text-xs text-gray-600 border-t border-border/60">
                    No asset currently has a positive EMS.
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
              <table className="w-full text-sm min-w-[960px]">
                <tbody>{rest.map((e, i) => row(e, i, true))}</tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            Assets without reliable volume (futures, indices, some foreign listings) get their flow from a range-expansion proxy (V = 0.2·range-exp),
            so they still compete on momentum + trend-quality without being penalised for missing volume. ⭐ = human macro flag (display only — not in the formula).
            SeasonFactor deferred. Run the Backtest panel to compare M31 v3 against the previous models.
          </p>
        </div>
      )}
    </div>
  );
}
