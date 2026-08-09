'use client';

// The model's current call on one asset, as a chip next to its name.
//
// Every panel that opens an asset — the section detail views, the quick view and the
// quadrant view — shows the same chip from the same source, so the answer to "what is
// this thing doing right now" is one glance and is never two different answers in two
// places. It reads the shared rotation cache (lib/useRotationPhases), which fetches the
// universe once for the whole page, so adding it to a header costs no extra request.
//
// Nothing is drawn while it is unknown. FX pairs are not in the rotation universe and an
// asset without enough history has no position in the cycle: a chip guessing at one would
// be worse than no chip.

import { useRotationPhases } from '@/lib/useRotationPhases';
import { PHASE_META, RotationPhase } from '@/lib/rotationPhase';
import clsx from 'clsx';

export function PhaseBadge({ symbol, className }: { symbol: string; className?: string }) {
  // Passed as an extra so a stock ticker outside the base universe resolves too; for
  // anything already in it this is a cache hit.
  const phases = useRotationPhases([symbol]);
  const phase = phases.get(symbol) as RotationPhase | undefined;
  if (!phase) return null;
  const meta = PHASE_META[phase];
  return (
    <span
      title={meta.hint}
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold align-middle whitespace-nowrap',
        meta.cls,
        className,
      )}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
      {meta.label}
    </span>
  );
}
