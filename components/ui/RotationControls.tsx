'use client';

import clsx from 'clsx';
import { Star } from 'lucide-react';
import { PHASE_META, RotationPhase, ROTATION_PHASES } from '@/lib/rotationPhase';

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
