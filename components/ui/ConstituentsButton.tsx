'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Layers, Search, X } from 'lucide-react';
import {
  membersOf, sortConstituents, topShare, universeFor,
  type ConstSortKey, type Constituent, type WeightedConstituent,
} from '@/lib/constituents';
import { holdingsSourceFor } from '@/lib/holdings';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';
import { LoadingSpinner } from './LoadingSpinner';
import { AssetQuickView } from './AssetQuickView';

// ── "What is inside this?" ───────────────────────────────────────────────────
//
// A button in the standard tool row of any index or sector this app has a member list
// for, and absent everywhere else rather than shown and empty. Picking a stock opens it
// in the same standard panel, one level down — the same pattern as the bond list.

// Two sources, one button. The full member list where the app has it (the S&P 500 and
// its eleven sector SPDRs); Yahoo's published top holdings for every other fund, and for
// every other index through the fund that tracks it. The button appears wherever either
// can answer, and nowhere else.
export function ConstituentsButton({ symbol, group }: { symbol: string; group?: string }) {
  const u = universeFor(symbol);
  const fund = holdingsSourceFor(symbol, group);
  const [open, setOpen] = useState(false);
  if (!u && !fund) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} title={`What ${symbol} holds`}
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400
                   hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium">
        <Layers size={13} /> <span className="hidden sm:inline">Stocks</span>
      </button>
      {open && (u
        ? <ConstituentList symbol={symbol} onClose={() => setOpen(false)} />
        : <FundHoldingsList symbol={symbol} group={group} onClose={() => setOpen(false)} />)}
    </>
  );
}

// ── Loaders: where the rows come from ─────────────────────────────────────────
//
// Two sources, ONE view. The full member list for the S&P 500 and its sector SPDRs; Yahoo's
// published top holdings, enriched with quotes, for every other fund and index. Both hand
// the same row shape to HoldingsView, so every fund reads the same way — weight, price, day,
// P/E — instead of the S&P list being a full table and every other fund a bare list.

function ConstituentList({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const u = universeFor(symbol)!;
  const [all, setAll] = useState<Constituent[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/sp500')
      .then(r => r.json())
      .then((j: Constituent[]) => { if (!cancelled) setAll(Array.isArray(j) ? j : []); })
      .catch(() => { if (!cancelled) setAll([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const members = useMemo(() => (all ? membersOf(all, u) : []), [all, u]);
  return (
    <HoldingsView
      title={`${u.label} · constituents`}
      subtitle="full member list, refreshed daily"
      members={members} loading={loading} complete
      sectorFilter={!u.sector}
      empty="The constituent list could not be loaded. Try again in a minute."
      footnote={`Membership is refreshed daily from a public S&P 500 constituent list. Weight≈ is each company's share of the combined market cap — close to the index weight, not equal to it: the index uses float-adjusted cap${u.sector ? ', and sector funds cap their largest names, so the top weights here run high' : ''}.`}
      onClose={onClose}
    />
  );
}

interface FundPayload {
  rows?: WeightedConstituent[];
  sectors?: { sector: string; weight: number }[];
  listedShare?: number | null;
  status?: 'ok' | 'no_data' | 'failed';
  detail?: string;
  fund?: string;
  via?: string | null;
}

function FundHoldingsList({ symbol, group, onClose }: { symbol: string; group?: string; onClose: () => void }) {
  const src = holdingsSourceFor(symbol, group)!;
  const [data, setData] = useState<FundPayload | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/holdings?symbol=${encodeURIComponent(symbol)}&group=${encodeURIComponent(group ?? '')}`)
      .then(r => r.json())
      .then((j: FundPayload) => { if (!cancelled) setData(j); })
      .catch(() => { if (!cancelled) setData({ status: 'failed' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, group]);

  const empty = data?.status === 'no_data'
    ? `Yahoo has no holdings data for ${src.fund}. It publishes holdings reliably for US-listed funds and often not for funds listed elsewhere — this is the source's gap, not a failure here.`
    : `Could not get an answer from Yahoo for ${src.fund} — a failed request, not an empty fund. Try again in a minute; /api/holdings?symbol=${symbol}&mode=diag shows why.`;

  return (
    <HoldingsView
      title={`${symbol} · top holdings`}
      subtitle={src.via ? `read through ${src.via}, a fund that tracks this index · source: Yahoo Finance` : 'source: Yahoo Finance'}
      members={data?.rows ?? []} loading={loading} complete={false}
      listedShare={data?.listedShare ?? null}
      sectorSplit={data?.sectors ?? []}
      empty={empty}
      footnote={`Yahoo publishes a fund's largest holdings — usually ten — and its sector split, not the full book. Weights are the fund's own.${src.via ? " An index holds nothing itself, so it is shown through a fund that tracks it; those weights match the index closely but not exactly." : ''}`}
      onClose={onClose}
    />
  );
}

// ── The one view ─────────────────────────────────────────────────────────────

function HoldingsView({
  title, subtitle, members, loading, complete, sectorFilter, listedShare, sectorSplit, empty, footnote, onClose,
}: {
  title: string; subtitle: string; members: WeightedConstituent[]; loading: boolean;
  /** True when this is the whole book; false for a fund's top holdings only. */
  complete: boolean;
  sectorFilter?: boolean;
  listedShare?: number | null;
  sectorSplit?: { sector: string; weight: number }[];
  empty: string; footnote: string; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: ConstSortKey; dir: 'asc' | 'desc' }>({ key: 'weight', dir: 'desc' });
  const [picked, setPicked] = useState<WeightedConstituent | null>(null);

  const sectors = useMemo(
    () => sectorFilter ? [...new Set(members.map(m => m.sector).filter(Boolean))].sort() : [],
    [members, sectorFilter]);
  const noWeights = members.length > 0 && members.every(m => m.weight == null);
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const kept = members.filter(m =>
      (!sector || m.sector === sector) &&
      (!needle || m.symbol.toUpperCase().includes(needle) || m.name.toUpperCase().includes(needle)));
    const eff = noWeights && sort.key === 'weight' ? { key: 'symbol' as ConstSortKey, dir: 'asc' as const } : sort;
    return sortConstituents(kept, eff.key, eff.dir);
  }, [members, q, sector, sort, noWeights]);

  const sortBy = useCallback((key: ConstSortKey) => setSort(prev =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'symbol' ? 'asc' : 'desc' }), []);

  // Same three tiles for every fund. For a full list the first is the top-10 share
  // computed here; for a fund's top holdings it is the share those listed names make up,
  // as the fund reports it.
  const firstTile = complete
    ? { label: 'Top 10 weight', v: topShare(members, 10) }
    : { label: `Top ${members.length} weight`, v: listedShare ?? null };
  const up = members.filter(m => (m.changePercent ?? 0) > 0).length;
  const down = members.filter(m => (m.changePercent ?? 0) < 0).length;
  const maxSector = Math.max(1, ...(sectorSplit ?? []).map(s => s.weight));

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3 max-w-4xl">
        <PanelClose onClose={onClose} />
        <div className="pr-7">
          <h3 className="text-base font-bold text-white">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? 'loading…' : members.length ? `${rows.length} of ${members.length} stocks · ${subtitle} · tap one for its chart` : subtitle}
          </p>
        </div>

        {loading ? (
          <div className="h-32 flex items-center justify-center"><LoadingSpinner size={24} /></div>
        ) : members.length === 0 ? (
          <p className="text-xs text-amber-200/70 py-6 text-center leading-snug">{empty}</p>
        ) : (
          <>
            {noWeights && (
              <p className="text-[11px] text-amber-200/70 leading-snug">
                {members.some(m => m.price != null)
                  ? 'Weights are unavailable right now: Yahoo is not returning market caps, only prices. Sorted by ticker meanwhile.'
                  : 'No prices came back from Yahoo for this list. The names are current; the numbers could not be fetched.'}
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label={firstTile.label} v={firstTile.v == null ? '—' : `${firstTile.v.toFixed(1)}%`} />
              <Stat label="Up today" v={`${up}`} color="text-up-text" />
              <Stat label="Down today" v={`${down}`} color="text-down-text" />
            </div>

            {members.length > 12 && (
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ticker or name"
                  className="w-full bg-bg-input border border-border rounded pl-6 pr-6 py-1 text-xs text-white
                             placeholder:text-gray-600 focus:border-accent/50 outline-none" />
                {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"><X size={11} /></button>}
              </div>
            )}
            {sectors.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                <Chip on={!sector} onClick={() => setSector(null)}>All</Chip>
                {sectors.map(s => <Chip key={s} on={sector === s} onClick={() => setSector(s)}>{s}</Chip>)}
              </div>
            )}

            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-border">
                    <SortTh k="symbol" sort={sort} onSort={sortBy}>Stock</SortTh>
                    <SortTh k="weight" sort={sort} onSort={sortBy} right>{complete ? 'Weight≈' : 'Weight'}</SortTh>
                    <SortTh k="price" sort={sort} onSort={sortBy} right>Price</SortTh>
                    <SortTh k="changePercent" sort={sort} onSort={sortBy} right>Day</SortTh>
                    <SortTh k="trailingPE" sort={sort} onSort={sortBy} right>P/E</SortTh>
                    <SortTh k="forwardPE" sort={sort} onSort={sortBy} right>Fwd P/E</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.symbol} onClick={() => setPicked(r)}
                      className="border-b border-border/40 hover:bg-white/[0.04] cursor-pointer">
                      <td className="py-1.5 px-1.5">
                        <span className="font-semibold text-white">{r.symbol}</span>
                        <span className="block text-[10px] text-gray-500 truncate max-w-[180px]">{r.name}</span>
                      </td>
                      <Td>{r.weight == null ? '—' : `${r.weight.toFixed(2)}%`}</Td>
                      <Td>{r.price == null ? '—' : r.price.toFixed(2)}</Td>
                      <Td>
                        {r.changePercent == null ? '—' : (
                          <span className={r.changePercent > 0 ? 'text-up-text' : r.changePercent < 0 ? 'text-down-text' : 'text-gray-400'}>
                            {r.changePercent > 0 ? '+' : ''}{r.changePercent.toFixed(2)}%
                          </span>
                        )}
                      </Td>
                      <Td>{r.trailingPE != null && r.trailingPE > 0 ? r.trailingPE.toFixed(1) : '—'}</Td>
                      <Td>{r.forwardPE != null && r.forwardPE > 0 ? r.forwardPE.toFixed(1) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(sectorSplit?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">Sector split</p>
                {sectorSplit!.map(s => (
                  <div key={s.sector} className="flex items-center gap-2 text-[11px]">
                    <span className="w-40 shrink-0 text-gray-400 truncate">{s.sector}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(s.weight / maxSector) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right text-gray-300 tabular-nums">{s.weight.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <p className="text-[10px] text-gray-600 leading-snug">{footnote}</p>

        {picked && (
          <AssetQuickView symbol={picked.symbol} name={picked.name} group="Stocks" onClose={() => setPicked(null)} />
        )}
      </div>
    </DetailModal>
  );
}

function Stat({ label, v, color }: { label: string; v: string; color?: string }) {
  return (
    <div className="rounded-lg bg-bg-input px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-gray-500 leading-none">{label}</p>
      <p className={clsx('text-sm font-bold tabular-nums mt-0.5', color ?? 'text-white')}>{v}</p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors',
        on ? 'bg-accent/20 border-accent/50 text-white' : 'bg-bg-input border-border text-gray-500 hover:text-gray-300')}>
      {children}
    </button>
  );
}

function SortTh({ k, sort, onSort, right, children }: {
  k: ConstSortKey; sort: { key: ConstSortKey; dir: 'asc' | 'desc' }; onSort: (k: ConstSortKey) => void;
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

const Td = ({ children }: { children: React.ReactNode }) => (
  <td className="py-1.5 px-1.5 text-right text-gray-300 tabular-nums">{children}</td>
);
