'use client';

import clsx from 'clsx';
import { Star } from 'lucide-react';
import { PHASE_META, RotationPhase, ROTATION_PHASES } from '@/lib/rotationPhase';
import { Volatility, VolBand, VOL_BANDS, fmtVol, upShare, computeVolatility } from '@/lib/volatility';

// Small shared pieces so every section (Indexes, Crypto, Commodities, Sectors,
// Stocks…) shows the rotation phase + a shared pin with one line each.

export function PhaseChip({ phase }: { phase: RotationPhase | null | undefined }) {
  if (!phase) return null;
  const m = PHASE_META[phase];
  return (
    <span className={clsx('shrink-0 text-[9px] px-1.5 py-0.5 rounded leading-none font-medium', m.cls)} title={m.hint}>
      {m.label}
    </span>
  );
}

export function PinButton({ pinned, onToggle, className }: { pinned: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={clsx('shrink-0 p-0.5 rounded transition-colors', pinned ? 'text-amber-300' : 'text-gray-700 hover:text-gray-400', className)}
      title={pinned ? 'Unpin' : 'Pin — remembered across every tab'}
    >
      <Star size={12} className={pinned ? 'fill-amber-300' : ''} />
    </button>
  );
}

export type PhaseFilter = RotationPhase | 'all';

// True when a price sits below the given moving average (i.e. "under the 200D/200W MA").
export const isBelowMA = (price?: number | null, ma?: number | null): boolean =>
  ma != null && isFinite(ma) && price != null && price > 0 && price < ma;

// Filter row: All / the four phases / Pinned. Place it above a section's existing filters.
export function RotationFilterBar({
  phaseFilter, setPhaseFilter, pinnedOnly, setPinnedOnly, pinnedCount,
}: {
  phaseFilter: PhaseFilter;
  setPhaseFilter: (p: PhaseFilter) => void;
  pinnedOnly: boolean;
  setPinnedOnly: (v: boolean) => void;
  pinnedCount: number;
}) {
  const chip = (active: boolean) => clsx(
    'px-2.5 py-1 text-[11px] font-semibold rounded-full transition-all whitespace-nowrap shrink-0 border',
    active ? 'bg-accent text-white border-accent' : 'text-gray-400 border-border hover:border-border-light hover:text-gray-200',
  );
  return (
    <div className="flex gap-1.5 items-center overflow-x-auto scrollbar-hide pb-0.5">
      <button onClick={() => setPhaseFilter('all')} className={chip(phaseFilter === 'all')}>All</button>
      {ROTATION_PHASES.map(p => (
        <button key={p} onClick={() => setPhaseFilter(p)}
          className={clsx(chip(phaseFilter === p), phaseFilter !== p && PHASE_META[p].cls.replace('bg-', 'hover:bg-'))}>
          {PHASE_META[p].label}
        </button>
      ))}
      <span className="w-px h-4 bg-border shrink-0" />
      <button onClick={() => setPinnedOnly(!pinnedOnly)} className={chip(pinnedOnly)} title="Show only pinned assets">
        ★ Pinned{pinnedCount ? ` (${pinnedCount})` : ''}
      </button>
    </div>
  );
}

// "< 200D" / "< 200W" toggles, styled to sit INSIDE the timeframe / sort pill bar
// (rounded-md like the sort buttons), after the timeframe options.
export function MAFilterChips({
  below200d, setBelow200d, below200w, setBelow200w,
}: {
  below200d: boolean;
  setBelow200d: (v: boolean) => void;
  below200w: boolean;
  setBelow200w: (v: boolean) => void;
}) {
  const chip = (active: boolean) => clsx(
    'px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap shrink-0',
    active ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100',
  );
  return (
    <>
      <span className="w-px h-4 bg-border shrink-0 self-center mx-0.5" />
      <button onClick={() => setBelow200d(!below200d)} className={chip(below200d)} title="Only assets trading below their 200-day moving average">&lt; 200D</button>
      <button onClick={() => setBelow200w(!below200w)} className={chip(below200w)} title="Only assets trading below their 200-week moving average">&lt; 200W</button>
    </>
  );
}

// ── Volatility ──────────────────────────────────────────────────────────────
// One line on a card: how much the asset moves, and how much of that movement is
// upward. The second number is what makes the first worth reading — two assets can
// carry the same 25% and be nothing alike to hold.

export function VolatilityLine({ vol }: { vol: Volatility | null | undefined }) {
  if (!vol) return null;
  const share = upShare(vol);
  return (
    <p
      className="text-[9px] leading-[1.35] tabular-nums mt-0.5"
      title={`Annualised volatility over the asset's whole history (${vol.from} → ${vol.to}, ${vol.bars.toLocaleString('en-US')} days).\nUp ${fmtVol(vol.up)} is the part contributed by rising days, down ${fmtVol(vol.down)} the part from falling ones; they combine in quadrature to the total.\n${share == null ? '' : `${share.toFixed(0)}% of the movement is upward — 50% would be perfectly balanced.`}`}
    >
      <span className="text-gray-500">Vol:</span>{' '}
      <span className="text-gray-300">{fmtVol(vol.total)}</span>{' '}
      <span className="text-emerald-400">↑{fmtVol(vol.up)}</span>{' '}
      <span className="text-red-400">↓{fmtVol(vol.down)}</span>
    </p>
  );
}

export type VolFilter = VolBand | 'all';

/** "< 15%" / "15–30%" / "> 30%" toggles, styled to sit inside the timeframe pill bar. */
export function VolFilterChips({ value, setValue }: { value: VolFilter; setValue: (v: VolFilter) => void }) {
  const chip = (active: boolean) => clsx(
    'px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap shrink-0',
    active ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100',
  );
  return (
    <>
      <span className="w-px h-4 bg-border shrink-0 self-center mx-0.5" />
      <span className="text-[10px] text-gray-600 self-center pr-0.5 shrink-0">Vol</span>
      {VOL_BANDS.map(b => (
        <button
          key={b.id}
          onClick={() => setValue(value === b.id ? 'all' : b.id)}
          className={chip(value === b.id)}
          title={b.hint}
        >
          {b.label}
        </button>
      ))}
    </>
  );
}

/**
 * Volatility over the PERIOD ON SCREEN, for the header of an open asset.
 *
 * Deliberately not the same number as the card's: the card answers "what kind of asset is
 * this" from its whole history, this answers "what has it been like lately" over exactly
 * the window the chart is drawing. Change the timeframe and this changes with it — that is
 * the point of having both.
 */
export function PeriodVolatility({ points, label }: {
  points: { date: string; close: number }[] | undefined;
  label: string;
}) {
  const vol = computeVolatility(points);
  if (!vol) return null;
  const share = upShare(vol);
  return (
    <div
      className="shrink-0 rounded-lg border border-border bg-bg-card/60 px-2 py-1 leading-tight"
      title={`Annualised volatility over the ${label} window on screen (${vol.from} → ${vol.to}, ${vol.bars.toLocaleString('en-US')} days).\nUp is the part contributed by rising days, down the part from falling ones; they combine in quadrature to the total.\n${share == null ? '' : `${share.toFixed(0)}% of the movement is upward — 50% would be perfectly balanced.`}\nThe figure on the card is the same measure over the asset's whole history.`}
    >
      <p className="text-[8px] uppercase tracking-wider text-gray-600">Volatility · {label}</p>
      <p className="text-xs font-bold text-gray-100 tabular-nums">{fmtVol(vol.total)}</p>
      <p className="text-[9px] tabular-nums">
        <span className="text-emerald-400">↑{fmtVol(vol.up)}</span>{' '}
        <span className="text-red-400">↓{fmtVol(vol.down)}</span>
      </p>
    </div>
  );
}
