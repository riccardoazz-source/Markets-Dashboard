'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Landmark, Search, X } from 'lucide-react';
import { BUCKETS, type Bucket, type BondRow, type SecurityType } from '@/lib/bonds';
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

interface SecuritiesResponse {
  asOf: string;
  curveDate: string | null;
  curveAvailable: boolean;
  count: number;
  priced: number;
  rows: BondRow[];
  priceBasis: string;
  trace?: string[];
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

      {open && <BondFinder bucket={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── The finder ───────────────────────────────────────────────────────────────

const TYPES: SecurityType[] = ['Bill', 'Note', 'Bond', 'TIPS', 'FRN'];

function BondFinder({ bucket, onClose }: {
  bucket: Bucket; onClose: () => void;
}) {
  const [data, setData] = useState<SecuritiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<SecurityType[]>([]);
  const [belowPar, setBelowPar] = useState(false);
  const [belowIssue, setBelowIssue] = useState(false);
  const [couponMax, setCouponMax] = useState<string>('');
  const [couponMin, setCouponMin] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/bonds?mode=securities&bucket=${bucket.id}`)
      .then(r => r.json())
      .then((j: SecuritiesResponse) => { if (!cancelled) setData(Array.isArray(j?.rows) ? j : null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bucket.id]);

  // Filtering runs here rather than on the server: the list for one bucket is small, and
  // every keystroke hitting the network would make the panel feel broken.
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = q.trim().toUpperCase();
    const lo = couponMin === '' ? null : Number(couponMin);
    const hi = couponMax === '' ? null : Number(couponMax);
    return all.filter(r => {
      if (types.length && !types.includes(r.type)) return false;
      if (belowPar && r.vsPar !== 'below') return false;
      if (belowIssue && r.vsIssue !== 'below') return false;
      if (lo != null && (r.couponPct == null || r.couponPct < lo)) return false;
      if (hi != null && (r.couponPct == null || r.couponPct > hi)) return false;
      if (needle && !(r.cusip.includes(needle) || (r.isin ?? '').includes(needle))) return false;
      return true;
    });
  }, [data, q, types, belowPar, belowIssue, couponMin, couponMax]);

  const toggleType = useCallback((t: SecurityType) =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]), []);

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3 max-w-4xl">
        <PanelClose onClose={onClose} />
        <div className="pr-7">
          <h3 className="text-base font-bold text-white">{bucket.label} US Treasuries</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? 'loading…' : `${rows.length} of ${data?.count ?? 0} securities`}
            {data?.curveDate ? ` · curve ${data.curveDate}` : ''}
          </p>
        </div>

        {/* Said once, at the top, in words — not a footnote under a table of numbers that
            look exactly like quotes. Two versions, because "computed" and "absent" are
            different claims and the banner must not keep promising a price column that
            is not there. */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          {data && data.curveAvailable === false ? (
            <p className="text-[11px] text-amber-200/80 leading-snug">
              <span className="font-semibold text-amber-300">No prices this time.</span>{' '}
              The Treasury&apos;s yield curve could not be reached, and prices here are computed
              from it. Coupon, maturity, issue price and ISIN below come from the auction
              records and are exact — those are unaffected.
            </p>
          ) : (
            <p className="text-[11px] text-amber-200/80 leading-snug">
              <span className="font-semibold text-amber-300">Prices here are computed, not quoted.</span>{' '}
              There is no free public feed of secondary-market prices per CUSIP, so each one is
              the present value of that bond&apos;s own cash flows discounted on the Treasury par
              curve. Expect it to differ from a broker&apos;s screen by a fraction of a point,
              more on illiquid issues.
            </p>
          )}
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="relative flex-1 min-w-[150px]">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="CUSIP or ISIN"
                className="w-full bg-bg-input border border-border rounded pl-6 pr-6 py-1 text-xs text-white
                           placeholder:text-gray-600 focus:border-accent/50 outline-none" />
              {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"><X size={11} /></button>}
            </div>
            {TYPES.map(t => (
              <Chip key={t} on={types.includes(t)} onClick={() => toggleType(t)}>{t}</Chip>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* The two comparisons are offered side by side and named differently on
                purpose: they disagree on every bill, and conflating them is the mistake
                this panel is built to make impossible. */}
            <Chip on={belowPar} onClick={() => setBelowPar(v => !v)}>Below par (&lt;100)</Chip>
            <Chip on={belowIssue} onClick={() => setBelowIssue(v => !v)}>Below issue price</Chip>
            <span className="text-[10px] text-gray-600 ml-1">coupon</span>
            <NumBox value={couponMin} onChange={setCouponMin} placeholder="min" />
            <span className="text-[10px] text-gray-600">–</span>
            <NumBox value={couponMax} onChange={setCouponMax} placeholder="max" />
          </div>
        </div>

        {loading ? (
          <div className="h-32 flex items-center justify-center"><LoadingSpinner size={24} /></div>
        ) : !data ? (
          <p className="text-xs text-gray-500">The Treasury auction file could not be read. Try /api/bonds?mode=diag.</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">No security in this bucket matches those filters.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-border">
                  <Th>Maturity</Th><Th>Type</Th><Th right>Coupon</Th>
                  <Th right>Price*</Th><Th right>Yield*</Th><Th right>Issue</Th><Th>ISIN</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 250).map(r => (
                  <tr key={r.cusip} className="border-b border-border/40 hover:bg-white/[0.02]">
                    <Td>{r.maturityDate}</Td>
                    <Td><span className="text-gray-400">{r.type}</span></Td>
                    <Td right>{r.couponPct == null ? '—' : `${r.couponPct.toFixed(3)}%`}</Td>
                    <Td right>
                      {r.priced ? (
                        <span className={clsx('font-semibold tabular-nums',
                          r.vsPar === 'below' ? 'text-down-text' : r.vsPar === 'above' ? 'text-up-text' : 'text-gray-300')}>
                          {r.priced.cleanPrice.toFixed(3)}
                        </span>
                      ) : <span className="text-gray-600">—</span>}
                    </Td>
                    <Td right>{r.priced ? `${r.priced.ytmPct.toFixed(3)}%` : '—'}</Td>
                    <Td right>
                      {r.issuePrice == null ? <span className="text-gray-600">—</span> : (
                        <span className="text-gray-400 tabular-nums">{r.issuePrice.toFixed(3)}</span>
                      )}
                    </Td>
                    <Td><span className="text-gray-500 font-mono text-[10px]">{r.isin ?? r.cusip}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 250 && (
              <p className="text-[10px] text-gray-600 pt-2">Showing the first 250 of {rows.length}. Narrow with the filters.</p>
            )}
          </div>
        )}

        <p className="text-[10px] text-gray-600 leading-snug">
          * computed from the par curve, not a traded quote. Coupon, maturity, ISIN and issue
          price come from the Treasury&apos;s own auction records and are exact. Not financial advice.
        </p>
      </div>
    </DetailModal>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={clsx('px-2 py-1 rounded text-[10px] font-semibold border transition-colors',
        on ? 'bg-accent/20 border-accent/50 text-white' : 'bg-bg-input border-border text-gray-500 hover:text-gray-300')}>
      {children}
    </button>
  );
}

function NumBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      inputMode="decimal"
      className="w-14 bg-bg-input border border-border rounded px-1.5 py-1 text-[11px] text-white
                 placeholder:text-gray-600 focus:border-accent/50 outline-none tabular-nums" />
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={clsx('font-medium py-1.5 px-1.5', right ? 'text-right' : 'text-left')}>{children}</th>
);
const Td = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <td className={clsx('py-1.5 px-1.5 text-gray-300 tabular-nums', right ? 'text-right' : 'text-left')}>{children}</td>
);
