'use client';

import clsx from 'clsx';

// One stat card, used by every asset panel.
//
// It was a two-line block — caption above, value below — and eleven of them filled
// three rows before the chart even started. On a stock panel that pushed the price
// below the fold, which is the wrong trade: these numbers are a reference, the
// chart is the subject. Label and value now share a line, so a card is a third of
// the height it was and the grid packs more per row.
//
// It lives here rather than in each section so every panel opens at the SAME scale.
// Eight copies of the same component drift apart, and then two panels that show the
// same thing look like different products.
export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-md px-2 py-1 flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[9px] text-gray-500 truncate" title={label}>{label}</span>
      <span className={clsx('text-[11px] font-bold tabular-nums shrink-0', color ?? 'text-gray-100')}>{value}</span>
    </div>
  );
}

/** The grid the cards sit in — dense, so a long stat list costs rows, not screens. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
      {children}
    </div>
  );
}
