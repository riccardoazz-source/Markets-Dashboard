'use client';

import { useRef } from 'react';
import { Printer } from 'lucide-react';

// Save the WHOLE panel — not just the part that fits on screen — as a PDF (or an
// image, from the PDF). A screenshot stops at the fold; the browser's print engine
// paginates everything, so a 40-row returns table or a chart with three indicator
// panes comes out complete.
//
// How the isolation works: instead of moving the panel into a print portal (which
// would unmount and re-render every chart), we walk from the panel up to <body> and
// mark every SIBLING along the way. `.print-hidden` only does anything inside the
// print stylesheet, so the screen never flickers and a class left behind by a
// browser that never fires `afterprint` is harmless.

function isolate(el: HTMLElement): () => void {
  const touched: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node && node.parentElement) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node && sib instanceof HTMLElement && !sib.classList.contains('print-hidden')) {
        sib.classList.add('print-hidden');
        touched.push(sib);
      }
    }
    node = node.parentElement;
  }
  return () => touched.forEach(t => t.classList.remove('print-hidden'));
}

export function PrintButton({ label = 'Print', className }: { label?: string; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);

  const print = () => {
    // Clear anything a previous run left behind before measuring this one.
    document.querySelectorAll('.print-hidden').forEach(el => el.classList.remove('print-hidden'));

    const root = ref.current?.closest('[data-print-root]') as HTMLElement | null;
    if (!root) { window.print(); return; }

    const restore = isolate(root);
    let done = false;
    const cleanup = () => { if (done) return; done = true; restore(); };
    window.addEventListener('afterprint', cleanup, { once: true });

    // A frame for the classes to land, then print. Chrome blocks here until the
    // dialog closes, so the call after it is already "afterwards"; Safari does not,
    // which is what the afterprint listener is for.
    requestAnimationFrame(() => {
      window.print();
      setTimeout(cleanup, 500);
    });
  };

  return (
    <button
      ref={ref}
      onClick={print}
      title="Save this whole panel as PDF — the full chart and every row, not just what fits on screen"
      className={className ?? 'flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium'}
    >
      <Printer size={13} />
      {label}
    </button>
  );
}
