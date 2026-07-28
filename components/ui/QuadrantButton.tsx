'use client';

import { useState } from 'react';
import { Grid2x2 } from 'lucide-react';
import { AssetQuadrantView } from './AssetQuadrantView';

/**
 * "Quadrant" — opens the asset's price with the model's quadrant call underneath,
 * aligned in time. Self-contained (button + modal) so every asset view wires it in
 * with a single line, exactly like ReturnsTableButton.
 */
export function QuadrantButton({ name, symbol, group, stocks }: {
  name: string;
  symbol: string;
  group?: string;
  /** Watchlist symbols, so a searched stock is ranked inside the same universe. */
  stocks?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="See this asset's price against the quadrant the model put it in over time"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
      >
        <Grid2x2 size={13} />
        Quadrant
      </button>
      {open && (
        <AssetQuadrantView
          symbol={symbol}
          name={name}
          group={group}
          stocks={stocks}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
