'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Table2, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PrintButton } from '@/components/ui/PrintButton';
import { HistoricalPoint } from '@/lib/types';
import {
  type Gran, type Matrix, GRANS, bucket, colLabels, periodLabel,
  buildMatrix, dayKind, dayBg, weekendBreakdown, withinPeriod,
} from '@/lib/returnsTable';

// ── Seasonal returns table (Coinglass-style) ─────────────────────────────────
// A button (sits next to Compare / AI on every asset detail panel) that opens a
// modal showing period returns for the asset across its whole history, at a
// selectable granularity. Self-contained: it fetches MAX daily history itself
// (/api/historical) and derives every period return from period-END closes, so
// it never depends on the section's current timeframe or chart data.

// Green for gains, red for losses; opacity scales with magnitude (full at ±25%).
function cellBg(v: number | null | undefined): string {
  if (v == null) return 'transparent';
  const a = 0.14 + 0.5 * Math.min(1, Math.abs(v) / 25);
  return v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
}
const fmt = (v: number | null | undefined) => (v == null ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

export function ReturnsTableButton({ name, symbol, externalData, defaultGran = 'Monthly' }: {
  name: string;
  symbol: string;
  /** When provided, use this series directly instead of fetching /api/historical
   *  (e.g. Macro World feeds its already-loaded annual World Bank series). */
  externalData?: HistoricalPoint[];
  defaultGran?: Gran;
}) {
  const [open, setOpen] = useState(false);
  const [gran, setGran] = useState<Gran>(defaultGran);
  const [data, setData] = useState<HistoricalPoint[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, HistoricalPoint[]>>(new Map());

  const handleOpen = () => setOpen(o => !o);

  // Clear any previous asset's table the moment the symbol changes, so a stale grid
  // is never shown when switching assets (the bug: Nasdaq showing Russell's numbers).
  useEffect(() => { setData(null); setError(null); }, [symbol]);

  // Fetch (or reuse cached) full history whenever the modal is open for the CURRENT
  // symbol. Keyed on [open, symbol] so switching assets always refetches.
  // When externalData is supplied the caller owns the series → skip the fetch entirely.
  useEffect(() => {
    if (!open) return;
    if (externalData) {
      if (externalData.length) { setData(externalData); setError(null); }
      else { setData([]); setError('No data available for this indicator.'); }
      return;
    }
    const cached = cache.current.get(symbol);
    if (cached) { setData(cached); setError(null); return; }
    let cancelled = false;
    setData(null); setLoading(true); setError(null);
    fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=MAX`)
      .then(r => r.json())
      .then((json: HistoricalPoint[]) => {
        if (cancelled) return;
        if (!Array.isArray(json) || json.length === 0) { setError('No price history available for this asset.'); setData([]); }
        else { cache.current.set(symbol, json); setData(json); }
      })
      .catch(() => { if (!cancelled) setError('Network error — could not load price history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, symbol, externalData]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The window is applied to the SERIES, before the matrix is built — so the cells, the
  // column means, the records and the weekend split all describe the chosen period.
  // Filtering the finished table instead would leave every average measuring a history the
  // reader is no longer looking at.
  const windowed = useMemo(
    () => (data ? withinPeriod(data, from, to) : null), [data, from, to]);
  const matrix = useMemo(
    () => (windowed && windowed.length ? buildMatrix(windowed, gran) : null), [windowed, gran]);
  // The span actually covered, which is not the span requested: an asset that listed in
  // 2021 shows 2021 whatever was typed, and saying so beats a silently shorter table.
  const span = windowed && windowed.length
    ? { first: windowed[0].date, last: windowed[windowed.length - 1].date, n: windowed.length }
    : null;

  // Best/worst records: the 3 biggest gains and 3 biggest losses across every cell in this view.
  const records = useMemo(() => {
    if (!matrix) return null;
    const all: { label: string; v: number }[] = [];
    for (const [row, m] of matrix.grid) {
      for (const [col, v] of m) if (isFinite(v)) all.push({ label: periodLabel(gran, row, col), v });
    }
    if (all.length === 0) return null;
    const sorted = [...all].sort((a, b) => b.v - a.v);
    return { best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse() };
  }, [matrix, gran]);

  // ── What a weekend is worth, for the assets that have one ──────────────────
  //
  // Only in Daily view, and only when weekend observations actually exist — which is the
  // same as asking whether the asset trades at all on a Saturday. An equity produces
  // nothing here and the block stays hidden; crypto produces two averages that are
  // genuinely their own question.
  //
  // The WEEKDAY average is computed alongside and shown with them, because a figure like
  // "Saturday +0.08%" is unreadable on its own: the whole point is whether it differs from
  // an ordinary day, and without the baseline the reader has to hold the comparison in
  // their head. The count comes too — an average over nine Saturdays is a different claim
  // from one over nine hundred.
  const weekendStats = useMemo(
    () => (matrix ? weekendBreakdown(matrix, gran) : null), [matrix, gran]);

  return (
    <>
      <button
        onClick={handleOpen}
        title="Seasonal returns table"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-emerald-300 hover:border-emerald-500/50 transition-colors text-xs font-medium"
      >
        <Table2 size={13} />
        <span className="hidden sm:inline">Returns</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm print-flow" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-[1400px] max-h-[88vh] flex flex-col rounded-xl border border-emerald-500/25 bg-[#12172a] shadow-2xl overflow-hidden"
            data-print-root
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/5 bg-emerald-900/10 shrink-0">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">{name} <span className="text-emerald-300 font-semibold">— {gran} Returns (%)</span></div>
                <div className="text-[10px] text-gray-500">{symbol} · period-over-period, full history · green = gain, red = loss</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0" data-print-hide>
                <PrintButton />
                <button onClick={() => setOpen(false)} className="p-1 text-gray-500 hover:text-gray-200" aria-label="Close"><X size={16} /></button>
              </div>
            </div>

            {/* Granularity selector */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5 shrink-0 flex-wrap">
              {GRANS.map(g => (
                <button
                  key={g}
                  onClick={() => setGran(g)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    gran === g ? 'bg-emerald-600 text-white' : 'bg-bg-input text-gray-400 hover:text-gray-100'
                  }`}
                >
                  {g}
                </button>
              ))}

              {/* Period filter. Empty means unbounded on that side, so one date alone is a
                  valid window — "everything since 2020" is a question people actually ask,
                  and requiring both ends would make them invent a second date. */}
              <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                <span className="text-gray-500 hidden sm:inline">Period</span>
                <input type="date" value={from} max={to || undefined}
                  onChange={e => setFrom(e.target.value)}
                  title="From — leave empty to start at the beginning of the history"
                  className="bg-bg-input rounded px-1.5 py-1 text-[11px] text-gray-200 outline-none focus:ring-1 focus:ring-emerald-500" />
                <span className="text-gray-600">→</span>
                <input type="date" value={to} min={from || undefined}
                  onChange={e => setTo(e.target.value)}
                  title="To — leave empty to run to the latest data"
                  className="bg-bg-input rounded px-1.5 py-1 text-[11px] text-gray-200 outline-none focus:ring-1 focus:ring-emerald-500" />
                {(from || to) && (
                  <button onClick={() => { setFrom(''); setTo(''); }} title="Full history"
                    className="px-1.5 py-1 rounded text-gray-500 hover:text-gray-200">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-3">
              {loading && <div className="flex items-center justify-center h-40 gap-2 text-xs text-gray-500"><LoadingSpinner size={22} /> Loading full history…</div>}
              {error && !loading && <p className="text-[12px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">⚠ {error}</p>}
              {!loading && !error && span && (from || to) && (
                <p className="text-[10px] text-gray-500 mb-2">
                  Showing <span className="text-gray-300">{span.first}</span> to{' '}
                  <span className="text-gray-300">{span.last}</span> · {span.n.toLocaleString()} data points.
                  Every figure below — cells, averages, records, weekend split — is computed on this window only.
                </p>
              )}
              {!loading && !error && data && data.length > 0 && windowed && windowed.length === 0 && (
                <p className="text-[12px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                  No data in that period. The history runs {data[0].date} to {data[data.length - 1].date}.
                </p>
              )}
              {!loading && !error && matrix && (
                <>
                {gran === 'Daily' && (
                  <p className="flex items-center gap-3 text-[10px] text-gray-500 mb-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-sm"
                        style={{ backgroundColor: 'rgba(99,102,241,0.10)', boxShadow: 'inset 0 0 0 1px rgba(129,140,248,0.22)' }} />
                      Saturday or Sunday
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-sm text-gray-700 text-center leading-3">·</span>
                      day not in this month
                    </span>
                    <span className="text-gray-600">
                      An empty weekend is a closed market — unless the asset trades every day,
                      in which case it is missing data.
                    </span>
                  </p>
                )}
                <table className="border-separate border-spacing-0 text-[11px] tabular-nums">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 bg-[#12172a] px-2 py-1.5 text-left text-gray-400 font-semibold border-r border-b border-white/10 min-w-[64px]">Time</th>
                      {matrix.cols.map(c => (
                        <th key={c} className="sticky top-0 z-20 bg-[#12172a] px-2 py-1.5 text-center text-gray-400 font-semibold whitespace-nowrap min-w-[62px] border-b border-white/10">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map(r => (
                      <tr key={r}>
                        <td className="sticky left-0 z-10 bg-[#12172a] px-2 py-1.5 text-left text-gray-300 font-semibold whitespace-nowrap border-r border-white/10">{r}</td>
                        {matrix.cols.map((_, c) => {
                          const v = matrix.grid.get(r)?.get(c);
                          const kind = dayKind(gran, r, c);
                          const weekend = kind === 'saturday' || kind === 'sunday';
                          return (
                            <td key={c}
                              title={weekend ? `${r}-${String(c + 1).padStart(2, '0')} — ${kind === 'saturday' ? 'Saturday' : 'Sunday'}` : undefined}
                              className="px-2 py-1.5 text-center text-gray-100 whitespace-nowrap"
                              style={{
                                // The return's own heat wins when there is one; the weekend
                                // tint shows through the blanks, which is where the question
                                // "why is this empty" actually gets asked.
                                backgroundColor: v == null ? dayBg(kind) : cellBg(v),
                                // A rule on the weekend cells so they stay legible as a
                                // block even where a return has painted over the tint.
                                boxShadow: weekend ? 'inset 0 0 0 1px rgba(129,140,248,0.22)' : undefined,
                              }}>
                              {kind === 'nonexistent' ? <span className="text-gray-700">·</span> : fmt(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {/* Average / Median footer */}
                    <tr>
                      <td className="sticky left-0 z-10 bg-[#0d1120] px-2 py-1.5 text-left text-gray-400 font-bold whitespace-nowrap border-r border-t border-white/10">Average</td>
                      {matrix.avg.map((v, c) => (
                        <td key={c} className="px-2 py-1.5 text-center font-semibold whitespace-nowrap border-t border-white/10" style={{ backgroundColor: '#0d1120', color: v == null ? '#6b7280' : v >= 0 ? '#4ade80' : '#f87171' }}>{fmt(v)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="sticky left-0 z-10 bg-[#0d1120] px-2 py-1.5 text-left text-gray-400 font-bold whitespace-nowrap border-r border-white/10">Median</td>
                      {matrix.median.map((v, c) => (
                        <td key={c} className="px-2 py-1.5 text-center font-semibold whitespace-nowrap" style={{ backgroundColor: '#0d1120', color: v == null ? '#6b7280' : v >= 0 ? '#4ade80' : '#f87171' }}>{fmt(v)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                </>
              )}

              {/* Records — the 3 biggest gains and 3 biggest losses across the whole history */}
              {!loading && !error && records && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5">
                    <p className="text-[10px] uppercase tracking-widest text-emerald-400/80 mb-1.5">▲ Top 3 gains ({gran.toLowerCase()})</p>
                    {records.best.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                        <span className="text-gray-400 truncate">{r.label}</span>
                        <span className="text-emerald-400 font-bold tabular-nums shrink-0">{fmt(r.v)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-2.5">
                    <p className="text-[10px] uppercase tracking-widest text-red-400/80 mb-1.5">▼ Top 3 losses ({gran.toLowerCase()})</p>
                    {records.worst.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                        <span className="text-gray-400 truncate">{r.label}</span>
                        <span className="text-red-400 font-bold tabular-nums shrink-0">{fmt(r.v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Weekend averages — under the records, and only for an asset that has a
                  weekend to average. The weekday row is the baseline that makes the other
                  two mean anything. */}
              {!loading && !error && weekendStats && (
                <div className="mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.04] p-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-indigo-300/80 mb-1.5">
                    Weekend vs weekday (daily returns)
                  </p>
                  <div className="space-y-0.5">
                    {([['Saturday', weekendStats.saturday], ['Sunday', weekendStats.sunday],
                       ['Mon–Fri', weekendStats.weekday]] as const).map(([label, st]) => (
                      st.n === 0 ? null : (
                        <div key={label} className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                          <span className={label === 'Mon–Fri' ? 'text-gray-500' : 'text-gray-300'}>
                            {label}
                            <span className="text-gray-600"> · {st.n} day{st.n === 1 ? '' : 's'}</span>
                          </span>
                          <span className="flex items-center gap-3 shrink-0 tabular-nums">
                            {st.up != null && (
                              <span className="text-gray-500 text-[10px]">{st.up.toFixed(0)}% up</span>
                            )}
                            <span className={`font-bold ${
                              st.avg == null ? 'text-gray-600' : st.avg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {st.avg == null ? '—' : `${st.avg >= 0 ? '+' : ''}${st.avg.toFixed(3)}%`}
                            </span>
                          </span>
                        </div>
                      )
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-600 leading-snug mt-1.5">
                    An average, not an edge: with this many observations a few tenths either
                    way is noise, and the Mon–Fri row is there to be compared against.
                  </p>
                </div>
              )}

              {!loading && !error && matrix && matrix.rows.length === 0 && (
                <p className="text-[12px] text-gray-500 px-1 py-2">Not enough history to compute {gran.toLowerCase()} returns.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
