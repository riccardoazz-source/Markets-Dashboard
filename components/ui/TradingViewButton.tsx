'use client';

import { useEffect, useState } from 'react';
import { CandlestickChart, ExternalLink, X } from 'lucide-react';
import { tradingViewSymbol, tradingViewUrl, tradingViewCanEmbed, tradingViewIsProxy } from '@/lib/tradingview';

/**
 * "TradingView" — opens THIS asset's TradingView chart in a panel, like Quadrant and
 * the returns table, instead of throwing the reader out to another tab.
 *
 * The chart is TradingView's own embed (s.tradingview.com/widgetembed), which is the
 * only page of theirs that may be framed — tradingview.com/chart sets X-Frame-Options
 * and would render an empty box.
 *
 * The symbol is RESOLVED against TradingView's search before the chart is drawn (see
 * /api/tv-symbol). That check exists because the embed does not raise an error for a
 * symbol it does not know: it silently loads its default, which is how a mistaken
 * "TVC:KOSPI" came up showing Apple. A wrong chart that looks right is the one thing
 * this component must never do, so the header always carries both symbols and the
 * name TradingView itself gives the instrument.
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

  // A venue the embed cannot serve goes straight to the full site, where it works,
  // rather than into a panel that would draw TradingView's default instrument.
  if (!tradingViewCanEmbed(candidate)) {
    return (
      <a href={tradingViewUrl(symbol, group) ?? '#'} target="_blank" rel="noopener noreferrer" className={cls}
        title={`Open ${candidate} on TradingView — this exchange cannot be shown in an embedded chart`}>
        <ExternalLink size={13} />
        <span className="hidden sm:inline">TradingView</span>
      </a>
    );
  }

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ symbol, name: name ?? '', group: group ?? '' });
    fetch(`/api/tv-symbol?${q}`)
      .then(r => r.json())
      .then((d: Resolved) => { if (!cancelled) setRes(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [symbol, name, group]);

  const proxy = tradingViewIsProxy(symbol);
  const tv = res?.tv ?? null;
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

        {res && !res.verified && (
          <p className="text-[10px] text-amber-400 bg-amber-400/10 px-3 py-1.5">
            ⚠ TradingView&apos;s symbol search could not be reached, so this symbol is unverified — check the name on the chart matches the asset.
          </p>
        )}
        {res?.corrected && (
          <p className="text-[10px] text-gray-500 px-3 py-1.5">
            Resolved by TradingView&apos;s search — our own mapping for this asset did not exist there.
          </p>
        )}

        <div className="bg-[#131722]" style={{ height: 'min(72vh, 620px)' }}>
          {res?.tv && !tradingViewCanEmbed(res.tv) ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-xs text-gray-500 max-w-md">
                TradingView cannot show <span className="text-gray-300">{res.tv}</span> in an embedded chart — that
                exchange needs an entitlement, and the embed would silently draw a different instrument instead.
                The full site opens it correctly.
              </p>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-colors text-xs font-medium">
                  <ExternalLink size={13} /> Open on TradingView
                </a>
              )}
            </div>
          ) : failed || (res && !res.tv) ? (
            <div className="h-full flex items-center justify-center px-6 text-center">
              <p className="text-xs text-gray-500 max-w-md">
                TradingView has no chart for <span className="text-gray-300">{symbol}</span>.
                Rather than draw someone else&apos;s instrument, this shows nothing.
              </p>
            </div>
          ) : !src ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-600">Resolving symbol…</div>
          ) : (
            <iframe
              src={src}
              title={`TradingView chart — ${tv}`}
              className="w-full h-full block"
              style={{ border: 0 }}
              allow="clipboard-write"
              referrerPolicy="origin"
            />
          )}
        </div>
      </div>
    </div>
  );
}
