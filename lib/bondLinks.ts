// ── Where to go for the quotes this app cannot carry ─────────────────────────
//
// The prices in this app are computed, because no free public API carries traded prices
// per CUSIP. What DOES exist is a public web page: FINRA's market data site publishes
// TRACE — actual executed trades — for US bonds including Treasuries. It cannot be
// fetched and reused, but it can be opened, and it is the real thing.
//
// So each row gets a way out to the sources that hold what this app models:
//
//   FINRA          TRACE trade data — real executed prices and yields.
//   TreasuryDirect the issuer. Auction announcements and results for that CUSIP.
//   Fiscal Data    the same auction record as JSON, which is what this app reads.
//   Search         the identifier handed to a search engine. Always works, and is the
//                  fallback when one of the three above has moved.
//
// These are deep links built from an identifier, NOT verified from the machine that wrote
// them — the sandbox here reaches no external host. The shapes are checked (right
// identifier, encoded, https) and the menu offers several, so a format that has drifted
// costs one dead entry rather than the whole feature.

export interface BondLink {
  id: string;
  label: string;
  /** One line on what is actually there, since the point is that they differ. */
  note: string;
  url: string;
}

const enc = encodeURIComponent;

/**
 * Every external destination for one security. ISIN-based entries are dropped when the
 * CUSIP was malformed and no ISIN could be derived — a link built from a blank is a link
 * to the wrong page.
 */
export function bondLinks(cusip: string, isin: string | null): BondLink[] {
  const c = (cusip ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{9}$/.test(c)) return [];
  const links: BondLink[] = [
    {
      id: 'finra',
      label: 'FINRA',
      note: 'TRACE — actual executed trades, the real prices this app can only model',
      url: `https://www.finra.org/finra-data/fixed-income/bond-search?symbol=${enc(c)}`,
    },
    {
      id: 'treasurydirect',
      label: 'TreasuryDirect',
      note: 'The issuer: auction announcement and results for this security',
      url: `https://www.treasurydirect.gov/auctions/announcements-data-results/?cusip=${enc(c)}`,
    },
    {
      id: 'fiscaldata',
      label: 'Fiscal Data (JSON)',
      note: 'The official auction record this app reads, raw',
      url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/'
         + `auctions_query?filter=cusip:eq:${enc(c)}`,
    },
  ];
  // Last, and deliberately: it always resolves, so it is the one that still works when a
  // site above has reorganised its URLs.
  links.push({
    id: 'search',
    label: 'Web search',
    note: `Hands ${isin ?? c} to a search engine — the fallback if the others have moved`,
    url: `https://duckduckgo.com/?q=${enc(`${isin ?? c} treasury bond`)}`,
  });
  return links;
}

/** Every link must be https and must actually carry the identifier it claims to. */
export function isWellFormedLink(link: BondLink, cusip: string, isin: string | null): boolean {
  if (!link.url.startsWith('https://')) return false;
  const needle = enc(cusip.toUpperCase());
  const alt = isin ? enc(isin) : null;
  return link.url.includes(needle) || (alt !== null && link.url.includes(alt));
}

// ── Sorting the list ─────────────────────────────────────────────────────────

export type SortKey = 'maturityDate' | 'type' | 'couponPct' | 'price' | 'ytm' | 'issuePrice';
export type SortDir = 'asc' | 'desc';

interface SortableRow {
  maturityDate: string;
  type: string;
  couponPct: number | null;
  issuePrice: number | null;
  priced: { cleanPrice: number; ytmPct: number } | null;
  cusip: string;
}

function valueOf(r: SortableRow, key: SortKey): number | string | null {
  switch (key) {
    case 'maturityDate': return r.maturityDate;
    case 'type':         return r.type;
    case 'couponPct':    return r.couponPct;
    case 'price':        return r.priced?.cleanPrice ?? null;
    case 'ytm':          return r.priced?.ytmPct ?? null;
    case 'issuePrice':   return r.issuePrice;
  }
}

/**
 * Sort, with unknowns always last.
 *
 * A row with no price is not "worth zero" and not "worth infinity": it is unknown, and
 * under either convention it would crowd the top of one direction and look like data.
 * Pushing it to the bottom whichever way the column is sorted keeps the top of the list
 * meaning the same thing in both directions. CUSIP breaks ties so the order is stable.
 */
export function sortBonds<T extends SortableRow>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, key);
    const vb = valueOf(b, key);
    const na = va === null || (typeof va === 'number' && !isFinite(va));
    const nb = vb === null || (typeof vb === 'number' && !isFinite(vb));
    if (na && nb) return a.cusip.localeCompare(b.cusip);
    if (na) return 1;
    if (nb) return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb));
    return cmp !== 0 ? cmp * sign : a.cusip.localeCompare(b.cusip);
  });
}
