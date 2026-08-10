'use client';

// Shared whole-history volatility for a list of symbols.
//
// Module-level cache with in-flight de-duplication, the same shape as useRotationPhases:
// five section tabs asking for overlapping symbol lists must not turn into five identical
// round trips, and a tab the user flips back to must not refetch. The server side is
// cached for a day on top of this, because a figure built from thousands of bars does not
// move when one more arrives.
//
// Requests are chunked so one section asking for 60 tickers does not become one Yahoo call
// per page-load that blocks on its slowest symbol.

import { useEffect, useState } from 'react';
import { Volatility } from '@/lib/volatility';

export type VolMap = Map<string, Volatility>;

const cache = new Map<string, Volatility>();
const inflight = new Map<string, Promise<void>>();
const CHUNK = 20;

interface Row extends Partial<Volatility> { symbol: string }

function fetchOne(symbol: string, batch: string[]): Promise<void> {
  const existing = inflight.get(symbol);
  if (existing) return existing;
  const p = fetch(`/api/volatility?symbols=${encodeURIComponent(batch.join(','))}`)
    .then(r => (r.ok ? r.json() : []))
    .then((rows: Row[]) => {
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row && row.symbol && row.total != null) cache.set(row.symbol, row as Volatility);
      }
    })
    .catch(() => {})
    .finally(() => { for (const s of batch) inflight.delete(s); });
  for (const s of batch) inflight.set(s, p);
  return p;
}

export function useVolatility(symbols: string[]): VolMap {
  const key = [...new Set(symbols.filter(Boolean))].sort().join(',');
  const [, bump] = useState(0);

  useEffect(() => {
    const wanted = key ? key.split(',') : [];
    const missing = wanted.filter(s => !cache.has(s) && !inflight.has(s));
    if (!missing.length) return;
    let cancelled = false;
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += CHUNK) batches.push(missing.slice(i, i + CHUNK));
    Promise.all(batches.map(b => fetchOne(b[0], b))).then(() => { if (!cancelled) bump(n => n + 1); });
    return () => { cancelled = true; };
  }, [key]);

  const out: VolMap = new Map();
  for (const s of key ? key.split(',') : []) {
    const v = cache.get(s);
    if (v) out.set(s, v);
  }
  return out;
}
