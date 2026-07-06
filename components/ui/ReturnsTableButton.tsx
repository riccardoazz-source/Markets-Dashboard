'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Table2, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { HistoricalPoint } from '@/lib/types';

// ── Seasonal returns table (Coinglass-style) ─────────────────────────────────
// A button (sits next to Compare / AI on every asset detail panel) that opens a
// modal showing period returns for the asset across its whole history, at a
// selectable granularity. Self-contained: it fetches MAX daily history itself
// (/api/historical) and derives every period return from period-END closes, so
// it never depends on the section's current timeframe or chart data.

type Gran = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
const GRANS: Gran[] = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Monday-first weekday columns for the Daily (day-of-week) view.
const WEEKDAYS_MON = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((cur - start) / 86_400_000) + 1;
}

// The (row, column) a date maps to for a given granularity, plus a unique period id.
// Column labels are fixed per granularity; rows are years (or year-months for Daily).
function bucket(d: Date, gran: Gran): { id: string; row: string; col: number } {
  const y = d.getUTCFullYear();
  switch (gran) {
    case 'Yearly':    return { id: `${y}`, row: `${y}`, col: 0 };
    case 'Quarterly': { const q = Math.floor(d.getUTCMonth() / 3); return { id: `${y}-Q${q}`, row: `${y}`, col: q }; }
    case 'Monthly':   { const m = d.getUTCMonth(); return { id: `${y}-M${m}`, row: `${y}`, col: m }; }
    case 'Weekly':    { const w = Math.min(52, Math.floor((dayOfYear(d) - 1) / 7)); return { id: `${y}-W${w}`, row: `${y}`, col: w }; }
    case 'Daily':     { const m = d.getUTCMonth(), day = d.getUTCDate(); return { id: `${y}-${m}-${day}`, row: `${y}-${String(m + 1).padStart(2, '0')}`, col: day - 1 }; }
  }
}

function colLabels(gran: Gran): string[] {
  switch (gran) {
    case 'Yearly':    return ['Return'];
    case 'Quarterly': return ['Q1', 'Q2', 'Q3', 'Q4'];
    case 'Monthly':   return MONTHS;
    case 'Weekly':    return Array.from({ length: 53 }, (_, i) => `W${i + 1}`);
    case 'Daily':     return WEEKDAYS_MON; // handled in buildMatrix; kept for completeness
  }
}

interface Matrix {
  rows: string[];                       // row labels, most-recent first
  cols: string[];                       // column headers
  grid: Map<string, Map<number, number>>; // row -> col -> return %
  avg: (number | null)[];               // per-column average
  median: (number | null)[];            // per-column median
}

// Period returns from period-END closes: last close of each period, in chronological
// order, then consecutive % changes. A month's return = monthEnd/prevMonthEnd − 1
// (so January is measured against the prior December — cross-year, exactly like the
// standard seasonality table). The first period in the whole series has no base → blank.
function buildMatrix(points: HistoricalPoint[], gran: Gran): Matrix {
  const pts = points
    .map(p => ({ t: new Date(p.date + 'T00:00:00Z'), c: p.close }))
    .filter(p => isFinite(p.c) && p.c > 0 && !isNaN(p.t.getTime()))
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  // Daily = day-of-week view: columns are Monday…Sunday, rows are months. Each cell is the
  // AVERAGE of that weekday's daily returns within the month (a month has ~4 of each weekday).
  // The daily return is realized ON its bar's weekday (Mon close / prev-trading-day close − 1).
  if (gran === 'Daily') {
    const cols = WEEKDAYS_MON;
    const cell = new Map<string, Map<number, { s: number; n: number }>>();
    const allByCol: number[][] = Array.from({ length: 7 }, () => []);
    for (let i = 1; i < pts.length; i++) {
      const ret = (pts[i].c / pts[i - 1].c - 1) * 100;
      if (!isFinite(ret)) continue;
      const d = pts[i].t;
      const row = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const col = (d.getUTCDay() + 6) % 7;              // Mon=0 … Sun=6
      if (!cell.has(row)) cell.set(row, new Map());
      const e = cell.get(row)!.get(col) ?? { s: 0, n: 0 };
      e.s += ret; e.n++; cell.get(row)!.set(col, e);
      allByCol[col].push(ret);
    }
    const grid = new Map<string, Map<number, number>>();
    for (const [row, rm] of cell) {
      const g = new Map<number, number>();
      for (const [col, e] of rm) g.set(col, e.s / e.n);
      grid.set(row, g);
    }
    const rows = [...grid.keys()].sort().reverse();
    const avg: (number | null)[] = [];
    const median: (number | null)[] = [];
    for (let c = 0; c < 7; c++) {
      const vals = allByCol[c];
      if (!vals.length) { avg.push(null); median.push(null); continue; }
      avg.push(vals.reduce((s, v) => s + v, 0) / vals.length);
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      median.push(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    return { rows, cols, grid, avg, median };
  }

  // Last close per period, preserving chronological order of first appearance.
  const periods = new Map<string, { row: string; col: number; c: number; order: number }>();
  let order = 0;
  for (const p of pts) {
    const b = bucket(p.t, gran);
    const e = periods.get(b.id);
    if (e) e.c = p.c;                                   // keep updating → period-end close
    else periods.set(b.id, { row: b.row, col: b.col, c: p.c, order: order++ });
  }
  const seq = [...periods.values()].sort((a, b) => a.order - b.order);

  const grid = new Map<string, Map<number, number>>();
  for (let i = 1; i < seq.length; i++) {
    const ret = (seq[i].c / seq[i - 1].c - 1) * 100;
    if (!isFinite(ret)) continue;
    if (!grid.has(seq[i].row)) grid.set(seq[i].row, new Map());
    grid.get(seq[i].row)!.set(seq[i].col, ret);
  }

  const rows = [...grid.keys()].sort().reverse();       // most recent period first
  const cols = colLabels(gran);
  const avg: (number | null)[] = [];
  const median: (number | null)[] = [];
  for (let c = 0; c < cols.length; c++) {
    const vals: number[] = [];
    for (const r of rows) { const v = grid.get(r)?.get(c); if (v != null) vals.push(v); }
    if (vals.length === 0) { avg.push(null); median.push(null); continue; }
    avg.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median.push(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  return { rows, cols, grid, avg, median };
}

// Green for gains, red for losses; opacity scales with magnitude (full at ±25%).
function cellBg(v: number | null | undefined): string {
  if (v == null) return 'transparent';
  const a = 0.14 + 0.5 * Math.min(1, Math.abs(v) / 25);
  return v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
}
const fmt = (v: number | null | undefined) => (v == null ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

export function ReturnsTableButton({ name, symbol }: { name: string; symbol: string }) {
  const [open, setOpen] = useState(false);
  const [gran, setGran] = useState<Gran>('Monthly');
  const [data, setData] = useState<HistoricalPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, HistoricalPoint[]>>(new Map());

  const handleOpen = () => setOpen(o => !o);

  // Clear any previous asset's table the moment the symbol changes, so a stale grid
  // is never shown when switching assets (the bug: Nasdaq showing Russell's numbers).
  useEffect(() => { setData(null); setError(null); }, [symbol]);

  // Fetch (or reuse cached) full history whenever the modal is open for the CURRENT
  // symbol. Keyed on [open, symbol] so switching assets always refetches.
  useEffect(() => {
    if (!open) return;
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
  }, [open, symbol]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const matrix = useMemo(() => (data && data.length ? buildMatrix(data, gran) : null), [data, gran]);

  return (
    <>
      <button
        onClick={handleOpen}
        title="Seasonal returns table"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-emerald-300 hover:border-emerald-500/50 transition-colors text-xs font-medium"
      >
        <Table2 size={13} />
        Returns
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-[1400px] max-h-[88vh] flex flex-col rounded-xl border border-emerald-500/25 bg-[#12172a] shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/5 bg-emerald-900/10 shrink-0">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">{name} <span className="text-emerald-300 font-semibold">— {gran} Returns (%)</span></div>
                <div className="text-[10px] text-gray-500">
                  {symbol} · {gran === 'Daily' ? 'avg daily return by weekday, per month' : 'period-over-period'}, full history · green = gain, red = loss
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 text-gray-500 hover:text-gray-200 shrink-0" aria-label="Close"><X size={16} /></button>
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
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-3">
              {loading && <div className="flex items-center justify-center h-40 gap-2 text-xs text-gray-500"><LoadingSpinner size={22} /> Loading full history…</div>}
              {error && !loading && <p className="text-[12px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">⚠ {error}</p>}
              {!loading && !error && matrix && (
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
                          return (
                            <td key={c} className="px-2 py-1.5 text-center text-gray-100 whitespace-nowrap" style={{ backgroundColor: cellBg(v) }}>
                              {fmt(v)}
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
