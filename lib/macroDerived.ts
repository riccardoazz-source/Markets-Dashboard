// ── Macro series the app works out rather than fetches ───────────────────────
//
// Kept out of the route so `npm run vet` can pin it. The year-on-year change looks like
// two lines of arithmetic and has three ways to be quietly wrong: an off-by-one in the
// lag, a window applied before the lookback rather than after, and a gap in the source
// series silently comparing the wrong two months.

import type { MacroUnit } from './config';

export type SeriesPoint = { date: string; value: number };

/**
 * The change over twelve months, in percent — what everyone means by "the inflation rate"
 * when the underlying series is an index level.
 *
 * `from` is applied AFTER the calculation, never before: filtering first would leave the
 * first twelve months of any window with no prior year to compare against, and the view
 * would come back empty rather than short.
 *
 * Each pair is checked to be eleven to thirteen months apart before it is used. The CPI
 * is monthly and complete today, but a source that ever drops a month would otherwise
 * compare (say) August with the previous September and report it as a year — a wrong
 * number that looks entirely plausible.
 */
/**
 * Which index each derived "(YoY)" rate is computed from.
 *
 * It lives here, beside the arithmetic, rather than inside the API route, because the two
 * halves have to agree and nothing was checking that they did: declaring a new `*_YOY`
 * indicator in lib/config.ts without adding its base here produces a series that fetches
 * cleanly and comes back empty — a blank card with no error anywhere. `npm run vet` now
 * asserts the two lists match.
 */
export const YOY_BASE_SERIES: Record<string, string> = {
  CPI_YOY: 'CPIAUCSL',
  CORE_CPI_YOY: 'CPILFESL',
  PCE_YOY: 'PCEPI',
  CORE_PCE_YOY: 'PCEPILFE',
  PPI_YOY: 'PPIFIS',
  CORE_PPI_YOY: 'PPIFES',
};

export function yearOverYear(base: SeriesPoint[], from?: string): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 12; i < base.length; i++) {
    const prev = base[i - 12];
    const months = (Date.parse(base[i].date) - Date.parse(prev.date)) / 86_400_000 / 30.44;
    if (!(months > 11 && months < 13)) continue;
    if (!(prev.value > 0) || !isFinite(base[i].value)) continue;
    out.push({ date: base[i].date, value: (base[i].value / prev.value - 1) * 100 });
  }
  return from ? out.filter(p => p.date >= from) : out;
}

// One macro number, formatted. Shared with the Dashboard tiles so a rate reads the same
// on the landing page as it does on the Macro tab — two copies of this drifted apart the
// moment either was touched. It lives here, beside the other macro arithmetic, rather
// than in lib/utils: utils pulls in date-fns, and the check harness compiles these files
// on their own with no package resolution.
export function formatMacroValue(value: number, unit: MacroUnit): string {
  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === 'B$') {
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}T`;
    return `$${value.toFixed(0)}B`;
  }
  if (unit === 'K') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}B`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}M`;
    return `${value.toLocaleString()}K`;
  }
  if (unit === '$') {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (unit === 'EH/s') return `${value >= 1 ? value.toFixed(1) : value.toFixed(4)} EH/s`;
  return value.toFixed(1);
}
