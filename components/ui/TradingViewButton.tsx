'use client';

import { ExternalLink } from 'lucide-react';
import { tradingViewUrl, tradingViewIsProxy } from '@/lib/tradingview';

/**
 * "TradingView" — opens THIS asset on TradingView in a new tab.
 *
 * Renders nothing when the symbol has no safe mapping (see lib/tradingview.ts):
 * a missing button is a small annoyance, a button that opens the wrong instrument
 * is a wrong decision made on the wrong chart.
 */
export function TradingViewButton({ symbol, group }: { symbol: string; group?: string }) {
  const url = tradingViewUrl(symbol, group);
  if (!url) return null;
  const proxy = tradingViewIsProxy(symbol);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-print-hide
      title={proxy
        ? 'Open the closest TradingView equivalent — TradingView has no free feed for this index, so this is the tracking ETF, not the same series'
        : 'Open this asset on TradingView'}
      className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
    >
      <ExternalLink size={13} />
      <span className="hidden sm:inline">TradingView{proxy ? ' ≈' : ''}</span>
    </a>
  );
}
