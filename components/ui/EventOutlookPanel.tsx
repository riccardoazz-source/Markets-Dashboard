'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';
import { LoadingSpinner } from './LoadingSpinner';
import type { EventSubject } from '@/lib/eventIndicator';

// ── What a scheduled release is expected to say ──────────────────────────────
//
// Three numbers, three different kinds of claim, kept visibly apart:
//
//   NOW        our own series, exact, from the same fetch the Macro tab uses
//   CONSENSUS  what the press reports forecasters expect — searched, sourced, often absent
//   ODDS       market-implied, and ONLY for a rate decision, because only there does a
//              traded market put a price on the outcome
//
// A data release gets no odds. Not because they are hard to find, but because they do not
// exist: there is a consensus and a spread of estimates, and rendering that as "72%
// likely" would be a precision nobody measured. The panel says so on the card rather than
// leaving a blank the reader fills in themselves.

interface Outlook {
  grounded?: boolean;
  previous?: string | null;
  consensus?: string | null;
  asOf?: string | null;
  probabilities?: { outcome: string; pct: number }[];
  note?: string | null;
  queries?: string[];
  sources?: { uri: string; title: string }[];
  reason?: string;
  error?: string;
  message?: string;
}

export function EventOutlookPanel({ title, date, region, subject, current, onClose }: {
  title: string;
  date: string;
  region?: string;
  subject: EventSubject;
  /** Today's value of the series this event concerns, already formatted. */
  current?: { value: string; asOf: string | null } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Outlook | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/event-outlook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, date, region, kind: subject.kind }),
      });
      setData(await res.json() as Outlook);
    } catch {
      setData({ error: 'fetch_failed' });
    } finally { setLoading(false); }
  }, [title, date, region, subject.kind]);

  useEffect(() => { load(); }, [load]);

  const day = new Intl.DateTimeFormat(undefined,
    { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(date));
  const probs = data?.probabilities ?? [];

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <PanelClose onClose={onClose} />
        <div className="pr-7">
          <h3 className="text-base font-bold text-white leading-snug">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{day}{region ? ` · ${region}` : ''}</p>
        </div>

        {/* OURS. Shown first and without qualification, because it is the only figure here
            that needs none — it comes from the series this app already fetches. */}
        <div className="grid grid-cols-2 gap-1.5">
          <Cell label={subject.currentLabel}
            value={current?.value ?? '—'}
            sub={current?.asOf ? `as of ${current.asOf}` : subject.indicatorId ? 'not loaded' : 'not carried by this app'} />
          <Cell label="Consensus forecast"
            value={loading ? '…' : data?.consensus ?? '—'}
            sub={data?.consensus ? (data.asOf ? `quoted ${data.asOf}` : 'from a live search') : 'not found'}
            dim={!data?.consensus} />
        </div>

        {loading ? (
          <div className="h-24 flex flex-col items-center justify-center gap-2">
            <LoadingSpinner size={24} />
            <p className="text-[11px] text-gray-600">Searching for the current consensus…</p>
          </div>
        ) : data?.error ? (
          <Notice title={data.error === 'missing_key' ? 'AI not configured' : 'Could not reach the model'}
            body={data.message ?? 'Something went wrong on the way to the model.'} />
        ) : !data?.grounded ? (
          <Notice title="No live web search — no forecast"
            body={`${data?.reason ?? 'The search tool did not run.'} A consensus recalled from memory is a number with a date on it and nothing behind it, so nothing is shown.`} />
        ) : (
          <>
            {subject.kind === 'rate' ? (
              probs.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">
                    Market-implied odds
                  </p>
                  {probs.map((p, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-gray-300 truncate">{p.outcome}</span>
                        <span className="text-xs font-bold text-white tabular-nums shrink-0">{p.pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${p.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-600 leading-snug">
                    Priced by rate futures, not a view. It is what the market is paying for
                    each outcome right now, and it moves.
                  </p>
                </div>
              ) : (
                <Notice title="No odds found"
                  body="The search did not return market-implied probabilities for this decision. They exist for rate meetings, but not every one is quoted in reachable sources." />
              )
            ) : (
              // The honest half of the answer, stated rather than left as an empty row.
              <Notice title="No probability for a data release"
                body="Rate decisions have market-implied odds because rate futures trade on the outcome. A statistic has no traded market on its value — only a consensus and a spread of estimates — so a percentage here would be a precision nobody measured." />
            )}

            {data.note && <p className="text-[11px] text-gray-500 leading-snug">{data.note}</p>}

            {data.sources && data.sources.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border">
                <p className="text-[10px] uppercase tracking-wider text-gray-600">Sources</p>
                <div className="flex flex-wrap gap-1">
                  {data.sources.slice(0, 10).map((s, i) => (
                    <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer"
                      title={s.title || s.uri}
                      className="inline-flex items-center gap-1 max-w-[200px] px-1.5 py-0.5 rounded border border-border text-[10px] text-gray-500 hover:text-gray-200 hover:border-accent/50 transition-colors">
                      <ExternalLink size={9} className="shrink-0" />
                      <span className="truncate">{s.title || hostOf(s.uri)}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-[10px] text-gray-600 leading-snug">
          The current value is this app&apos;s own data. The forecast and any odds are read
          off a live web search and belong to whoever published them. Not financial advice.
        </p>
      </div>
    </DetailModal>
  );
}

function hostOf(uri: string): string {
  try { return new URL(uri).hostname.replace(/^www\./, ''); } catch { return uri.slice(0, 24); }
}

function Cell({ label, value, sub, dim }: {
  label: string; value: string; sub?: string; dim?: boolean;
}) {
  return (
    <div className="rounded-lg bg-bg-input px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-tight mt-1 ${dim ? 'text-gray-600' : 'text-white'}`}>
        {value}
      </p>
      {sub && <p className="text-[9px] text-gray-600 leading-none mt-0.5">{sub}</p>}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-input px-3 py-3 space-y-1">
      <p className="text-xs font-semibold text-gray-300">{title}</p>
      <p className="text-[11px] text-gray-500 leading-snug">{body}</p>
    </div>
  );
}
