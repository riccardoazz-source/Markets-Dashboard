'use client';

import { useState, useMemo } from 'react';
import { Grid2x2 } from 'lucide-react';
import { AssetQuadrantView } from './AssetQuadrantView';
import { useGistData, rotationStockSymbols } from '@/lib/gist';

/**
 * "Quadrant" — opens the asset's price with the model's quadrant call underneath,
 * aligned in time. Self-contained (button + modal) so every asset view wires it in
 * with a single line, exactly like ReturnsTableButton.
 */
export function QuadrantButton({ name, symbol, group, stocks }: {
  name: string;
  symbol: string;
  group?: string;
  /** Extra symbols to rank alongside (the Stocks tab passes its watchlist). */
  stocks?: string[];
}) {
  const [open, setOpen] = useState(false);
  // The quadrant Y is a percentile against the universe, so this view has to rank
  // over the SAME set as the Rotation Quadrant or the two could disagree. The stock
  // lists switched on in Rotation are part of that set, wherever the button is used.
  const { data: gistData } = useGistData();
  const universeStocks = useMemo(() => {
    const fromRotation = rotationStockSymbols(gistData);
    return [...new Set([...fromRotation, ...(stocks ?? [])])];
  }, [gistData, stocks]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="See this asset's price against the quadrant the model put it in over time"
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
      >
        <Grid2x2 size={13} />
        <span className="hidden sm:inline">Quadrant</span>
      </button>
      {open && (
        <AssetQuadrantView
          symbol={symbol}
          name={name}
          group={group}
          stocks={universeStocks}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
