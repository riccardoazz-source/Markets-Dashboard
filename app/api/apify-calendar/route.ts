import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { normalizeDataset, flagFor, actorIdFrom, type ApifyCalendarRow } from '@/lib/apifyCalendar';

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
// CONFIGURED, NOT HARDCODED. A token in the source is a token in the git history forever,
// scanned by bots within minutes of the push and no longer secret whatever the repo's
// visibility — so it comes from the environment, is read server-side only, and never
// reaches the browser or a commit.
//
// The simplest way to set it is APIFY_CALENDAR_URL: paste the whole "Get dataset items"
// URL from the Apify console, token and all, as ONE variable. That is exactly the string
// the console hands you, so there is nothing to take apart and nothing to get wrong.
// APIFY_TOKEN plus APIFY_CALENDAR_ACTOR remains available and is the better long-term
// shape, since it addresses the actor's LATEST run rather than one frozen dataset.
//
// UNVERIFIED FROM HERE. This sandbox's proxy refuses every outbound host, Apify included,
// so `?mode=diag` returns the raw first item and its key names. The normaliser in
// lib/apifyCalendar guesses at field names that actors commonly use; one look at the diag
// confirms them or says which to add.

// The crawl itself is scheduled weekly, so re-reading it every hour buys nothing. Six
// hours keeps the app responsive to a run finishing without asking Apify for the same
// week's rows over and over.
const TTL_SECONDS = 6 * 60 * 60;

/** Filtering and time handling, all settable without a redeploy of the parser. */
function options() {
  const n = Number(process.env.APIFY_CALENDAR_MIN_IMPORTANCE);
  return {
    minImportance: isFinite(n) && n >= 1 && n <= 3 ? n : 2,
    // The feed publishes wall-clock times in ONE zone, which the row does not record.
    //
    // UTC, not Rome — and this is arithmetic rather than a preference. China's statistics
    // bureau publishes CPI at 09:30 Beijing, which is 01:30 UTC, and the feed's row for
    // that release says exactly "01:30". Read as Rome it would have been 23:30 UTC, i.e.
    // 07:30 Beijing: two hours before the release actually happened, on every card.
    //
    // The actor's own TimeZone input was left empty, so it fell back to its default, and
    // GMT is what that default turns out to be. Setting that field in Apify changes this,
    // so it stays overridable.
    timeZone: process.env.APIFY_CALENDAR_TZ || 'UTC',
    only: (process.env.APIFY_CALENDAR_ONLY ?? '').split(',').map(x => x.trim()).filter(Boolean),
  };
}

function config() {
  // A whole URL pasted from the console wins: one variable, nothing to assemble.
  const url = process.env.APIFY_CALENDAR_URL;
  const token = process.env.APIFY_TOKEN;
  // Either address the actor's latest run (what you want, with a schedule), or pin one
  // dataset (useful while checking a shape).
  // Accepts the actor's page URL as readily as its id — see actorIdFrom. Whichever of
  // Apify's three ways of naming an actor you happened to copy, it works.
  const actor = actorIdFrom(process.env.APIFY_CALENDAR_ACTOR);
  const dataset = process.env.APIFY_CALENDAR_DATASET;
  // A token ALONE is now enough: the run is discovered. Naming the actor is still
  // supported and skips the discovery, but it is no longer something to work out.
  return { url, token, actor, dataset, ok: !!url || !!token };
}

function itemsUrl({ url, token, actor, dataset }: ReturnType<typeof config>): string {
  if (url) return url;
  // Neither named: the caller discovers the dataset instead. This value is never fetched.
  if (!actor && !dataset) return '(discovered from the account\'s recent runs)';
  const auth = `token=${encodeURIComponent(token!)}`;
  return actor
    ? `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs/last/dataset/items?status=SUCCEEDED&clean=true&limit=1000&${auth}`
    : `https://api.apify.com/v2/datasets/${encodeURIComponent(dataset!)}/items?clean=true&limit=1000&${auth}`;
}

/** A URL safe to print: the token is the one thing that must never appear in a response. */
function redact(u: string): string {
  return u.replace(/([?&]token=)[^&]*/i, '$1***');
}

/** Whether the configured URL addresses a frozen dataset rather than the latest run. */
function isSnapshot(cfg: ReturnType<typeof config>): boolean {
  const u = cfg.url ?? '';
  return !!cfg.dataset || /\/v2\/datasets\//.test(u);
}

interface DiscoveredRun {
  datasetId: string; actorId?: string; status?: string; finishedAt?: string;
}
/**
 * The outcome AND the reasoning.
 *
 * The first version returned the run or null, which meant a failed search reported itself
 * as one word — a diagnostic that could not diagnose its own failure, on the one request
 * whose whole job is to explain what went wrong. The trace names each run it looked at,
 * what it found there and why it moved on.
 */
interface DiscoveryResult { found: DiscoveredRun | null; trace: string[] }

/**
 * Find the calendar run without being told where it is.
 *
 * Asking someone to hunt down an "actor id" is asking them to learn Apify's URL scheme to
 * use this app, and the console makes it genuinely hard: the schedule page, the actor page
 * and the run page all have different ids in the address bar and none of them is labelled.
 * With a token, none of that is necessary — Apify will list the account's own runs.
 *
 * So: the most recent successful runs, newest first, and for each one a peek at its
 * dataset. The first whose rows actually PARSE as calendar rows is the one. That test is
 * what makes this safe on an account running several actors: a web scraper's output does
 * not normalise into dated events, so it is skipped rather than mistaken for a calendar.
 *
 * It also tracks a weekly schedule for free — next Monday's run is simply the newest one.
 */
async function discoverDataset(token: string): Promise<DiscoveryResult> {
  const trace: string[] = [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // NOT filtered to SUCCEEDED. A run can fill its dataset and still finish as TIMED-OUT
    // or ABORTED — a scraper that got through most of a calendar before its limit is
    // still a calendar, and filtering on status hid exactly that case. The parse test
    // below is the real filter; status is only reported.
    const listUrl = `https://api.apify.com/v2/actor-runs?token=${encodeURIComponent(token)}&desc=1&limit=10`;
    const res = await fetch(listUrl, { signal: ctrl.signal, cache: 'no-store' });
    trace.push(`run list: HTTP ${res.status}`);
    if (!res.ok) {
      // 401 means the token is wrong or lacks the scope; anything else is Apify's side.
      trace.push(res.status === 401 || res.status === 403
        ? 'the token was refused — check it was pasted whole, with no spaces'
        : 'Apify refused the request');
      return { found: null, trace };
    }
    const json = await res.json() as {
      data?: { items?: Array<{ id?: string; actId?: string; status?: string;
                               defaultDatasetId?: string; finishedAt?: string }> };
    };
    const runs = json.data?.items ?? [];
    trace.push(`${runs.length} recent run(s)`);
    if (runs.length === 0) {
      trace.push('the account has no runs yet — a weekly schedule may not have fired');
      return { found: null, trace };
    }

    // Bounded on purpose: each probe is a round trip, and this route has thirty seconds.
    for (const run of runs) {
      const label = `${run.actId ?? '?'} (${run.status ?? '?'})`;
      if (!run.defaultDatasetId) { trace.push(`${label}: no dataset`); continue; }
      const probe = await fetch(
        `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=50&token=${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      ).then(r => r.ok ? r.json() : null).catch(() => null);
      if (!Array.isArray(probe)) { trace.push(`${label}: dataset unreadable`); continue; }
      if (probe.length === 0) { trace.push(`${label}: dataset empty`); continue; }
      // minImportance 1: the probe asks "is this a calendar at all", not "is it
      // interesting" — filtering here could reject a run of purely low-grade rows.
      const parsed = normalizeDataset(probe, { ...options(), minImportance: 1 }).length;
      if (parsed === 0) {
        // The keys are what says WHY: a scraper's output has no date/event fields at all,
        // while a calendar whose field names moved has different ones.
        const keys = probe[0] && typeof probe[0] === 'object' ? Object.keys(probe[0]).join(',') : '?';
        trace.push(`${label}: ${probe.length} rows, none parsed — keys: ${keys}`);
        continue;
      }
      trace.push(`${label}: ${probe.length} rows, ${parsed} parsed → using this one`);
      return {
        found: { datasetId: run.defaultDatasetId, actorId: run.actId,
                 status: run.status, finishedAt: run.finishedAt },
        trace,
      };
    }
    trace.push('no run looked like a calendar');
    return { found: null, trace };
  } catch (e) {
    trace.push(`failed: ${(e as Error).message}`);
    return { found: null, trace };
  } finally { clearTimeout(t); }
}

/** Every row of one dataset, by id. */
async function fetchDataset(datasetId: string, token: string): Promise<unknown[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=1000&token=${encodeURIComponent(token)}`,
      { signal: ctrl.signal, cache: 'no-store' },
    );
    if (!res.ok) { console.warn(`[apify] dataset HTTP ${res.status}`); return []; }
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (e) {
    console.warn('[apify] dataset failed:', (e as Error).message);
    return [];
  } finally { clearTimeout(t); }
}

async function fetchItems(): Promise<unknown[]> {
  const cfg = config();
  if (!cfg.ok) return [];
  // Nothing named → find it. One path, so the diagnostic and the live feed cannot
  // disagree about which dataset is being read.
  if (!cfg.url && !cfg.actor && !cfg.dataset && cfg.token) {
    const { found } = await discoverDataset(cfg.token);
    return found ? fetchDataset(found.datasetId, cfg.token) : [];
  }
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
  return normalizeDataset(await fetchItems(), options());
}

export async function GET(req: Request) {
  const cfg = config();

  if (new URL(req.url).searchParams.get('mode') === 'diag') {
    // Deliberately reports WHICH half is missing: "no token" and "no actor" need
    // different fixes, and "unconfigured" tells you neither.
    // Discovered ONCE and reused. The first version called discoverDataset here and again
    // inside fetchItems, doubling the number of round trips on exactly the request most
    // likely to be near its time limit.
    const autoMode = cfg.ok && !cfg.url && !cfg.actor && !cfg.dataset && !!cfg.token;
    const discovery = autoMode ? await discoverDataset(cfg.token!) : null;
    const items = !cfg.ok ? []
      : autoMode
        ? (discovery?.found ? await fetchDataset(discovery.found.datasetId, cfg.token!) : [])
        : await fetchItems();
    const first = items[0];
    return NextResponse.json({
      configured: cfg.ok,
      // When nothing is set, the answer is not "false" — it is what to do about it.
      setup: cfg.ok ? undefined : {
        allYouNeed: 'Set APIFY_TOKEN in the Vercel project to an Apify API token. Nothing else — the calendar run is found by looking at the account\'s own recent successful runs and taking the newest one whose rows parse as calendar events.',
        where: 'Vercel → Project → Settings → Environment Variables, then redeploy.',
        optional: 'APIFY_CALENDAR_ACTOR pins a specific actor and skips the search; APIFY_CALENDAR_URL takes a whole "Get dataset items" URL. Neither is necessary.',
      },
      // A dataset URL is a SNAPSHOT of one finished run: correct today, stale tomorrow.
      // Worth saying out loud, because it fails by going quietly out of date.
      warning: cfg.ok && isSnapshot(cfg)
        ? 'This points at one finished run\'s dataset, which never updates. Use APIFY_CALENDAR_ACTOR with a daily schedule for a feed that stays current.'
        : undefined,
      source: cfg.ok
        ? (cfg.url || cfg.actor || cfg.dataset ? redact(itemsUrl(cfg)) : 'discovered from recent runs')
        : null,
      discovered: autoMode ? discovery?.found ?? null : undefined,
      // Each run considered, and why it was or was not used. This is the field to read
      // when `discovered` is null.
      discoveryTrace: autoMode ? discovery?.trace : undefined,
      itemsReturned: items.length,
      // The key names are the thing worth seeing: the normaliser is a set of guesses at
      // exactly these, and this is what turns them into knowledge.
      firstItemKeys: first && typeof first === 'object' ? Object.keys(first as object) : null,
      firstItem: first ?? null,
      options: options(),
      // Both counts, because the gap between them is the thing worth seeing: a big drop
      // means the importance filter is doing its job, and zero parsed from many items
      // means the shape moved.
      parsedCount: normalizeDataset(items, options()).length,
      parsed: normalizeDataset(items, options()).slice(0, 3),
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
      events: rows.map(r => ({ ...r, flag: flagFor(r.country, r.currency) })),
    });
  } catch {
    return NextResponse.json({ configured: true, events: [] });
  }
}
