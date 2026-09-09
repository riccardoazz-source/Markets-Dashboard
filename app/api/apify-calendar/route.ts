import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { normalizeDataset, flagFor, type ApifyCalendarRow } from '@/lib/apifyCalendar';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ── The economic calendar, via Apify ─────────────────────────────────────────
//
// Apify runs the scraper on ITS machines. The anti-bot wall a datacenter IP hits on a
// calendar site is on their side of the fence; what reaches this app is plain JSON, which
// is the shape everything here already consumes. That is the whole reason to use it.
//
// WHICH URL. Not the one the console shows first. That one addresses a single finished
// RUN and its dataset:
//
//     /v2/datasets/<datasetId>/items      ← a snapshot, frozen forever
//
// A calendar read from there is correct once and stale the next day. What is wanted is the
// latest SUCCESSFUL run of the actor, which is a stable URL whose contents move:
//
//     /v2/acts/<actorId>/runs/last/dataset/items?status=SUCCEEDED
//
// paired with a schedule in Apify that runs the actor once a day. The app then always
// reads yesterday's crawl and never triggers one itself — a page load must never wait on
// a scraper, and running the actor per request would burn the account's credit on every
// visitor.
//
// CONFIGURED, NOT HARDCODED. The actor differs per account, so both the token and the
// actor id come from the environment and the route reports itself unconfigured rather
// than half-working. The token is read server-side only and never reaches the browser.
//
// UNVERIFIED FROM HERE. This sandbox's proxy refuses every outbound host, Apify included,
// so `?mode=diag` returns the raw first item and its key names. The normaliser in
// lib/apifyCalendar guesses at field names that actors commonly use; one look at the diag
// confirms them or says which to add.

const TTL_SECONDS = 60 * 60;

function config() {
  const token = process.env.APIFY_TOKEN;
  // Either address the actor's latest run (what you want, with a schedule), or pin one
  // dataset (useful while checking a shape).
  const actor = process.env.APIFY_CALENDAR_ACTOR;
  const dataset = process.env.APIFY_CALENDAR_DATASET;
  return { token, actor, dataset, ok: !!token && !!(actor || dataset) };
}

function itemsUrl({ token, actor, dataset }: ReturnType<typeof config>): string {
  const auth = `token=${encodeURIComponent(token!)}`;
  return actor
    ? `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs/last/dataset/items?status=SUCCEEDED&clean=true&limit=1000&${auth}`
    : `https://api.apify.com/v2/datasets/${encodeURIComponent(dataset!)}/items?clean=true&limit=1000&${auth}`;
}

async function fetchItems(): Promise<unknown[]> {
  const cfg = config();
  if (!cfg.ok) return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(itemsUrl(cfg), { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) { console.warn(`[apify] HTTP ${res.status}`); return []; }
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (e) {
    console.warn('[apify] failed:', (e as Error).message);
    return [];
  } finally { clearTimeout(t); }
}

async function loadCalendar(): Promise<ApifyCalendarRow[]> {
  return normalizeDataset(await fetchItems());
}

export async function GET(req: Request) {
  const cfg = config();

  if (new URL(req.url).searchParams.get('mode') === 'diag') {
    // Deliberately reports WHICH half is missing: "no token" and "no actor" need
    // different fixes, and "unconfigured" tells you neither.
    const items = cfg.ok ? await fetchItems() : [];
    const first = items[0];
    return NextResponse.json({
      hasToken: !!cfg.token,
      actor: cfg.actor ?? null,
      dataset: cfg.dataset ?? null,
      itemsReturned: items.length,
      // The key names are the thing worth seeing: the normaliser is a set of guesses at
      // exactly these, and this is what turns them into knowledge.
      firstItemKeys: first && typeof first === 'object' ? Object.keys(first as object) : null,
      firstItem: first ?? null,
      parsed: normalizeDataset(items).slice(0, 3),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (!cfg.ok) {
    // Not an error: the app works without it, and the rail simply has no rows from here.
    return NextResponse.json({ configured: false, events: [] });
  }
  try {
    const rows = await unstable_cache(loadCalendar, ['apify-calendar'], { revalidate: TTL_SECONDS })();
    return NextResponse.json({
      configured: true,
      events: rows.map(r => ({ ...r, flag: flagFor(r.country) })),
    });
  } catch {
    return NextResponse.json({ configured: true, events: [] });
  }
}
