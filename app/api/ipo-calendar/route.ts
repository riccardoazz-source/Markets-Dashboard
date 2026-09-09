import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ── Upcoming IPOs ────────────────────────────────────────────────────────────
//
// The one thing on the forward calendar that CANNOT be bundled. Every other entry —
// FOMC, ECB, CPI, payrolls — is published a year ahead and almost never moves, which is
// why they ship with the app. An IPO calendar is the opposite: it changes weekly, a deal
// can be filed and priced inside a month, and a hardcoded list would be wrong within days
// of being written.
//
// SOURCE. Nasdaq's own IPO calendar endpoint, which is public JSON and needs no key. Not
// investing.com, which was the suggestion: their terms forbid scraping, their pages are
// behind an anti-bot wall that a datacenter IP will not get through, and the data would
// arrive as HTML to be guessed at. Nasdaq publishes the same deals as structured JSON,
// from the exchange the shares are listing on.
//
// WHAT IT DOES NOT COVER. Nasdaq's calendar is Nasdaq and NYSE US listings. A European or
// Asian IPO will not appear, and the card says nothing about ones it never saw. That is a
// real limit and better stated than discovered.
//
// FAILURE IS SILENT AND HARMLESS. If the fetch fails or the shape has moved, this returns
// an empty list and the rail renders exactly as it did before IPOs existed. Nothing on
// the page depends on it, so a bad day at Nasdaq cannot take the calendar down.
//
// UNVERIFIED FROM HERE. This sandbox's egress proxy refuses every outbound host, so the
// parser below could not be run against a real response. It is written defensively —
// every field optional, every row skipped rather than throwing — and `?mode=diag` returns
// the raw shape so the first run on the deployment can confirm or correct it.

export interface IpoEvent {
  id: string;
  ticker: string;
  company: string;
  /** YYYY-MM-DD, the expected pricing date. */
  date: string;
  exchange?: string;
  priceRange?: string;
  /** Deal size as published, e.g. "$120,000,000". */
  dealSize?: string;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** The months to ask for: this one and the next two, which is the rail's useful horizon. */
function months(n = 3): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Pull every row-shaped object out of whatever came back.
 *
 * Deliberately structural rather than reading a fixed path like
 * `data.upcoming.upcomingTable.rows`. A hand-written path is one rename away from
 * returning nothing at all, silently; walking for objects that LOOK like a deal survives
 * the table being moved or renamed, which for an endpoint nobody documents is the
 * likelier change.
 */
function harvest(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) { for (const n of node) harvest(n, out); return out; }
  if (!node || typeof node !== 'object') return out;
  const o = node as Record<string, unknown>;
  const hasTicker = typeof o.proposedTickerSymbol === 'string' || typeof o.symbol === 'string';
  const hasName = typeof o.companyName === 'string';
  if (hasTicker && hasName) { out.push(o); return out; }
  for (const v of Object.values(o)) harvest(v, out);
  return out;
}

const s = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Nasdaq writes dates as MM/DD/YYYY. Anything else is left alone if already ISO. */
function isoDate(v: unknown): string | null {
  const raw = s(v);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function fetchMonth(ym: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`https://api.nasdaq.com/api/ipo/calendar?date=${ym}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) { console.warn(`[ipo] ${ym} HTTP ${res.status}`); return null; }
    return await res.json();
  } catch (e) {
    console.warn(`[ipo] ${ym} failed:`, (e as Error).message);
    return null;
  } finally { clearTimeout(t); }
}

async function loadIpos(): Promise<IpoEvent[]> {
  const raws = await Promise.all(months().map(fetchMonth));
  const seen = new Set<string>();
  const out: IpoEvent[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const raw of raws) {
    for (const row of harvest(raw)) {
      const ticker = s(row.proposedTickerSymbol) ?? s(row.symbol);
      const company = s(row.companyName);
      const date = isoDate(row.expectedPriceDate) ?? isoDate(row.pricedDate);
      // A deal with no ticker, no name or no date is not something a card can say
      // anything useful about, so it is dropped rather than rendered half-blank.
      if (!ticker || !company || !date) continue;
      // Forward calendar: an IPO that already priced belongs to the past.
      if (date < today) continue;
      const id = `ipo-${ticker}-${date}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id, ticker, company, date,
        exchange: s(row.proposedExchange),
        priceRange: s(row.proposedSharePrice),
        dealSize: s(row.dollarValueOfSharesOffered),
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  return out.slice(0, 40);
}

export async function GET(req: Request) {
  // ?mode=diag returns the raw shape for ONE month, so the first run on the deployment can
  // confirm the parser rather than leaving an empty list to be explained away as "no IPOs
  // this month". Uncached, and truncated so it stays readable in a browser tab.
  if (new URL(req.url).searchParams.get('mode') === 'diag') {
    const ym = months(1)[0];
    const raw = await fetchMonth(ym);
    const rows = harvest(raw);
    return NextResponse.json({
      month: ym,
      reachable: raw !== null,
      rowsFound: rows.length,
      firstRow: rows[0] ?? null,
      parsed: (await loadIpos()).slice(0, 3),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const events = await unstable_cache(loadIpos, ['ipo-calendar'], { revalidate: 3600 })();
    return NextResponse.json({ events });
  } catch {
    // The rail treats an empty list as "no IPOs known", which is exactly right when the
    // source is unreachable — it renders as it did before this existed.
    return NextResponse.json({ events: [] });
  }
}
