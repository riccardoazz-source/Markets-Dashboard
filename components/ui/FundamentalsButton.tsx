'use client';

import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';

/**
 * "Fundamentals" — the drawer for everything an asset has that is NOT its price.
 *
 * The stocks panel had grown into two things at once: a price chart with the usual
 * tools, and a pile of multiples, earnings, revenue and dividend charts stacked
 * underneath. The second half pushed the first below the fold and, worse, made the
 * panel a different shape from every other asset — so the same chart could not be
 * compared with itself across tabs. Behind a button, the technical view goes back to
 * being identical everywhere and the fundamental data gets a whole panel instead of
 * a crowded tail.
 *
 * A shell rather than a fixed layout: what counts as fundamental differs by asset
 * class (dividends for an index, earnings and multiples for a company), so each
 * section passes its own content.
 */
export function FundamentalsButton({ name, symbol, subtitle, children }: {
  name: string;
  symbol: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Dividends, earnings, revenue and multiples for this asset"
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
      >
        <Landmark size={13} />
        <span className="hidden sm:inline">Fundamentals</span>
      </button>

      {open && (
        <DetailModal onClose={() => setOpen(false)}>
          <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
            <PanelClose onClose={() => setOpen(false)} />
            <div className="min-w-0 pr-7">
              <h3 className="text-base font-bold text-white truncate">{name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {symbol}{subtitle ? ` · ${subtitle}` : ''} · fundamentals
              </p>
            </div>
            {children}
          </div>
        </DetailModal>
      )}
    </>
  );
}
