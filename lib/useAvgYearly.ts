'use client';

import { useEffect, useState } from 'react';

// Fetch the full-history average yearly (annual) return for a set of symbols — the
// value the Returns table shows on its Yearly "Average" row. Loads ONCE per symbol
// list (server caches 12h), NOT on the 60-second quote refresh. Returns a map of
// symbol -> avg yearly % (or null when unavailable / still loading).
export function useAvgYearly(symbols: string[]): Record<string, number | null> {
  const [map, setMap] = useState<Record<string, number | null>>({});
  const key = symbols.slice().sort().join(',');
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/avg-yearly?symbols=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((m: Record<string, number | null>) => { if (!cancelled) setMap(prev => ({ ...prev, ...m })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [key]);
  return map;
}
