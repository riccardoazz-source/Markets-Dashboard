// ── Reading the Treasury's curve file ────────────────────────────────────────
//
// The parsing half of lib/treasuryCurve, split out for the same reason lib/gistMerge was
// split from lib/gist: the check harness compiles these files with a bare tsc that does
// not know Next's fetch options, so anything with a fetch in it cannot be covered. The
// part worth covering is this one — the date format, the column map, and what counts as
// a usable row.

import type { CurvePoint } from './bonds';

/** Column header → years. The CSV carries every tenor in one row. */
export const CURVE_TENORS: [string, number][] = [
  ['1 Mo', 1 / 12], ['1.5 Month', 0.125], ['2 Mo', 2 / 12], ['3 Mo', 0.25], ['4 Mo', 4 / 12],
  ['6 Mo', 0.5], ['1 Yr', 1], ['2 Yr', 2], ['3 Yr', 3], ['5 Yr', 5],
  ['7 Yr', 7], ['10 Yr', 10], ['20 Yr', 20], ['30 Yr', 30],
];

export interface CurveDay {
  date: string;
  /** Every tenor quoted that day, sorted by maturity. */
  points: CurvePoint[];
  /** The same values keyed by CSV column, for reading one tenor. */
  byCol: Record<string, number>;
}

/** Every row of one year's CSV, newest last. */
export function parseCurveRows(csv: string): CurveDay[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const out: CurveDay[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',').map(c => c.trim().replace(/"/g, ''));
    const segs = cells[0].split('/');
    if (segs.length !== 3) continue;
    const date = `${segs[2]}-${segs[0].padStart(2, '0')}-${segs[1].padStart(2, '0')}`;
    const points: CurvePoint[] = [];
    const byCol: Record<string, number> = {};
    for (const [col, years] of CURVE_TENORS) {
      const i = headers.indexOf(col);
      if (i < 0 || i >= cells.length) continue;
      const v = parseFloat(cells[i]);
      if (!isFinite(v)) continue;
      points.push({ years, pct: v });
      byCol[col] = v;
    }
    if (points.length >= 4) {
      points.sort((a, b) => a.years - b.years);
      out.push({ date, points, byCol });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** How many calendar years of history a timeframe needs. */
export function yearsForTimeframe(tf: string): number {
  switch (tf) {
    case '1D': case '1W': case 'MTD': case '1M': return 1;
    case '3M': case '6M': case 'YTD': case '1Y': return 2;
    case '3Y': return 4;
    case '5Y': return 6;
    case '10Y': return 11;
    case 'MAX': return 30;
    default: return 2;
  }
}
