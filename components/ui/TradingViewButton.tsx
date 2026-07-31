'use client';

import { useState } from 'react';
import { CandlestickChart, ExternalLink, X } from 'lucide-react';
import { tradingViewSymbol, tradingViewUrl, tradingViewIsProxy } from '@/lib/tradingview';

/**
 * "TradingView" — opens THIS asset's TradingView chart in a panel, like Quadrant and
 * the returns table, instead of throwing the reader out to another tab.
 *
 * The chart is TradingView's own embed (s.tradingview.com/widgetembed), which is the
 * only page of theirs that may be framed — tradingview.com/chart sets X-Frame-Options
 * and would render an empty box.
 *
 * Renders nothing when the symbol has no safe mapping (see lib/tradingview.ts): a
 * missing button is a small annoyance, a button that opens the wrong instrument is a
 * wrong decision made on the wrong chart. And because the embed prints the
 * instrument's own name and last price, a mapping that ever IS wrong shows itself
 * here, next to ours, instead of hiding in a table.
 */
export function TradingViewButton({ symbol, name, group }: {
  symbol: string;
  /** Our name for the asset, shown beside TradingView's so the two can be compared. */
  name?: string;
  group?: string;
}) {
  const [open, setOpen] = useState(false);
  const tv = tradingViewSymbol(symbol, group);
  const url = tradingViewUrl(symbol, group);
  if (!tv || !url) return null;
  const proxy = tradingViewIsProxy(symbol);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={proxy
          ? 'Open the closest TradingView equivalent — TradingView has no free feed for this index, so this is the tracking ETF, not the same series'
          : `Open the TradingView chart for ${tv}`}
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
      >
        <CandlestickChart size={13} />
        <span className="hidden sm:inline">TradingView{proxy ? ' ≈' : ''}</span>
      </button>
      {open && <TradingViewPanel tv={tv} url={url} name={name} symbol={symbol} proxy={proxy} onClose={() => setOpen(false)} />}
    </>
  );
}

function TradingViewPanel({ tv, url, name, symbol, proxy, onClose }: {
  tv: string; url: string; name?: string; symbol: string; proxy: boolean; onClose: () => void;
}) {
  // Their embed reads its configuration from the query string. Daily candles, dark to
  // match the app, range buttons on, and the symbol locked — this window is about THIS
  // asset, and a reader who wants to wander has the link in the corner.
  const src = 'https://s.tradingview.com/widgetembed/?' + new URLSearchParams({
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
    hidevolume: '0',
  }).toString();

  return (
    <div className="fixed inset-0 z-[160] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6"
      onClick={onClose}>
      <div className="w-full max-w-6xl rounded-2xl border border-border bg-bg-card overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <CandlestickChart size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-200 truncate">{name ?? symbol}</p>
            {/* Both symbols, always: this is the pair that has to match, and showing it
                is what lets a wrong mapping be caught in a second. */}
            <p className="text-[10px] text-gray-500 truncate">{symbol} → {tv}{proxy ? ' · tracking fund, not the index itself' : ''}</p>
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px]"
            title="Open on tradingview.com">
            <ExternalLink size={12} /> <span className="hidden sm:inline">Full site</span>
          </a>
          <button onClick={onClose} title="Close"
            className="p-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors">
            <X size={13} />
          </button>
        </div>
        {/* Tall on desktop, but never taller than the phone it is on. */}
        <iframe
          src={src}
          title={`TradingView chart — ${tv}`}
          className="w-full block bg-[#131722]"
          style={{ height: 'min(72vh, 620px)', border: 0 }}
          allow="clipboard-write"
          referrerPolicy="origin"
        />
      </div>
    </div>
  );
}
