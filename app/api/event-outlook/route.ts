import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import type { EventKind } from '@/lib/eventIndicator';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ── What is this release expected to say? ────────────────────────────────────
//
// Three things get asked for, and they are three DIFFERENT kinds of claim. Presenting
// them as one row of numbers would be the mistake worth avoiding, so they are kept apart
// all the way to the screen.
//
// 1. THE CURRENT VALUE is not here at all. The app already holds every one of these
//    series for the Macro tab, so the card reads it from there — exact, free, and from
//    the same source the chart draws. Nothing to be wrong about.
//
// 2. THE CONSENSUS FORECAST is a licensed data product. Bloomberg, Reuters and Trading
//    Economics sell it; there is no free feed. What exists for free is the number
//    reported in the press ahead of the release, which is what a grounded search finds.
//    So it comes with its source and it is absent when the search does not find it.
//
// 3. A PROBABILITY has to come from a market that trades the outcome, and the market
//    must be NAMED, because the two available are not equally solid.
//
//    For a rate decision it is the rates curve: fed funds futures, published by the CME
//    as FedWatch. Deep, canonical, quoted everywhere.
//
//    For a data release it is event contracts (Kalshi, Polymarket) or CPI fixing swaps.
//    This route used to refuse those outright, on the reasoning that "a statistic has no
//    traded market on its value". That was wrong — regulated event contracts list monthly
//    CPI and payrolls outcomes, and fixing swaps price the print directly. They are
//    thinner and less canonical than the rates curve, which is a reason to name the
//    market beside the number, not a reason to withhold it.
//
//    What is still refused is a probability with no market behind it: a consensus and a
//    spread of economists' estimates converted into a percentage is a precision nobody
//    measured, whatever the event.
//
// Grounding is the precondition, as in the monthly recap: a forecast recalled from
// training is a number with a date attached and nothing behind it, which is worse than
// no forecast at all.

interface Body {
  title: string;
  /** ISO instant of the event. */
  date: string;
  region?: string;
  kind: EventKind;
}

// ── Why the answer is cached where it is ─────────────────────────────────────
//
// A grounded call runs several web searches and then writes; ten to twenty seconds is
// what that costs and no prompt makes it two. So the only thing worth optimising is how
// often anyone WAITS for it.
//
// This used to be a Map in module scope. That is a cache per serverless instance, and
// instances are ephemeral and per-region: the rail could warm one instance and the
// reader's tap land on another, which is why it stayed slow after the first fix — the
// warm-up was working and being thrown away.
//
// unstable_cache writes to the deployment's shared data cache instead, so the first
// person to open a card pays for it and everyone after that, on any instance, does not.
// Thirty minutes: consensus drifts as the date approaches, and the point is to stop a
// re-open from costing another search, not to hold a number still.
const TTL_SECONDS = 30 * 60;

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_key', message: 'GEMINI_API_KEY not configured in the deployment environment.' },
      { status: 200 },
    );
  }

  const { title, date, region, kind } = await req.json() as Body;
  if (!title || !date) return NextResponse.json({ error: 'bad_request' }, { status: 200 });

  // Only a good answer is worth keeping. A failed search or an unreachable model is a
  // transient state, and caching it for half an hour would hold the panel empty long
  // after the cause had cleared — so those paths THROW, which unstable_cache does not
  // store, and are turned back into a response out here.
  try {
    const body = await unstable_cache(
      () => fetchOutlook(title, date, region, kind),
      ['event-outlook', title, date, kind],
      { revalidate: TTL_SECONDS },
    )();
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch_failed';
    try { return NextResponse.json(JSON.parse(msg)); } catch { /* not a payload */ }
    return NextResponse.json({ error: 'fetch_failed' }, { status: 200 });
  }
}

/** Throws a JSON string for anything not worth caching; returns the body otherwise. */
async function fetchOutlook(
  title: string, date: string, region: string | undefined, kind: EventKind,
) {
  const apiKey = process.env.GEMINI_API_KEY!;
  const day = date.slice(0, 10);
  const isRate = kind === 'rate';

  const systemInstruction =
    'You report what the market and forecasters currently EXPECT from one scheduled ' +
    'economic event. You do not give your own forecast, and you do not advise.\n\n' +
    'RULES:\n' +
    '1. Use ONLY what your web search returns. Every number must be one you just read. ' +
    'If the search does not give you a figure, leave that field null. A remembered ' +
    'consensus is a number with a date on it and nothing behind it — worse than none.\n' +
    '2. `consensus` is the median forecast reported ahead of the release, `previous` the ' +
    'last published reading. Include the unit exactly as the press writes it ("3.1%", ' +
    '"165K", "4.00%").\n' +
    '3. `probabilities` must come from a market that TRADES the outcome, and you must name ' +
    'that market in `oddsMarket`. ' +
    (isRate
      ? 'For a rate decision that is the rates curve — fed funds or equivalent futures, ' +
        'published by the CME as FedWatch. Give the current probability per outcome; they ' +
        'should sum to about 100.\n'
      : 'For a data release that is an event-contract venue (Kalshi, Polymarket) or a CPI ' +
        'fixing swap. These exist and are quoted; use them if your search finds them.\n') +
    '4. NEVER convert a consensus or a range of economists\' estimates into a percentage. ' +
    'A forecast spread is not a probability, and presenting it as one invents a precision ' +
    'nobody measured. If no traded market is quoted, leave `probabilities` empty and ' +
    '`oddsMarket` null — that is a correct answer, not a failure.\n' +
    '5. `asOf` is the date the figures you read were quoted, ISO YYYY-MM-DD.\n\n' +
    'Reply with JSON ONLY, no prose and no code fence:\n' +
    '{"previous":"…|null","consensus":"…|null","asOf":"YYYY-MM-DD|null","oddsMarket":"…|null",' +
    '"probabilities":[{"outcome":"hold at 3.50%","pct":82}],"note":"one short sentence or null"}';

  const prompt =
    `Event: ${title}\n` +
    `Scheduled: ${day}${region ? ` — ${region}` : ''}\n\n` +
    `Search the web for the latest consensus forecast for this release, and for any ` +
    (isRate
      ? `market-implied probabilities from the rates curve (CME FedWatch or equivalent)`
      : `traded odds on the outcome from an event-contract venue such as Kalshi or ` +
        `Polymarket, or a CPI fixing swap`) +
    `. Then return the JSON described in your instructions.`;

  const MODEL = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);

  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        // Grounding spends thinking tokens from THIS budget before a word is written, and
        // a run that dies at MAX_TOKENS makes the reader wait and then ask again — the
        // slowest path of all. Only generated tokens are billed, so a high ceiling costs
        // nothing when it is not reached. Same reasoning as the sentiment brief.
        generationConfig: { maxOutputTokens: 24000, temperature: 0.1 },
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(JSON.stringify({ error: 'upstream', status: r.status, message: txt.slice(0, 400) }));
    }

    const json = await r.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
          webSearchQueries?: string[];
        };
      }>;
    };
    const cand = json.candidates?.[0];
    const meta = cand?.groundingMetadata;
    const queries = meta?.webSearchQueries ?? [];
    const chunks = meta?.groundingChunks ?? [];
    const grounded = queries.length > 0 || chunks.length > 0;

    if (!grounded) {
      throw new Error(JSON.stringify({
        grounded: false, queries: [], sources: [],
        reason: cand?.finishReason === 'MAX_TOKENS'
          ? 'The grounded run ran out of output budget before answering.'
          : 'The web-search tool did not run for this request.',
      }));
    }

    const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('').trim();
    let parsed: {
      previous?: string | null; consensus?: string | null; asOf?: string | null;
      probabilities?: { outcome?: string; pct?: number }[];
      oddsMarket?: string | null; note?: string | null;
    } = {};
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch { /* an unparseable answer is an answer with no figures */ }

    const str = (v: unknown, max = 40) =>
      typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, max) : null;

    const probabilities = (parsed.probabilities ?? [])
      .filter(p => p && typeof p.outcome === 'string' && typeof p.pct === 'number' && isFinite(p.pct))
      .map(p => ({ outcome: String(p.outcome).slice(0, 60), pct: Math.max(0, Math.min(100, p.pct!)) }))
      .slice(0, 6);
    // A probability with no market named behind it is exactly the thing being guarded
    // against — a consensus quietly rendered as odds. The instruction is a request; this
    // is the guarantee, so odds without a venue are dropped whatever the event kind.
    const oddsMarket = str(parsed.oddsMarket, 80);
    const odds = oddsMarket ? probabilities : [];

    const body = {
      grounded: true,
      previous: str(parsed.previous),
      consensus: str(parsed.consensus),
      asOf: str(parsed.asOf),
      probabilities: odds,
      oddsMarket: odds.length > 0 ? oddsMarket : null,
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 240) : null,
      queries,
      sources: chunks.map(c => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? '' })).filter(s => s.uri),
    };
    return body;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('{')) throw e; // already a payload
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new Error(JSON.stringify({ error: aborted ? 'timeout' : 'fetch_failed' }));
  } finally {
    clearTimeout(timer);
  }
}
