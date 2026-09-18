// ── The seasonal returns table, as arithmetic ────────────────────────────────
//
// Lifted out of the component so it can be CHECKED. The numbers this produces — a
// weekend average, a best-day record, a per-column mean — are the kind that look
// plausible when they are wrong: a cell filed one column over, a return attributed to the
// wrong end of its own move, a partial period dragging a mean. None of that shows on the
// screen. `npm run vet` now runs these functions against series whose answers are known by
// hand, which is the only way the question "is this right?" has an answer better than
// "it looks right".
//
// Everything here is pure: dates in, numbers out, no React and no fetching.

import { HistoricalPoint } from './types';

export type Gran = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
export const GRANS: Gran[] = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((cur - start) / 86_400_000) + 1;
}

// The (row, column) a date maps to for a given granularity, plus a unique period id.
// Column labels are fixed per granularity; rows are years (or year-months for Daily).
export function bucket(d: Date, gran: Gran): { id: string; row: string; col: number } {
  const y = d.getUTCFullYear();
  switch (gran) {
    case 'Yearly':    return { id: `${y}`, row: `${y}`, col: 0 };
    case 'Quarterly': { const q = Math.floor(d.getUTCMonth() / 3); return { id: `${y}-Q${q}`, row: `${y}`, col: q }; }
    case 'Monthly':   { const m = d.getUTCMonth(); return { id: `${y}-M${m}`, row: `${y}`, col: m }; }
    case 'Weekly':    { const w = Math.min(52, Math.floor((dayOfYear(d) - 1) / 7)); return { id: `${y}-W${w}`, row: `${y}`, col: w }; }
    case 'Daily':     { const m = d.getUTCMonth(), day = d.getUTCDate(); return { id: `${y}-${m}-${day}`, row: `${y}-${String(m + 1).padStart(2, '0')}`, col: day - 1 }; }
  }
}

export function colLabels(gran: Gran): string[] {
  switch (gran) {
    case 'Yearly':    return ['Return'];
    case 'Quarterly': return ['Q1', 'Q2', 'Q3', 'Q4'];
    case 'Monthly':   return MONTHS;
    case 'Weekly':    return Array.from({ length: 53 }, (_, i) => `W${i + 1}`);
    case 'Daily':     return Array.from({ length: 31 }, (_, i) => `${i + 1}`);
  }
}

export interface Matrix {
  rows: string[];                       // row labels, most-recent first
  cols: string[];                       // column headers
  grid: Map<string, Map<number, number>>; // row -> col -> return %
  avg: (number | null)[];               // per-column average
  median: (number | null)[];            // per-column median
}

// Human-readable label for one (row, col) cell — used by the best/worst records list.
export function periodLabel(gran: Gran, row: string, col: number): string {
  switch (gran) {
    case 'Yearly':    return row;
    case 'Quarterly': return `Q${col + 1} ${row}`;
    case 'Monthly':   return `${MONTHS[col] ?? ''} ${row}`;
    case 'Weekly':    return `W${col + 1} ${row}`;
    case 'Daily': {   // row is "YYYY-MM", col is day-of-month − 1
      const [y, m] = row.split('-');
      return `${col + 1} ${MONTHS[Number(m) - 1] ?? ''} ${y}`;
    }
  }
}

// Sequential index of a period on the calendar — used to require ADJACENT periods
// when pairing period-end closes. Daily is exempt (weekend gaps are normal there;
// day-over-day on trading days is the standard convention).
export function periodIndex(d: Date, gran: Gran): number | null {
  const y = d.getUTCFullYear();
  switch (gran) {
    case 'Yearly':    return y;
    case 'Quarterly': return y * 4 + Math.floor(d.getUTCMonth() / 3);
    case 'Monthly':   return y * 12 + d.getUTCMonth();
    case 'Weekly':    return y * 53 + Math.min(52, Math.floor((dayOfYear(d) - 1) / 7));
    case 'Daily':     return null;
  }
}

// Period returns from period-END closes: last close of each period, in chronological
// order, then consecutive % changes. A month's return = monthEnd/prevMonthEnd − 1
// (so January is measured against the prior December — cross-year, exactly like the
// standard seasonality table). The first period in the whole series has no base → blank.
// Guards: (a) only ADJACENT calendar periods are paired — across a data gap the ratio
// spans multiple periods and would be filed as a single period's return; (b) the
// CURRENT (incomplete) period is shown but excluded from the Average/Median rows.
export function buildMatrix(points: HistoricalPoint[], gran: Gran): Matrix {
  const pts = points
    .map(p => ({ t: new Date(p.date + 'T00:00:00Z'), c: p.close }))
    .filter(p => isFinite(p.c) && p.c > 0 && !isNaN(p.t.getTime()))
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  // Last close per period, preserving chronological order of first appearance.
  const periods = new Map<string, { row: string; col: number; c: number; order: number; idx: number | null }>();
  let order = 0;
  for (const p of pts) {
    const b = bucket(p.t, gran);
    const e = periods.get(b.id);
    if (e) e.c = p.c;                                   // keep updating → period-end close
    else periods.set(b.id, { row: b.row, col: b.col, c: p.c, order: order++, idx: periodIndex(p.t, gran) });
  }
  const seq = [...periods.values()].sort((a, b) => a.order - b.order);
  const nowB = bucket(new Date(), gran);                // the current, incomplete period

  const grid = new Map<string, Map<number, number>>();
  for (let i = 1; i < seq.length; i++) {
    // Adjacency guard: skip when the two period-end closes are not consecutive
    // calendar periods (data gap → multi-period return, not a period return).
    if (seq[i].idx != null && seq[i - 1].idx != null && seq[i].idx !== (seq[i - 1].idx as number) + 1) continue;
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
    for (const r of rows) {
      if (r === nowB.row && c === nowB.col) continue;   // partial current period → not in stats
      const v = grid.get(r)?.get(c);
      if (v != null) vals.push(v);
    }
    if (vals.length === 0) { avg.push(null); median.push(null); continue; }
    avg.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median.push(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  return { rows, cols, grid, avg, median };
}

// ── Which weekday a Daily cell actually is ───────────────────────────────────
//
// In Daily mode a row is a month ('2026-09') and a column is a day of it, so the weekday
// is recoverable — and worth recovering. A blank Saturday on an equity is the market being
// shut; a blank Saturday on Bitcoin, which trades every day, means data is MISSING. Same
// empty cell, opposite meanings, and nothing on the grid distinguished them.
//
// It also shows the weekend effect where there is one: crypto genuinely moves on Sundays,
// and being able to see those columns as a group is the point of marking them.
//
// A day that does not exist in that month — the 30th of February, the 31st of April — is
// its own case. The grid is a fixed 31 columns, so those cells were rendering as ordinary
// empty ones, indistinguishable from a day that existed and had no data.
type DayKind = 'weekday' | 'saturday' | 'sunday' | 'nonexistent';

export function dayKind(gran: Gran, row: string, col: number): DayKind | null {
  if (gran !== 'Daily') return null;
  const [y, m] = row.split('-').map(Number);
  if (!isFinite(y) || !isFinite(m)) return null;
  const d = new Date(Date.UTC(y, m - 1, col + 1));
  // Date.UTC rolls over, so 30 February becomes 2 March — which is how a day that never
  // existed is detected rather than silently drawn.
  if (d.getUTCMonth() !== m - 1) return 'nonexistent';
  const dow = d.getUTCDay();
  return dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday';
}

/** The tint under a cell when it carries no return of its own. */
export function dayBg(kind: DayKind | null): string {
  if (kind === 'saturday' || kind === 'sunday') return 'rgba(99,102,241,0.10)';
  if (kind === 'nonexistent') return 'rgba(255,255,255,0.02)';
  return 'transparent';
}

/**
 * Saturdays, Sundays and weekdays averaged separately — the arithmetic behind the block
 * under the records, and the part most worth checking, because a cell landing in the
 * wrong bucket would produce a believable number for the wrong days.
 *
 * Mon–Fri is computed alongside deliberately. A weekend average with no baseline is not a
 * fact anyone can use: the question is always whether it DIFFERS from an ordinary day.
 *
 * Returns null when the asset has no weekend observations at all — which is the same
 * question as whether it trades on a Saturday, so an equity simply has no block.
 */
export interface DayStat { n: number; avg: number | null; up: number | null }
export interface WeekendBreakdown { saturday: DayStat; sunday: DayStat; weekday: DayStat }

export function weekendBreakdown(matrix: Matrix, gran: Gran): WeekendBreakdown | null {
  if (gran !== 'Daily') return null;
  const bag = { saturday: [] as number[], sunday: [] as number[], weekday: [] as number[] };
  for (const [row, m] of matrix.grid) {
    for (const [col, v] of m) {
      if (!isFinite(v)) continue;
      const kind = dayKind('Daily', row, col);
      if (kind === 'saturday' || kind === 'sunday' || kind === 'weekday') bag[kind].push(v);
    }
  }
  if (bag.saturday.length === 0 && bag.sunday.length === 0) return null;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const share = (xs: number[]) => (xs.length ? (xs.filter(x => x > 0).length / xs.length) * 100 : null);
  return {
    saturday: { n: bag.saturday.length, avg: mean(bag.saturday), up: share(bag.saturday) },
    sunday:   { n: bag.sunday.length,   avg: mean(bag.sunday),   up: share(bag.sunday) },
    weekday:  { n: bag.weekday.length,  avg: mean(bag.weekday),  up: share(bag.weekday) },
  };
}

/**
 * The slice of a series inside [from, to], inclusive, by ISO date string.
 *
 * Applied BEFORE the matrix is built, so every figure in the table — the cells, the
 * column means, the records and the weekend split — describes the chosen window and not
 * the full history with a different heading on top. Filtering afterwards would leave the
 * averages measuring something the reader is no longer looking at.
 *
 * An empty bound means "no bound on that side", so one date alone is a valid window.
 */
export function withinPeriod(
  points: HistoricalPoint[], from?: string, to?: string,
): HistoricalPoint[] {
  const lo = (from ?? '').trim();
  const hi = (to ?? '').trim();
  if (!lo && !hi) return points;
  return points.filter(p => (!lo || p.date >= lo) && (!hi || p.date <= hi));
}
