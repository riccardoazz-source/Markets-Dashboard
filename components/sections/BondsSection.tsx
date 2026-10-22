'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Landmark, Search, X } from 'lucide-react';
import { BUCKETS, type Bucket } from '@/lib/bonds';
import { bucketSymbol } from '@/lib/bondSeries';
import { GOVT_COUNTRIES, findCountry, govtDisplayName, govtSymbol, toBps } from '@/lib/govtBonds';
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
  // 'US' keeps the Treasury section exactly as it was; any other code switches to a
  // foreign issuer, which has yields and no securities list underneath.
  const [country, setCountry] = useState('US');
  const [govtOpen, setGovtOpen] = useState<{ symbol: string; name: string } | null>(null);

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
          <Landmark size={18} className="text-accent" /> Government bonds
        </h2>
        <span className="text-xs text-gray-500">
          {country === 'US'
            ? 'by remaining maturity · open one to find the bonds in it'
            : 'published yields by maturity · open one for its chart'}
        </span>
      </div>

      {/* The issuer, picked first, because everything below belongs to one. */}
      <div className="flex gap-1.5 flex-wrap">
        <CountryChip on={country === 'US'} onClick={() => setCountry('US')}>🇺🇸 United States</CountryChip>
        {GOVT_COUNTRIES.map(c => (
          <CountryChip key={c.code} on={country === c.code} onClick={() => setCountry(c.code)}>
            {c.flag} {c.name}
          </CountryChip>
        ))}
      </div>

      {country !== 'US' && <GovtCurve code={country} onOpen={setGovtOpen} />}

      {country === 'US' && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
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
      </div>}

      {/* Stated once, where it is true, instead of replacing the page. */}
      {country === 'US' && !loading && data && !data.curveAvailable && (
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
      {govtOpen && (
        <AssetQuickView
          symbol={govtOpen.symbol}
          name={govtOpen.name}
          group="Bonds"
          onClose={() => setGovtOpen(null)}
        />
      )}

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

function CountryChip({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={clsx('px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors',
        on ? 'bg-accent/20 border-accent/50 text-white'
           : 'bg-bg-input border-border text-gray-500 hover:text-gray-200')}>
      {children}
    </button>
  );
}

// ── One foreign issuer's curve ───────────────────────────────────────────────
//
// Tiles like the US ones, with two differences that are stated rather than smoothed over:
//
//   FREQUENCY  the euro-area curve is daily; the single-country benchmarks are monthly
//              OECD long-term rates. A monthly series drawn as if it were daily reads as
//              a daily one that has stopped updating, so each tile says which it is.
//   NO LIST    there are no securities underneath. Per-ISIN prices for gilts and JGBs do
//              exist free, and for BTPs and Bunds on exchange pages, but none of that is
//              built — so nothing here offers a list it cannot fill.
function GovtCurve({ code, onOpen }: {
  code: string; onOpen: (v: { symbol: string; name: string }) => void;
}) {
  const country = findCountry(code);
  const [rows, setRows] = useState<Record<string, { last: number; date: string } | null>>({});
  const [spreadBps, setSpreadBps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!country) return;
    let cancelled = false;
    setLoading(true);
    setRows({});
    setSpreadBps(null);
    const syms = country.tenors.map(t => govtSymbol(country.code, t.label));
    fetch(`/api/quotes?symbols=${encodeURIComponent(syms.join(','))}`)
      .then(r => r.json())
      .then((qs: { symbol: string; price: number }[]) => {
        if (cancelled || !Array.isArray(qs)) return;
        const next: Record<string, { last: number; date: string } | null> = {};
        for (const q of qs) next[q.symbol] = { last: q.price, date: '' };
        setRows(next);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [country]);

  // The number the bond market is actually read on in Europe. Fetched as two quotes and
  // subtracted here rather than being another endpoint: it is one subtraction, and
  // keeping it client-side means it cannot disagree with the two tiles above it.
  useEffect(() => {
    if (!country?.spreadVs) return;
    let cancelled = false;
    const mine = govtSymbol(country.code, '10Y');
    const theirs = govtSymbol(country.spreadVs, '10Y');
    fetch(`/api/quotes?symbols=${encodeURIComponent(`${mine},${theirs}`)}`)
      .then(r => r.json())
      .then((qs: { symbol: string; price: number }[]) => {
        if (cancelled || !Array.isArray(qs)) return;
        const a = qs.find(q => q.symbol === mine)?.price;
        const b = qs.find(q => q.symbol === theirs)?.price;
        if (a != null && b != null) setSpreadBps(toBps(a - b));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [country]);

  if (!country) return null;

  return (
    <div className="space-y-2">
      {country.spreadVs && (
        <div className="rounded-lg border border-border bg-bg-card px-3 py-2 inline-block">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">
            10Y spread vs {findCountry(country.spreadVs)?.name ?? country.spreadVs}
          </p>
          <p className="text-lg font-bold text-white tabular-nums leading-tight mt-1">
            {spreadBps == null ? <span className="text-gray-600 text-base">—</span>
              : `${spreadBps >= 0 ? '+' : ''}${spreadBps.toFixed(0)} bps`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {country.tenors.map(t => {
          const sym = govtSymbol(country.code, t.label);
          const row = rows[sym];
          return (
            <button key={t.label}
              onClick={() => onOpen({ symbol: sym, name: govtDisplayName(country, t) })}
              className="rounded-lg border border-border bg-bg-card px-3 py-2.5 text-left
                         hover:border-accent/50 transition-colors">
              <p className="text-sm font-bold text-white leading-none">{country.flag} {t.label}</p>
              <p className="text-xl font-bold text-white tabular-nums leading-tight mt-1.5">
                {row ? `${row.last.toFixed(2)}%`
                     : <span className="text-gray-600 text-base">{loading ? '…' : '—'}</span>}
              </p>
              {/* Said on every tile, not in a footnote: a monthly number is not a stale
                  daily one, and only the label can tell them apart. */}
              <p className={clsx('text-[9px] leading-none mt-1',
                t.freq === 'monthly' ? 'text-amber-400/70' : 'text-gray-600')}>
                {t.freq === 'monthly' ? 'monthly · OECD' : 'daily · ECB'}
              </p>
            </button>
          );
        })}
      </div>

      {!loading && Object.values(rows).every(r => !r) && (
        <p className="text-[11px] text-amber-200/70 leading-snug max-w-2xl">
          No yields came back for {country.name}. The series keys behind these could not be
          verified when they were written — open <span className="font-mono">/api/quotes?symbols={govtSymbol(country.code, country.tenors[0].label)}</span> to
          see what the provider actually returned.
        </p>
      )}
    </div>
  );
}
