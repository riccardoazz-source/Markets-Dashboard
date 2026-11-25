// ── What is inside an index or a sector ──────────────────────────────────────
//
// One source, already live in this app: the S&P 500 constituent list (lib/sp500.ts),
// refreshed daily from a dataset its maintainers update on every rebalance, and served
// with prices, P/E and market cap by /api/sp500.
//
// That one list covers more than the S&P 500 itself. The Select Sector SPDRs (XLK, XLF,
// …) hold exactly the S&P 500 members of one GICS sector, so a sector ETF's contents are
// the same list filtered by the sector column — no second source, nothing to disagree.
//
// WEIGHTS ARE APPROXIMATE, and labelled so. The S&P 500 weights by float-adjusted market
// cap; this app has full market cap, which is close but not the same. The sector indices
// also cap any single name (around 22–25%), which a plain cap share does not apply — so
// for XLK the top two names show more weight than the fund actually gives them.

export interface Universe {
  /** Which list to read. Only one exists today; the field is here for the next. */
  source: 'sp500';
  /** GICS sector to keep, or null for the whole index. */
  sector: string | null;
  label: string;
}

const GICS: Record<string, string> = {
  XLK: 'Information Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Health Care',
  XLI: 'Industrials',
  XLY: 'Consumer Discretionary',
  XLP: 'Consumer Staples',
  XLU: 'Utilities',
  XLB: 'Materials',
  XLRE: 'Real Estate',
  XLC: 'Communication Services',
};

const SP500_SYMBOLS = new Set(['^GSPC', '^SPX', 'SPY', 'VOO', 'IVV', 'SPLG']);

/** The list behind a symbol, or null when this app does not have one for it. */
export function universeFor(symbol: string): Universe | null {
  const s = (symbol ?? '').trim().toUpperCase();
  if (SP500_SYMBOLS.has(s)) return { source: 'sp500', sector: null, label: 'S&P 500' };
  const sector = GICS[s];
  if (sector) return { source: 'sp500', sector, label: `S&P 500 ${sector}` };
  return null;
}

export interface Constituent {
  symbol: string;
  name: string;
  sector: string;
  subIndustry: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
}

export interface WeightedConstituent extends Constituent {
  /** Share of the universe's total market cap, in percent. Approximate — see above. */
  weight: number | null;
}

/** Keep the universe's members and attach each one's share of their combined cap. */
export function membersOf(all: Constituent[], u: Universe): WeightedConstituent[] {
  const kept = u.sector ? all.filter(c => c.sector === u.sector) : all;
  const total = kept.reduce((s, c) => s + (c.marketCap != null && c.marketCap > 0 ? c.marketCap : 0), 0);
  return kept.map(c => ({
    ...c,
    // A name with no market cap gets no weight rather than zero: zero would sort it to
    // the bottom as if it were the smallest company in the index.
    weight: total > 0 && c.marketCap != null && c.marketCap > 0 ? (c.marketCap / total) * 100 : null,
  }));
}

export type ConstSortKey = 'weight' | 'symbol' | 'changePercent' | 'trailingPE' | 'forwardPE' | 'price';

/** Sort with unknown values last in both directions, ties broken by symbol. */
export function sortConstituents<T extends WeightedConstituent>(rows: T[], key: ConstSortKey, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[key] as number | string | null;
    const vb = b[key] as number | string | null;
    const na = va === null || (typeof va === 'number' && !isFinite(va));
    const nb = vb === null || (typeof vb === 'number' && !isFinite(vb));
    if (na && nb) return a.symbol.localeCompare(b.symbol);
    if (na) return 1;
    if (nb) return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return cmp !== 0 ? cmp * sign : a.symbol.localeCompare(b.symbol);
  });
}

/** How much of the universe the largest N names make up — the concentration figure. */
export function topShare(rows: WeightedConstituent[], n: number): number | null {
  const w = rows.map(r => r.weight).filter((x): x is number => x != null).sort((a, b) => b - a);
  if (w.length === 0) return null;
  return w.slice(0, n).reduce((s, x) => s + x, 0);
}
