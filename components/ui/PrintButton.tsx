'use client';

import { useEffect, useRef, useState } from 'react';
import { Printer, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';

// Save the WHOLE panel — not just the part that fits on screen — as a PDF or a JPG.
// A screenshot stops at the fold; both exports here take the panel's full height, so
// a 40-row returns table or a chart with three indicator panes comes out complete.
//
//   PDF — through the browser's print engine, which paginates. The dialog's
//         "Save as PDF" writes the file (iPhone: Share → Print → Save to Files).
//   JPG — the same panel rasterised to one tall image, downloaded directly.
//
// Both need the same preparation (drop the controls, un-clip whatever scrolls);
// see the export block in globals.css, where the rules exist once for print media
// and once under `html.print-capture` for the rasteriser, which cannot see a print
// stylesheet.
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

// Name the file after whatever the panel calls itself, so a folder of exports is
// readable: "NASDAQ 100 2026-07-29.jpg" rather than "download (3).jpg".
function fileName(root: HTMLElement): string {
  const heading = root.querySelector('h1, h2, h3')?.textContent?.trim();
  const date = new Date().toISOString().slice(0, 10);
  const base = (heading || 'MarketPulse').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60);
  return `${base} ${date}`;
}

export function PrintButton({ label = 'Print', className }: { label?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const rootOf = () => ref.current?.closest('[data-print-root]') as HTMLElement | null;

  const asPdf = () => {
    setOpen(false);
    // Clear anything a previous run left behind before measuring this one.
    document.querySelectorAll('.print-hidden').forEach(el => el.classList.remove('print-hidden'));

    const root = rootOf();
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

  const asJpg = async () => {
    setOpen(false);
    const root = rootOf();
    if (!root) return;
    setBusy(true);
    setError(null);
    // Loaded on demand: the rasteriser is only needed the moment someone asks for
    // an image, and it has no business in the bundle everyone downloads.
    document.documentElement.classList.add('print-capture');
    try {
      const { toJpeg } = await import('html-to-image');
      const url = await toJpeg(root, {
        quality: 0.95,
        backgroundColor: '#0d0e16',
        // 2× so the text stays sharp when the image is zoomed; 3× (a phone's own
        // ratio) would make a 20 MB file out of a long panel.
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName(root)}.jpg`;
      a.click();
    } catch {
      setError('Image export failed — use PDF.');
      setTimeout(() => setError(null), 4000);
    } finally {
      document.documentElement.classList.remove('print-capture');
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        title="Save this whole panel — the full chart and every row, not just what fits on screen"
        className={className ?? 'flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium disabled:opacity-50'}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
        {busy ? 'Saving…' : label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-[400] w-44 rounded-lg border border-border bg-bg-card shadow-2xl p-1">
          <MenuItem icon={<FileText size={13} />} title="PDF" hint="Paginated, print dialog" onClick={asPdf} />
          <MenuItem icon={<ImageIcon size={13} />} title="JPG" hint="One tall image" onClick={asJpg} />
        </div>
      )}

      {error && (
        <p className="absolute right-0 top-full mt-1 z-[400] whitespace-nowrap text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}

function MenuItem({ icon, title, hint, onClick }: {
  icon: React.ReactNode; title: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-bg-input transition-colors"
    >
      <span className="text-gray-400 mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-gray-200">{title}</span>
        <span className="block text-[10px] text-gray-500">{hint}</span>
      </span>
    </button>
  );
}
