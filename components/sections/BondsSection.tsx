'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Landmark, Search, X } from 'lucide-react';
import { BUCKETS, type Bucket } from '@/lib/bonds';
import { bucketSymbol } from '@/lib/bondSeries';
import { AssetQuickView } from '@/components/ui/AssetQuickView';
import { DetailModal } from '@/components/ui/DetailModal';
import { PanelClose } from '@/components/ui/PanelClose';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// ── US Treasuries ────────────────────────────────────────────────────────────
//
// Two levels, because a bond market has two and they are not the same question:
//
//   THE CURVE     what does money cost at each maturity. A yield, not a price — there is
//                 nothing to buy called "the 30-year", there is a rate.
//   THE SECURITY  which actual bonds exist at that maturity, and what are they worth.
//                 CUSIP, ISIN, coupon, price.
//
// Opening a tile goes from the first to the second. The price in the second is COMPUTED
// off the curve, never quoted — said on the panel, not only in a comment, because a
// number that looks like a price and is not a traded one is exactly the thing this app
// has had to stop doing elsewhere.

interface CurveResponse {
  date: string | null;
  curveAvailable: boolean;
  curveTrace?: string[];
  buckets: (Bucket & { yieldPct: number | null; count: number })[];
}

export function BondsSection() {
  const [data, setData] = useState<CurveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Bucket | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/bonds?mode=curve')
      .then(r => r.json())
      .then((j: CurveResponse) => { if (!cancelled) setData(Array.isArray(j?.buckets) ? j : null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // The bucket list is FIXED. It renders whether or not anything was fetched, because the
  // ladder itself is not data — only the yield on each rung and the count of bonds in it
  // are. An earlier version made the whole section conditional on the curve arriving, and
  // when the curve timed out the tab showed one paragraph of apology and nothing else.
  const buckets = data?.buckets ?? BUCKETS.map(b => ({ ...b, yieldPct: null, count: 0 }));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Landmark size={18} className="text-accent" /> US Treasuries
        </h2>
        <span className="text-xs text-gray-500">by remaining maturity · open one to find the bonds in it</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {buckets.map(b => (
          <button key={b.id} onClick={() => setOpen(b)} title={b.note}
            className="rounded-lg border border-border bg-bg-card px-3 py-2.5 text-left
                       hover:border-accent/50 transition-colors">
            <p className="text-sm font-bold text-white leading-none">{b.label}</p>
            <p className="text-xl font-bold text-white tabular-nums leading-tight mt-1.5">
              {b.yieldPct == null ? <span className="text-gray-600 text-base">—</span> : `${b.yieldPct.toFixed(2)}%`}
            </p>
            <p className="text-[9px] text-gray-600 leading-none mt-1">
              {loading ? '…' : b.count > 0 ? `${b.count} securities →` : 'open →'}
            </p>
          </button>
        ))}
      </div>

      {/* Stated once, where it is true, instead of replacing the page. */}
      {!loading && data && !data.curveAvailable && (
        <p className="text-[11px] text-amber-200/70 leading-snug max-w-2xl">
          The Treasury&apos;s daily yield curve could not be reached, so the reference yields above
          and the computed prices inside are missing. Everything else — which bonds exist, their
          coupons, maturities and ISINs — is unaffected and still listed.
        </p>
      )}

      {/* The SAME panel every other asset opens — chart, timeframes, stat tiles, Tools,
          Data table, Notes — with one extra tool in its row for the bonds inside this
          bucket. The first version opened a bespoke panel that looked nothing like the
          rest of the app and did less; a maturity bucket is an asset like any other, it
          just measures a rate instead of a price. */}
      {open && (
        <AssetQuickView
          symbol={bucketSymbol(open.id)}
          name={`US Treasuries ${open.label}`}
          group="Bonds"
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// ── The finder ───────────────────────────────────────────────────────────────
