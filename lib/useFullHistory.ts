'use client';

import { useEffect, useState } from 'react';
import { HistoricalPoint } from './types';

// Client-side cache/dedup so PriceChart AND ChartTools sharing a symbol issue a single
// MAX-history request (the server also caches it).
const cache = new Map<string, HistoricalPoint[]>();
const inFlight = new Map<string, Promise<HistoricalPoint[]>>();

function load(symbol: string): Promise<HistoricalPoint[]> {
  const cached = cache.get(symbol);
  if (cached) return Promise.resolve(cached);
  let p = inFlight.get(symbol);
  if (!p) {
    p = fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=MAX`)
      .then(r => r.json())
      .then((d: unknown) => (Array.isArray(d) ? d as HistoricalPoint[] : []))
      .then(d => { cache.set(symbol, d); inFlight.delete(symbol); return d; })
      .catch(() => { inFlight.delete(symbol); return []; });
    inFlight.set(symbol, p);
  }
  return p;
}

// Full daily history for indicator math — so moving averages and the trend line can be
// computed on the WHOLE series and drawn on the visible window even when the selected
// timeframe is short (e.g. a 200-week MA while viewing 1 month). Fetches MAX once per
// symbol (client + server cached). `enabled` skips the fetch when no full-history tool
// is active. Returns null until loaded.
export function useFullHistory(symbol: string | undefined, enabled: boolean): HistoricalPoint[] | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!symbol || !enabled) return;
    if (cache.has(symbol)) return;
    let cancelled = false;
    load(symbol).then(() => { if (!cancelled) force(x => x + 1); });
    return () => { cancelled = true; };
  }, [symbol, enabled]);
  return symbol && enabled ? cache.get(symbol) ?? null : null;
}
