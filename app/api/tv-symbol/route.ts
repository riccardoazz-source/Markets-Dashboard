import { NextResponse } from 'next/server';
import { tradingViewSymbol } from '@/lib/tradingview';

export const runtime = 'edge';

// ── Resolve one of our symbols to a TradingView symbol that ACTUALLY EXISTS ───
//
// The table in lib/tradingview.ts is a set of educated guesses, and a wrong guess
// here has a nasty failure mode: TradingView's embed does not raise an error for an
// unknown symbol, it quietly loads its default — which is how "KOSPI" came up
// showing Apple. A guess that fails loudly would be fine; one that fails silently
// is not.
//
// So the guess is checked against TradingView's own symbol search before it is
// used, and when it does not check out the search picks the replacement. The table
// still matters: it says which of several matches is the right one (SPX on TVC, not
// a fund called SPX), and the search only has to confirm it.
//
// Anything unresolvable comes back with tv: null, and the UI shows no chart rather
// than someone else's.

interface Resolved {
  tv: string | null;
  /** What TradingView calls it — shown next to our name so a mismatch is visible. */
  description?: string;
  /** false when the search could not be reached and the table's guess is being used. */
  verified: boolean;
  /** true when the search replaced the table's guess. */
  corrected?: boolean;
}

const cache = new Map<string, { data: Resolved; ts: number }>();
const TTL = 24 * 60 * 60_000;   // listings do not move; a day is plenty

const clean = (s: unknown) => String(s ?? '').replace(/<\/?[^>]+>/g, '').trim();

interface Hit { symbol: string; exchange: string; description: string; type: string; }

async function search(text: string): Promise<Hit[]> {
  const url = 'https://symbol-search.tradingview.com/symbol_search/v3/?'
    + new URLSearchParams({ text, hl: '0', lang: 'en', domain: 'production' }).toString();
  const res = await fetch(url, {
    headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const json = await res.json() as { symbols?: Record<string, unknown>[] };
  return (json.symbols ?? []).map(r => ({
    symbol: clean(r.symbol),
    // v3 gives the display exchange in `exchange` and the real prefix in `prefix`
    // for feeds like TVC and FX_IDC; the prefix is the one that belongs in a symbol.
    exchange: clean(r.prefix || r.exchange).toUpperCase(),
    description: clean(r.description),
    type: clean(r.type).toLowerCase(),
  })).filter(h => h.symbol && h.exchange);
}

/** Does `candidate` (EXCHANGE:TICKER) appear in the search results for its ticker? */
function found(hits: Hit[], candidate: string): Hit | null {
  const [ex, tk] = candidate.includes(':') ? candidate.split(':') : ['', candidate];
  return hits.find(h => h.symbol.toUpperCase() === tk.toUpperCase()
    && (!ex || h.exchange === ex.toUpperCase())) ?? null;
}

/** Best replacement when the candidate does not exist, or null if nothing fits. */
function bestFor(hits: Hit[], group?: string, ticker?: string): Hit | null {
  const wantIndex = group === 'Indexes';
  const wantFx = group === 'Currency';
  const scored = hits.map(h => {
    let score = 0;
    if (wantIndex && h.type === 'index') score += 10;
    if (wantFx && (h.type === 'forex' || h.exchange === 'FX_IDC')) score += 10;
    if (!wantIndex && !wantFx && (h.type === 'stock' || h.type === 'fund')) score += 4;
    // An exact ticker match beats a fuzzy one: searching "KOSPI" also returns funds
    // with KOSPI in their description.
    if (ticker && h.symbol.toUpperCase() === ticker.toUpperCase()) score += 6;
    if (h.exchange === 'TVC') score += 2;         // TradingView's own feed needs no entitlement
    return { h, score };
  }).sort((a, b) => b.score - a.score);
  return scored.length && scored[0].score > 0 ? scored[0].h : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') ?? '').trim();
  const name = (searchParams.get('name') ?? '').trim();
  const group = (searchParams.get('group') ?? '').trim() || undefined;
  if (!symbol) return NextResponse.json({ tv: null, verified: false } as Resolved);

  const key = `${symbol}|${group ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  const candidate = tradingViewSymbol(symbol, group);
  const ticker = candidate?.includes(':') ? candidate.split(':')[1] : candidate ?? '';

  let data: Resolved;
  try {
    // Search by the candidate's ticker first — that is what TradingView indexes.
    // If the candidate itself is unknown, fall back to the asset's NAME, which is
    // how a person would look it up ("KOSPI", "Straits Times").
    let hits = ticker ? await search(ticker) : [];
    let match = candidate ? found(hits, candidate) : null;

    if (!match && name) {
      const byName = await search(name);
      hits = [...hits, ...byName];
      match = candidate ? found(hits, candidate) : null;
    }

    if (match) {
      data = { tv: `${match.exchange}:${match.symbol}`, description: match.description, verified: true };
    } else {
      const best = bestFor(hits, group, ticker);
      data = best
        ? { tv: `${best.exchange}:${best.symbol}`, description: best.description, verified: true, corrected: true }
        : { tv: null, verified: true };
    }
  } catch {
    // Search unreachable: fall back to the table and SAY it is unverified, so the UI
    // can warn rather than present a guess as a fact.
    data = { tv: candidate, verified: false };
  }

  cache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
