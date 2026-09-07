import { NextResponse } from 'next/server';
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
// 3. A PROBABILITY only genuinely exists for a RATE DECISION. Rate futures trade on the
//    outcome, so "82% priced for a hold" is a real market-implied number, published by
//    the CME as FedWatch. For a data release there is no such thing: there is a consensus
//    and a spread of economists' estimates, and calling that a probability would invent a
//    precision the number does not have. This route therefore asks for probabilities ONLY
//    on rate decisions, and the model is told why.
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

interface Entry { body: unknown; ts: number }
const cache = new Map<string, Entry>();
// Consensus moves as the date approaches, so this is short. It exists to stop re-opening
// a card from costing another search, not to hold a number still.
const TTL = 30 * 60_000;

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

  const key = `${title}:${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.body);

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
    (isRate
      ? '3. This is a RATE DECISION, so market-implied probabilities exist — rate futures ' +
        'trade on the outcome and the CME publishes them as FedWatch. Give the current ' +
        'probabilities per outcome, as read, and they should sum to about 100.\n'
      : '3. This is a DATA RELEASE. There is NO probability for it — only a consensus and ' +
        'a spread of estimates. Leave `probabilities` empty. Do not convert a forecast ' +
        'range into a probability; that would invent a precision the number lacks.\n') +
    '4. `asOf` is the date the figures you read were quoted, ISO YYYY-MM-DD.\n\n' +
    'Reply with JSON ONLY, no prose and no code fence:\n' +
    '{"previous":"…|null","consensus":"…|null","asOf":"YYYY-MM-DD|null",' +
    '"probabilities":[{"outcome":"hold at 3.50%","pct":82}],"note":"one short sentence or null"}';

  const prompt =
    `Event: ${title}\n` +
    `Scheduled: ${day}${region ? ` — ${region}` : ''}\n\n` +
    `Search the web for the latest consensus forecast for this release` +
    (isRate ? ', and the current market-implied probabilities for each outcome' : '') +
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
        generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return NextResponse.json(
        { error: 'upstream', status: r.status, message: txt.slice(0, 400) }, { status: 200 });
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
      return NextResponse.json({
        grounded: false, queries: [], sources: [],
        reason: cand?.finishReason === 'MAX_TOKENS'
          ? 'The grounded run ran out of output budget before answering.'
          : 'The web-search tool did not run for this request.',
      });
    }

    const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('').trim();
    let parsed: {
      previous?: string | null; consensus?: string | null; asOf?: string | null;
      probabilities?: { outcome?: string; pct?: number }[]; note?: string | null;
    } = {};
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch { /* an unparseable answer is an answer with no figures */ }

    const str = (v: unknown) =>
      typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, 40) : null;

    // Probabilities are dropped outright for a data release even if the model produced
    // them anyway. The instruction not to invent one is a request; this is the guarantee.
    const probabilities = isRate
      ? (parsed.probabilities ?? [])
          .filter(p => p && typeof p.outcome === 'string' && typeof p.pct === 'number' && isFinite(p.pct))
          .map(p => ({ outcome: String(p.outcome).slice(0, 60), pct: Math.max(0, Math.min(100, p.pct!)) }))
          .slice(0, 6)
      : [];

    const body = {
      grounded: true,
      previous: str(parsed.previous),
      consensus: str(parsed.consensus),
      asOf: str(parsed.asOf),
      probabilities,
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 240) : null,
      queries,
      sources: chunks.map(c => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? '' })).filter(s => s.uri),
    };
    cache.set(key, { body, ts: Date.now() });
    return NextResponse.json(body);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({ error: aborted ? 'timeout' : 'fetch_failed' }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
