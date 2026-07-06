'use client';

import { useEffect } from 'react';

// Shared centered-popup wrapper for asset detail panels. Sections used to render the
// detail inline at the bottom of the page; wrapping the SAME panel in this modal makes
// clicking an asset open it directly as a pop-up (like the Returns table) — no scroll
// to the bottom. All the panel's own controls (timeframe, Compare/Returns/AI, tools,
// data table, notes) keep working unchanged. Closes on backdrop click or Escape; the
// panel's existing ✕ button (setSelected(null)) closes it too.
export function DetailModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // lock background scroll while open
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[150] overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={onClose}>
      {/* min-h-full + items-center: short panels are vertically centred, tall panels
          grow and the overlay scrolls (standard robust modal pattern). */}
      <div className="flex min-h-full items-start sm:items-center justify-center p-2 sm:p-6">
        {/* Cap at 6xl (~1152px): on desktop the viewport fills up to that; on mobile the
            viewport is smaller than the cap so the panel still fills the screen. */}
        <div className="w-full max-w-6xl" onClick={e => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>
  );
}
