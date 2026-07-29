'use client';

import { useEffect } from 'react';
import { PrintButton } from './PrintButton';

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
    <div className="fixed inset-0 z-[150] overflow-y-auto bg-black/60 backdrop-blur-sm print-flow" onClick={onClose}>
      {/* min-h-full + items-center: short panels are vertically centred, tall panels
          grow and the overlay scrolls (standard robust modal pattern). */}
      <div className="flex min-h-full items-start sm:items-center justify-center p-2 sm:p-6 print-flow">
        {/* Cap at 6xl (~1152px): on desktop the viewport fills up to that; on mobile the
            viewport is smaller than the cap so the panel still fills the screen. */}
        {/* data-print-root: everything inside is what "Print" saves — one place, so
            every panel opened as a modal gets it without touching its own header. */}
        <div className="w-full max-w-6xl" data-print-root onClick={e => e.stopPropagation()}>
          {/* Its own row rather than squeezed into the panel's header, which on a
              phone is already wrapping onto three lines. */}
          <div className="flex justify-end mb-1" data-print-hide>
            <PrintButton />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
