// ── What a fund holds: one source for every index and every sector ───────────
//
// Yahoo Finance's `topHoldings` module answers for ANY fund it covers — the thematic ETFs
// in the Sectors tab (WCLD, MAGS, BITQ, NLR, …), the European ones, the bond funds — with
// the same shape every time. One reader for all of them, which is the point.
//
// An INDEX has no holdings of its own, so it is read through an ETF that tracks THAT SAME
// index: QQQ for the Nasdaq 100, EXS1.DE for the DAX. Where no such fund is known with
// confidence the index is left unmapped rather than given a fund that tracks something
// else — MSCI Korea is not the KOSPI, and its top ten would be presented as the KOSPI's.
//
// THE LIMIT, stated where it is shown: Yahoo publishes the largest holdings — about ten —
// plus the fund's sector split, not the full book. For the S&P 500 and its eleven sector
// SPDRs the full member list is already in the app (lib/constituents) and is used instead.

/** Index → a fund that tracks the same index. Shown on the panel as "via …". */
export const INDEX_PROXY: Record<string, string> = {
  '^GSPC': 'SPY',
  '^NDX': 'QQQ',
  '^DJI': 'DIA',
  '^RUT': 'IWM',
  '^STOXX50E': 'FEZ',
  '^STOXX': 'EXSA.DE',
  '^GDAXI': 'EXS1.DE',
  '^FTSE': 'ISF.L',
  '^FCHI': 'CAC.PA',
  '^990100-USD-STRD': 'URTH',
  '^N225': '1321.T',
  '^HSI': '2800.HK',
  '000300.SS': 'ASHR',
  '^STI': 'ES3.SI',
  '^AXJO': 'STW.AX',
  '^GSPTSE': 'XIC.TO',
  '^BVSP': 'BOVA11.SA',
};

/** Groups whose members are funds, so asking Yahoo for holdings is meaningful. */
const FUND_GROUPS = new Set(['sectors', 'sector', 'etf', 'etfs']);

export interface HoldingsSource {
  /** The fund actually asked for. */
  fund: string;
  /** Set when the asset is an index read through a tracking fund. */
  via: string | null;
}

/**
 * Which fund to read for this asset, or null when there is none — a stock, a currency,
 * a commodity future, or an index with no known tracker.
 */
export function holdingsSourceFor(symbol: string, group?: string | null): HoldingsSource | null {
  const s = (symbol ?? '').trim();
  if (!s) return null;
  const proxy = INDEX_PROXY[s] ?? INDEX_PROXY[s.toUpperCase()];
  if (proxy) return { fund: proxy, via: proxy };
  if (s.startsWith('^')) return null;                  // an index with no tracker
  if (group && FUND_GROUPS.has(group.trim().toLowerCase())) return { fund: s, via: null };
  return null;
}

export interface Holding { symbol: string | null; name: string; weight: number | null }
export interface SectorWeight { sector: string; weight: number }
export interface FundHoldings {
  holdings: Holding[];
  sectors: SectorWeight[];
  /** Share of the fund the listed holdings make up, when it can be summed. */
  listedShare: number | null;
}

const SECTOR_NAMES: Record<string, string> = {
  realestate: 'Real Estate',
  consumer_cyclical: 'Consumer Cyclical',
  basic_materials: 'Basic Materials',
  consumer_defensive: 'Consumer Defensive',
  technology: 'Technology',
  communication_services: 'Communication Services',
  financial_services: 'Financial Services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
};

/** Yahoo numbers arrive as `{ raw, fmt }` or as a bare number; fractions become percent. */
function pct(v: unknown): number | null {
  const raw = typeof v === 'number' ? v
    : v && typeof v === 'object' && typeof (v as { raw?: unknown }).raw === 'number'
      ? (v as { raw: number }).raw : null;
  return raw == null || !isFinite(raw) ? null : raw * 100;
}

/**
 * Read a quoteSummary result carrying `topHoldings`.
 *
 * Defensive by construction — written against a response this machine could not fetch.
 * Anything missing yields an empty list, never a throw; holdings are sorted by weight
 * and the sector split drops zero-weight sectors, which Yahoo lists for every fund.
 */
export function parseTopHoldings(result: unknown): FundHoldings {
  const th = (result as { topHoldings?: Record<string, unknown> } | null)?.topHoldings;
  const rawHoldings = Array.isArray(th?.holdings) ? th!.holdings as Record<string, unknown>[] : [];
  const holdings: Holding[] = rawHoldings.map(h => ({
    symbol: typeof h.symbol === 'string' && h.symbol.trim() ? h.symbol.trim() : null,
    name: String(h.holdingName ?? h.symbol ?? '').trim() || '—',
    weight: pct(h.holdingPercent),
  })).filter(h => h.name !== '—' || h.symbol);
  holdings.sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));

  const rawSectors = Array.isArray(th?.sectorWeightings) ? th!.sectorWeightings as Record<string, unknown>[] : [];
  const sectors: SectorWeight[] = [];
  for (const entry of rawSectors) {
    for (const [k, v] of Object.entries(entry ?? {})) {
      const w = pct(v);
      if (w != null && w > 0) sectors.push({ sector: SECTOR_NAMES[k] ?? k, weight: w });
    }
  }
  sectors.sort((a, b) => b.weight - a.weight);

  const ws = holdings.map(h => h.weight).filter((w): w is number => w != null);
  return { holdings, sectors, listedShare: ws.length ? ws.reduce((s, w) => s + w, 0) : null };
}
