'use client';

// Shared rotation-phase source for every section. Fetches the rotation universe
// ONCE (module-level cache), scores it with the live EMS model, and exposes a
// Map<symbol, RotationPhase> so any section can label an asset with the quadrant
// it sits in (Recovering / Trending / Fading / Lagging) — the same classification
// the Rotation tab shows. Currencies/FX are not in the momentum universe, so they
// return no phase.

import { useEffect, useState } from 'react';
import { scoreRotation, ModelInput } from '@/lib/rotationModel';
import { classifyPhase, RotationPhase } from '@/lib/rotationPhase';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';

// symbol → asset class, so the model's class tilt / commodity guard match the Rotation tab.
const GROUP_OF: Record<string, string> = {};
INDEXES.forEach(i => { GROUP_OF[i.symbol] = 'Indexes'; });
COMMODITIES.forEach(c => { GROUP_OF[c.symbol] = 'Commodities'; });
SECTORS.forEach(s => { GROUP_OF[s.symbol] = 'Sectors'; });
CRYPTO_IDS.forEach(e => { GROUP_OF[CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`] = 'Crypto'; });

interface Row { symbol: string; [k: string]: unknown }

let cache: { map: Map<string, RotationPhase>; ts: number } | null = null;
let inflight: Promise<Map<string, RotationPhase>> | null = null;
const TTL = 5 * 60_000;

async function load(): Promise<Map<string, RotationPhase>> {
  const res = await fetch('/api/rotation-returns');
  const rows: Row[] = await res.json();
  const inputs: ModelInput[] = rows.map(r => ({
    symbol: r.symbol,
    group: GROUP_OF[r.symbol],
    r1m: r.r1m as number | null, r3m: r.r3m as number | null, r6m: r.r6m as number | null, r1y: r.r1y as number | null,
    price: (r.lastClose ?? r.ma200) as number | null, ma200: r.ma200 as number | null,
    vol: r.vol as number | null, volEdge: r.volEdge as number | null,
    pos52w: r.pos52w as number | null, trendR2: r.trendR2 as number | null, trendR2Long: r.trendR2Long as number | null,
    rsi: r.rsi as number | null, macdHist: r.macdHist as number | null, volRatio: r.volRatio as number | null,
    rvol5: r.rvol5 as number | null, r20: r.r20 as number | null, r5: r.r5 as number | null,
    rangeExp: r.rangeExp as number | null, median12m: r.median12m as number | null,
    moneyFlow: r.moneyFlow as number | null, downVolDry: r.downVolDry as number | null,
  }));
  const scored = scoreRotation(inputs).filter(s => s.score > -1);
  const byScore = [...scored].sort((a, b) => a.score - b.score);
  const n = byScore.length;
  const pct = new Map<string, number>();
  byScore.forEach((s, i) => pct.set(s.item.symbol, n > 1 ? (i / (n - 1)) * 100 : 50));
  const map = new Map<string, RotationPhase>();
  for (const s of scored) {
    const p = classifyPhase(pct.get(s.item.symbol) ?? 50, s.item.r3m ?? null);
    if (p) map.set(s.item.symbol, p);
  }
  return map;
}

export function useRotationPhases(): Map<string, RotationPhase> {
  const [map, setMap] = useState<Map<string, RotationPhase>>(() => cache?.map ?? new Map());
  useEffect(() => {
    if (cache && Date.now() - cache.ts < TTL) { setMap(cache.map); return; }
    let cancelled = false;
    (inflight ??= load()).then(m => {
      cache = { map: m, ts: Date.now() }; inflight = null;
      if (!cancelled) setMap(m);
    }).catch(() => { inflight = null; });
    return () => { cancelled = true; };
  }, []);
  return map;
}
