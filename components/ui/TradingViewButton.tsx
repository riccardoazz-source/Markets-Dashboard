'use client';

import { useEffect, useState } from 'react';
import { CandlestickChart, ExternalLink, X } from 'lucide-react';
import { tradingViewSymbol, tradingViewIsProxy } from '@/lib/tradingview';

/**
 * "TradingView" — opens THIS asset's TradingView chart in a panel, like Quadrant and
 * the returns table, instead of throwing the reader out to another tab.
 *
 * The chart is TradingView's own embed (s.tradingview.com/widgetembed), which is the
 * only page of theirs that may be framed — tradingview.com/chart sets X-Frame-Options
 * and would render an empty box.
 *
 * The chart is drawn IMMEDIATELY from the table in lib/tradingview.ts. /api/tv-symbol
 * then asks TradingView's search whether that symbol exists and may swap in a better
 * one, but it can only ever correct the chart — never delay it and never withhold it.
 * The first version of this had the resolver decide whether to draw at all, and one
 * unexpected answer from their search took every chart down at once; a check that can
 * turn the feature off is worse than the mistake it was added to catch.
 *
 * Even a verified symbol is not a guarantee: exchanges that require an entitlement —
 * KRX, SGX and others — are correct symbols the embed may not serve, and there too it
 * draws its default rather than complaining. Nothing in the page can detect that, the
 * frame being another origin. So the two defences are the ones a reader can use: the
 * header carries our symbol, TradingView's, and the name TRADINGVIEW gives the
 * instrument, and "Full site" opens the real chart, which does serve those exchanges.
 */
interface Resolved { tv: string | null; description?: string; verified: boolean; corrected?: boolean }

export function TradingViewButton({ symbol, name, group }: {
  symbol: string;
  /** Our name for the asset — used to resolve, and shown beside TradingView's. */
  name?: string;
  group?: string;
}) {
  const [open, setOpen] = useState(false);
  const candidate = tradingViewSymbol(symbol, group);
  // Nothing in our table means nothing to even ask about.
  if (!candidate) return null;

  const cls = 'flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Open the TradingView chart for this asset"
        className={cls}
      >
        <CandlestickChart size={13} />
        <span className="hidden sm:inline">TradingView</span>
      </button>
      {open && <TradingViewPanel symbol={symbol} name={name} group={group} onClose={() => setOpen(false)} />}
    </>
  );
}

function TradingViewPanel({ symbol, name, group, onClose }: {
  symbol: string; name?: string; group?: string; onClose: () => void;
}) {
  const [res, setRes] = useState<Resolved | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ symbol, name: name ?? '', group: group ?? '' });
    fetch(`/api/tv-symbol?${q}`)
      .then(r => r.json())
      .then((d: Resolved) => { if (!cancelled && d?.tv) setRes(d); })
      .catch(() => {/* the table's symbol is already on screen; nothing to do */});
    return () => { cancelled = true; };
  }, [symbol, name, group]);

  const proxy = tradingViewIsProxy(symbol);
  // The table first, the resolver only if it came back with something. This is why the
  // chart appears at once and why an unreachable resolver costs nothing.
  const tv = res?.tv ?? tradingViewSymbol(symbol, group);
  const url = tv ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}` : null;

  // Their embed reads its configuration from the query string. Daily candles, dark to
  // match the app, range buttons on, and the symbol locked — this window is about THIS
  // asset, and a reader who wants to wander has the link in the corner.
  const src = tv ? 'https://s.tradingview.com/widgetembed/?' + new URLSearchParams({
    symbol: tv,
    interval: 'D',
    theme: 'dark',
    style: '1',
    locale: 'en',
    timezone: 'Etc/UTC',
    withdateranges: '1',
    hide_side_toolbar: '1',
    allow_symbol_change: '0',
    save_image: '0',
  }).toString() : null;

  return (
    <div className="fixed inset-0 z-[160] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6"
      onClick={onClose}>
      <div className="w-full max-w-6xl rounded-2xl border border-border bg-bg-card overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <CandlestickChart size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-200 truncate">{name ?? symbol}</p>
            {/* Both symbols and TradingView's OWN name for the instrument: this is the
                line on which a wrong mapping gives itself away. */}
            <p className="text-[10px] text-gray-500 truncate">
              {symbol}{tv ? ` → ${tv}` : ''}
              {res?.description ? ` · ${res.description}` : ''}
              {proxy ? ' · tracking fund, not the index itself' : ''}
            </p>
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px]"
              title="Open on tradingview.com">
              <ExternalLink size={12} /> <span className="hidden sm:inline">Full site</span>
            </a>
          )}
          <button onClick={onClose} title="Close"
            className={`${url ? '' : 'ml-auto '}p-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors`}>
            <X size={13} />
          </button>
        </div>

        {res?.corrected && (
          <p className="text-[10px] text-gray-500 px-3 py-1.5">
            Resolved by TradingView&apos;s search — our own mapping for this asset did not exist there.
          </p>
        )}

        <div className="bg-[#131722]" style={{ height: 'min(72vh, 620px)' }}>
          {src ? (
            <iframe
              key={src}
              src={src}
              title={`TradingView chart — ${tv}`}
              className="w-full h-full block"
              style={{ border: 0 }}
              allow="clipboard-write"
              referrerPolicy="origin"
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6 text-center">
              <p className="text-xs text-gray-500 max-w-md">
                TradingView has no chart for <span className="text-gray-300">{symbol}</span>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
