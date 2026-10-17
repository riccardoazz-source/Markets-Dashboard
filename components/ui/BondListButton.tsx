'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ExternalLink, List, Search, X } from 'lucide-react';
import { parseBondSymbol, securitySymbol } from '@/lib/bondSeries';
import type { BondRow, SecurityType } from '@/lib/bonds';
import { bondLinks, sortBonds, type SortDir, type SortKey } from '@/lib/bondLinks';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';
import { LoadingSpinner } from './LoadingSpinner';
import { AssetQuickView } from './AssetQuickView';

// ── The one tool bonds have and nothing else does ────────────────────────────
//
// Every asset in this app opens the same panel. A maturity bucket opens that panel too —
// and needs one thing none of the others do: the actual securities inside it. A bucket is
// a rate, and underneath the rate there are a hundred real bonds with CUSIPs, coupons and
// prices, which is the thing you actually buy.
//
// So this is a button in the standard tool row, not a panel of its own. Picking a bond
// from the list opens THAT bond in the standard panel as well, with its own chart over
// time — the same view, one level down.

const TYPES: SecurityType[] = ['Bill', 'Note', 'Bond', 'TIPS', 'FRN'];

interface SecuritiesResponse {
  count: number;
  rows: BondRow[];
  curveAvailable: boolean;
  curveDate: string | null;
}

export function BondListButton({ symbol }: { symbol: string }) {
  const ref = parseBondSymbol(symbol);
  const [open, setOpen] = useState(false);
  // Only a maturity bucket has a list underneath it. On any other asset — including a
  // single bond, which IS the thing a list points at — the button is simply not there.
  if (!ref || ref.kind !== 'bucket') return null;

  return (
    <>
      <button onClick={() => setOpen(true)} title="The securities in this maturity bucket"
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400
                   hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium">
        <List size={13} /> <span className="hidden sm:inline">Bonds</span>
      </button>
      {open && <BondList bucketId={ref.bucket.id} label={ref.bucket.label} onClose={() => setOpen(false)} />}
    </>
  );
}

function BondList({ bucketId, label, onClose }: {
  bucketId: string; label: string; onClose: () => void;
}) {
  const [data, setData] = useState<SecuritiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<SecurityType[]>([]);
  const [belowPar, setBelowPar] = useState(false);
  const [belowIssue, setBelowIssue] = useState(false);
  const [couponMin, setCouponMin] = useState('');
  const [couponMax, setCouponMax] = useState('');
  const [picked, setPicked] = useState<BondRow | null>(null);
  const [links, setLinks] = useState<BondRow | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'maturityDate', dir: 'asc' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/bonds?mode=securities&bucket=${bucketId}`)
      .then(r => r.json())
      .then((j: SecuritiesResponse) => { if (!cancelled) setData(Array.isArray(j?.rows) ? j : null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bucketId]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = q.trim().toUpperCase();
    const lo = couponMin === '' ? null : Number(couponMin);
    const hi = couponMax === '' ? null : Number(couponMax);
    const kept = all.filter(r => {
      if (types.length && !types.includes(r.type)) return false;
      if (belowPar && r.vsPar !== 'below') return false;
      if (belowIssue && r.vsIssue !== 'below') return false;
      if (lo != null && (r.couponPct == null || r.couponPct < lo)) return false;
      if (hi != null && (r.couponPct == null || r.couponPct > hi)) return false;
      if (needle && !(r.cusip.includes(needle) || (r.isin ?? '').includes(needle))) return false;
      return true;
    });
    return sortBonds(kept, sort.key, sort.dir);
  }, [data, q, types, belowPar, belowIssue, couponMin, couponMax, sort]);

  // Clicking the column you are already on flips it, rather than re-sorting it the same
  // way and looking broken.
  const sortBy = useCallback((key: SortKey) => setSort(prev =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }), []);

  const toggleType = useCallback((t: SecurityType) =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]), []);

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3 max-w-4xl">
        <PanelClose onClose={onClose} />
        <div className="pr-7">
          <h3 className="text-base font-bold text-white">{label} · securities</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? 'loading…' : `${rows.length} of ${data?.count ?? 0}`}
            {data?.curveDate ? ` · curve ${data.curveDate}` : ''} · tap one for its chart
          </p>
        </div>

        <p className="text-[11px] text-amber-200/70 leading-snug">
          <span className="font-semibold text-amber-300">Prices are computed, not quoted.</span>{' '}
          No free public feed carries traded prices per CUSIP, so each is the present value of
          that bond&apos;s cash flows on the Treasury par curve. Coupon, maturity, ISIN and issue
          price are exact.
        </p>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="relative flex-1 min-w-[150px]">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="CUSIP or ISIN"
                className="w-full bg-bg-input border border-border rounded pl-6 pr-6 py-1 text-xs text-white
                           placeholder:text-gray-600 focus:border-accent/50 outline-none" />
              {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"><X size={11} /></button>}
            </div>
            {TYPES.map(t => <Chip key={t} on={types.includes(t)} onClick={() => toggleType(t)}>{t}</Chip>)}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
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
          <p className="text-xs text-gray-500 py-6 text-center">Nothing in this bucket matches those filters.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-border">
                  <SortTh k="maturityDate" sort={sort} onSort={sortBy}>Maturity</SortTh>
                  <SortTh k="type" sort={sort} onSort={sortBy}>Type</SortTh>
                  <SortTh k="couponPct" sort={sort} onSort={sortBy} right>Coupon</SortTh>
                  <SortTh k="price" sort={sort} onSort={sortBy} right>Price*</SortTh>
                  <SortTh k="ytm" sort={sort} onSort={sortBy} right>Yield*</SortTh>
                  <SortTh k="issuePrice" sort={sort} onSort={sortBy} right>Issue</SortTh>
                  <Th>ISIN</Th><Th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 250).map(r => (
                  <tr key={r.cusip} onClick={() => setPicked(r)}
                    className="border-b border-border/40 hover:bg-white/[0.04] cursor-pointer">
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
                    <Td right>{r.issuePrice == null ? <span className="text-gray-600">—</span>
                      : <span className="text-gray-400 tabular-nums">{r.issuePrice.toFixed(3)}</span>}</Td>
                    <Td><span className="text-gray-500 font-mono text-[10px]">{r.isin ?? r.cusip}</span></Td>
                    {/* stopPropagation: the row opens the chart, this opens the sources,
                        and a tap must not do both. */}
                    <Td>
                      <button onClick={e => { e.stopPropagation(); setLinks(r); }}
                        title="Open this bond on FINRA, TreasuryDirect or the issuer's record"
                        className="text-gray-600 hover:text-accent transition-colors p-1 -m-1">
                        <ExternalLink size={12} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 250 && (
              <p className="text-[10px] text-gray-600 pt-2">First 250 of {rows.length}. Narrow with the filters.</p>
            )}
          </div>
        )}

        {links && <LinkSheet row={links} onClose={() => setLinks(null)} />}

        {/* One level down, the same panel again — chart, timeframes, tools and all. */}
        {picked && (
          <AssetQuickView
            symbol={securitySymbol(picked.cusip)}
            name={`${picked.couponPct != null ? `${picked.couponPct.toFixed(3)}% ` : ''}${picked.type} due ${picked.maturityDate}`}
            group="Bonds"
            onClose={() => setPicked(null)}
          />
        )}
      </div>
    </DetailModal>
  );
}

// The destinations that hold what this app models. FINRA first, because TRACE is the
// actual traded price — the thing the computed column here is an approximation of.
function LinkSheet({ row, onClose }: { row: BondRow; onClose: () => void }) {
  const links = bondLinks(row.cusip, row.isin);
  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-2 max-w-sm">
        <PanelClose onClose={onClose} />
        <div className="pr-7">
          <h3 className="text-sm font-bold text-white">Open this bond elsewhere</h3>
          <p className="text-[11px] text-gray-500 font-mono mt-0.5">{row.isin ?? row.cusip}</p>
        </div>
        {links.length === 0 ? (
          <p className="text-[11px] text-gray-500">This security has no usable identifier to look up.</p>
        ) : links.map(l => (
          <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
            className="block rounded-lg border border-border bg-bg-input px-3 py-2
                       hover:border-accent/50 transition-colors">
            <p className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
              {l.label} <ExternalLink size={10} className="text-gray-600" />
            </p>
            <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{l.note}</p>
          </a>
        ))}
        <p className="text-[10px] text-gray-600 leading-snug">
          FINRA carries TRACE — trades that actually executed. That is the real price; the
          one in the table is this app&apos;s model of it.
        </p>
      </div>
    </DetailModal>
  );
}

function SortTh({ k, sort, onSort, right, children }: {
  k: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void;
  right?: boolean; children: React.ReactNode;
}) {
  const on = sort.key === k;
  return (
    <th className={clsx('font-medium py-1.5 px-1.5', right ? 'text-right' : 'text-left')}>
      <button onClick={() => onSort(k)}
        className={clsx('inline-flex items-center gap-0.5 uppercase tracking-wider transition-colors',
          on ? 'text-accent' : 'text-gray-500 hover:text-gray-300')}>
        {children}
        {on && (sort.dir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />)}
      </button>
    </th>
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
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal"
      className="w-14 bg-bg-input border border-border rounded px-1.5 py-1 text-[11px] text-white
                 placeholder:text-gray-600 focus:border-accent/50 outline-none tabular-nums" />
  );
}

const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={clsx('font-medium py-1.5 px-1.5', right ? 'text-right' : 'text-left')}>{children}</th>
);
const Td = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <td className={clsx('py-1.5 px-1.5 text-gray-300 tabular-nums', right ? 'text-right' : 'text-left')}>{children}</td>
);
