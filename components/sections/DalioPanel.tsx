'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import {
  rankDalio, DalioInput, DalioEval,
  DALIO_RVOL_SHORT_MIN, DALIO_RVOL_MED_MIN, DALIO_GUARD_MA200_MAX, DALIO_GUARD_52W_PCT, DALIO_BENCHMARK,
} from '@/lib/dalioModel';

// ─────────────────────────────────────────────────────────────────────────────
// Dalio Early-Momentum panel — the coefficient-free rotation model, rendered
// side-by-side with the quantitative model (which stays untouched). Fully
// removable: delete this file + lib/dalioModel.ts + the render line in
// RotationSection (the rvol5/rvol20/r20 route fields are harmless extras).
// ─────────────────────────────────────────────────────────────────────────────

const fmtX = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}×`);
const fmtPct = (v: number | null, digits = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);
const pctColor = (v: number | null) => (v == null ? 'text-gray-600' : v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400');

export function DalioPanel({ items, pins, groupFilter }: {
  items: DalioInput[];
  pins: Set<string>;
  groupFilter: string; // 'all' or a group name — display filter only (evaluation is universe-wide)
}) {
  const [open, setOpen] = useState(false);
  const [strict, setStrict] = useState(false);
  const [aggressive, setAggressive] = useState(false);
  const [showRest, setShowRest] = useState(false);

  // Evaluate over the WHOLE universe (benchmark + cross-sectional RS percentile
  // need everything), then filter what is displayed by the active group.
  const ranked = useMemo(
    () => rankDalio(items, { strict, aggressive, macroFlagged: pins }),
    [items, strict, aggressive, pins],
  );
  const visible = groupFilter === 'all' ? ranked : ranked.filter(e => e.group === groupFilter);
  const qualifiers = visible.filter(e => e.qualified);
  const rest = visible.filter(e => !e.qualified);

  const row = (e: DalioEval, i: number, dim: boolean) => (
    <tr key={e.symbol} className={clsx('border-t border-border/60', dim ? 'opacity-50' : 'hover:bg-border/20')}>
      <td className="px-2 py-1.5 text-[11px] text-gray-600 tabular-nums">{dim ? '' : i + 1}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className="text-xs font-medium text-gray-200">{e.name}</span>
        {e.macroBoost && <Star size={10} className="inline ml-1 -mt-0.5 fill-amber-300 text-amber-300" />}
        {e.stretched && !e.excluded && <span className="ml-1 text-[9px] text-amber-400" title="15–20% above the 200-day MA — borderline per the guardrail">⚠ stretched</span>}
        <span className="block text-[9px] text-gray-600">{e.group}{e.hasVolume ? '' : ' · no volume data (gate skipped)'}</span>
      </td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.gates.volume === true ? 'text-green-400 font-semibold' : e.gates.volume === false ? 'text-gray-400' : 'text-gray-600')}>{fmtX(e.rvol5)}</td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.gates.volume === true ? 'text-green-400' : 'text-gray-400')}>{fmtX(e.rvol20)}</td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.r20))}>{fmtPct(e.r20)}</td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(e.rs20))}>{e.rs20 == null ? '—' : `${e.rs20 >= 0 ? '+' : ''}${e.rs20.toFixed(1)}pp`}</td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.dist200 != null && e.dist200 > DALIO_GUARD_MA200_MAX ? 'text-red-400' : e.stretched ? 'text-amber-400' : 'text-gray-400')}>{fmtPct(e.dist200, 0)}</td>
      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', e.nearHighPct != null && e.nearHighPct < DALIO_GUARD_52W_PCT ? 'text-red-400' : 'text-gray-400')}>{e.nearHighPct == null ? '—' : `−${e.nearHighPct.toFixed(1)}%`}</td>
      <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">
        {e.qualified
          ? <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-300 font-semibold">🌊 early momentum</span>
          : e.excluded
            ? <span className="text-red-400" title={e.reasons.join(' · ')}>🚫 blow-off guard</span>
            : <span className="text-gray-600" title={e.reasons.join(' · ')}>{e.reasons[0] ?? '—'}</span>}
      </td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-sky-500/25 bg-bg-card overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover/20 transition text-left">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          <span className="text-sm font-semibold text-sky-300">🌊 Dalio Early Momentum</span>
          <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
            {qualifiers.length} qualify
          </span>
        </div>
        <span className="text-[10px] text-gray-600 hidden sm:inline">volume surge × momentum × relative strength — no coefficients</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Mode toggles */}
          <div className="flex items-center gap-2 flex-wrap px-1">
            <button onClick={() => setStrict(v => !v)}
              className={clsx('px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all',
                strict ? 'border-sky-400 text-sky-300 bg-sky-400/10' : 'border-border text-gray-500 hover:text-gray-300')}
              title="Strict momentum: additionally require 1-month AND 3-month returns > 0">
              Strict momentum {strict ? 'ON' : 'off'}
            </button>
            <button onClick={() => setAggressive(v => !v)}
              className={clsx('px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all',
                aggressive ? 'border-sky-400 text-sky-300 bg-sky-400/10' : 'border-border text-gray-500 hover:text-gray-300')}
              title="Aggressive: medium window only needs > 1.0 instead of ≥ 1.1 — catches earlier moves">
              Aggressive {aggressive ? 'ON' : 'off'}
            </button>
            <span className="text-[10px] text-gray-600">
              Gates: RVOL 5d ≥ {DALIO_RVOL_SHORT_MIN} & 20d {aggressive ? '> 1.0' : `≥ ${DALIO_RVOL_MED_MIN}`} · 20d return &gt; 0{strict ? ' & 1M/3M > 0' : ''} · RS vs {DALIO_BENCHMARK} &gt; 0 · guard: ≤{DALIO_GUARD_MA200_MAX}% above 200D MA, not within {DALIO_GUARD_52W_PCT}% of 52w high
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-[10px] text-gray-600 font-medium">
                  <th className="w-8 px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Asset</th>
                  <th className="px-2 py-1.5 text-right" title="5-day ADV ÷ 60-day baseline, smoothed with a 5-day SMA">RVOL 5d</th>
                  <th className="px-2 py-1.5 text-right" title="20-day ADV ÷ 60-day baseline (raw)">RVOL 20d</th>
                  <th className="px-2 py-1.5 text-right" title="20 trading-day price return">20d ret</th>
                  <th className="px-2 py-1.5 text-right" title={`20d return minus ${DALIO_BENCHMARK} (percentage points)`}>RS vs S&P</th>
                  <th className="px-2 py-1.5 text-right" title="Distance from the 200-day moving average">vs 200D</th>
                  <th className="px-2 py-1.5 text-right" title="Distance below the 52-week high">to 52w high</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {qualifiers.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-4 text-center text-xs text-gray-600 border-t border-border/60">
                    No asset currently passes all gates — early momentum is rare by design.
                  </td></tr>
                )}
                {qualifiers.map((e, i) => row(e, i, false))}
              </tbody>
            </table>
          </div>

          <button onClick={() => setShowRest(v => !v)} className="text-[11px] text-gray-500 hover:text-gray-300 px-1">
            {showRest ? '▾ Hide' : '▸ Show'} non-qualifiers ({rest.length}) with the gate each one fails
          </button>
          {showRest && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <tbody>{rest.map((e, i) => row(e, i, true))}</tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            Workflow: 60-day ADV baseline → 5d &amp; 20d volume ratios (5d smoothed) → hard gates (volume + momentum + relative strength) → blow-off guardrail → ranked by volume ratio, then 20d momentum, then RS percentile. ⭐ pinned assets carry the human macro-catalyst boost (+0.1 on the ordering ratio). Seasonality deliberately deferred (flat baseline first). Assets without reliable volume are ranked on momentum + strength with a neutral 1.0× ratio.
          </p>
        </div>
      )}
    </div>
  );
}
