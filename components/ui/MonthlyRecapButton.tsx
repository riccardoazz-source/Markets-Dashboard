'use client';

import { useCallback, useEffect, useState } from 'react';
import { Newspaper, ExternalLink, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import clsx from 'clsx';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';
import { LoadingSpinner } from './LoadingSpinner';

// ── Monthly recap ────────────────────────────────────────────────────────────
//
// "What actually happened to this asset this month", beside Returns / Quadrant /
// TradingView / AI on every asset panel.
//
// Every item is DATED and comes from a live web search, and the sources are listed under
// the items so any line can be checked. When the search does not run the panel says so
// and shows nothing — a recap is reporting, and the failure mode worth designing against
// is not an empty panel, it is a confident invented one.

interface RecapItem {
  date: string;
  headline: string;
  detail: string;
  impact: 'up' | 'down' | 'neutral';
}
interface Recap {
  month: string;
  grounded: boolean;
  items: RecapItem[];
  sources: { uri: string; title: string }[];
  reason?: string;
  error?: string;
  message?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The last `n` months as YYYY-MM, newest first. */
function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function label(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

const IMPACT = {
  up:      { Icon: ArrowUpRight,   cls: 'text-up-text',   ring: 'border-l-emerald-500/60' },
  down:    { Icon: ArrowDownRight, cls: 'text-down-text', ring: 'border-l-red-500/60' },
  neutral: { Icon: Minus,          cls: 'text-gray-500',  ring: 'border-l-gray-600/60' },
} as const;

export function MonthlyRecapButton({ symbol, name, assetClass }: {
  symbol: string;
  name: string;
  assetClass?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="What happened to this asset this month — dated events from a live web search"
        className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
      >
        <Newspaper size={13} /> <span className="hidden sm:inline">Recap</span>
      </button>
      {open && (
        <RecapPanel symbol={symbol} name={name} assetClass={assetClass} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function RecapPanel({ symbol, name, assetClass, onClose }: {
  symbol: string; name: string; assetClass?: string; onClose: () => void;
}) {
  const months = recentMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<Recap | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch('/api/monthly-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, name, assetClass, month }),
      });
      setData(await res.json() as Recap);
    } catch {
      setData({ month, grounded: false, items: [], sources: [], error: 'fetch_failed' });
    } finally { setLoading(false); }
  }, [symbol, name, assetClass, month]);

  useEffect(() => { load(); }, [load]);

  const failed = data?.error;
  const empty = !loading && !failed && data?.grounded && data.items.length === 0;

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <PanelClose onClose={onClose} />
        <div className="pr-7">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Newspaper size={15} className="text-accent shrink-0" /> Monthly recap
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">{name} · {symbol}</p>
        </div>

        <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
          <div className="flex gap-1">
            {months.map(m => (
              <button key={m} onClick={() => setMonth(m)}
                className={clsx('shrink-0 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                  m === month ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-border')}>
                {label(m)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="h-40 flex flex-col items-center justify-center gap-2">
            <LoadingSpinner size={28} />
            <p className="text-[11px] text-gray-600">Searching the web for {label(month)}…</p>
          </div>
        ) : failed ? (
          <Notice
            title={data?.error === 'missing_key' ? 'AI not configured' : 'Could not reach the model'}
            body={data?.message ?? (data?.error === 'timeout'
              ? 'The request took too long. Try again.'
              : 'Something went wrong on the way to the model.')} />
        ) : !data?.grounded ? (
          // The whole point: no live search, no recap. Saying nothing is the correct
          // output here, and saying WHY keeps it from looking broken.
          <Notice
            title="No live web search — nothing to report"
            body={`${data?.reason ?? 'The search tool did not run.'} A recap is reporting, so rather than write one from memory this shows nothing. Try again in a moment.`} />
        ) : empty ? (
          <Notice
            title={`Nothing notable found for ${label(month)}`}
            body="The search returned no dated, specific events for this asset in that window. A quiet month is a real answer — this is not padded with filler." />
        ) : (
          <ul className="space-y-1.5">
            {data.items.map((it, i) => {
              const { Icon, cls, ring } = IMPACT[it.impact];
              return (
                <li key={`${it.date}-${i}`}
                  className={clsx('rounded-lg border border-border border-l-2 bg-bg-input px-2.5 py-2', ring)}>
                  <div className="flex items-start gap-2">
                    <Icon size={13} className={clsx('mt-0.5 shrink-0', cls)} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-100 leading-snug">{it.headline}</p>
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{dayLabel(it.date)}</p>
                      {it.detail && <p className="text-xs text-gray-400 leading-snug mt-1">{it.detail}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && data?.grounded && data.sources.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-border">
            <p className="text-[10px] uppercase tracking-wider text-gray-600">Sources</p>
            <div className="flex flex-wrap gap-1">
              {data.sources.slice(0, 12).map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer"
                  title={s.title || s.uri}
                  className="inline-flex items-center gap-1 max-w-[220px] px-1.5 py-0.5 rounded border border-border text-[10px] text-gray-500 hover:text-gray-200 hover:border-accent/50 transition-colors">
                  <ExternalLink size={9} className="shrink-0" />
                  <span className="truncate">{s.title || new URL(s.uri).hostname}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-gray-600 leading-snug">
          Written by a model from a live web search. Every line is dated so it can be
          checked against the sources above. Not financial advice.
        </p>
      </div>
    </DetailModal>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-input px-3 py-4 space-y-1">
      <p className="text-sm font-semibold text-gray-300">{title}</p>
      <p className="text-xs text-gray-500 leading-snug">{body}</p>
    </div>
  );
}
