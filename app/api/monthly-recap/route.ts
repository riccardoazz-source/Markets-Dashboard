import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ── What happened to one asset in one month ──────────────────────────────────
//
// A recap is ENTIRELY news. Every other AI surface in this app can fall back to an
// ungrounded answer and still be worth something — a read on the numbers it was handed is
// still a read on those numbers. This one cannot: with no live search there is nothing
// left but the model's memory of a month, presented as reporting. That is how you get a
// confident, sourceless, wrong account of an earnings date.
//
// So grounding is not a preference here, it is the precondition. If the search tool did
// not run, this returns no items and says why, and the panel shows that instead. The
// app already learned this once, on the sentiment brief, which published search-derived
// "drivers" from a run whose search had failed.

interface RecapItem {
  /** YYYY-MM-DD. The day the thing happened, not the day it was written about. */
  date: string;
  headline: string;
  detail: string;
  /** Direction for the ASSET, as the item's own text supports — not a forecast. */
  impact: 'up' | 'down' | 'neutral';
}

interface Body {
  symbol: string;
  name: string;
  assetClass?: string;
  /** YYYY-MM. Defaults to the current month. */
  month?: string;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1] ?? ''} ${y}`;
}

/** First and last day of a YYYY-MM, inclusive. */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

// A finished month never changes, so it is cached hard. The current one is still being
// written, so it is cached only long enough to stop a panel re-open from costing another
// search — a recap that refuses to update while the month is live would be worse than
// slow.
interface Entry { body: unknown; ts: number }
const cache = new Map<string, Entry>();
const TTL_PAST = 30 * 24 * 60 * 60_000;
const TTL_CURRENT = 60 * 60_000;

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_key', message: 'GEMINI_API_KEY not configured in the deployment environment.' },
      { status: 200 },
    );
  }

  const { symbol, name, assetClass, month } = await req.json() as Body;
  if (!symbol || !name) return NextResponse.json({ error: 'bad_request' }, { status: 200 });

  const nowYm = new Date().toISOString().slice(0, 7);
  const ym = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : nowYm;
  const isCurrent = ym >= nowYm;

  const key = `${symbol}:${ym}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < (isCurrent ? TTL_CURRENT : TTL_PAST)) {
    return NextResponse.json(hit.body);
  }

  const { from, to } = monthBounds(ym);
  const window = isCurrent
    ? `${monthLabel(ym)}, from ${from} up to today`
    : `${monthLabel(ym)} (${from} to ${to})`;

  const systemInstruction =
    'You are a markets desk analyst writing a factual monthly recap for ONE asset. ' +
    'You report what happened; you do not forecast, advise, or characterise anything as ' +
    'a buying or selling opportunity.\n\n' +
    'RULES:\n' +
    '1. Use ONLY what your web search returns. If the search gives you nothing about this ' +
    'asset in this window, return an empty list. Never fill the gap from memory — a recap ' +
    'is reporting, and an unsourced recollection presented as reporting is the one failure ' +
    'this feature cannot survive.\n' +
    '2. Every item must be a DATED, SPECIFIC event: an earnings release, a guidance change, ' +
    'a central-bank decision, a regulatory ruling, an index inclusion, a supply shock, a ' +
    'large corporate action. "The stock fell on macro worries" is not an event.\n' +
    '3. `date` is the day the event happened, ISO YYYY-MM-DD, inside the requested window.\n' +
    '4. `impact` describes the direction the item itself supports for THIS asset — up, down, ' +
    'or neutral. It is a description of what happened, not a prediction.\n' +
    '5. At most 8 items, most important first. Fewer is correct when less happened; padding ' +
    'a quiet month with filler is a lie about the month.\n' +
    '6. `detail` is one or two sentences with the concrete figure where there is one ' +
    '(the EPS number, the size of the cut, the percentage move).\n\n' +
    'Reply with JSON ONLY, no prose and no code fence:\n' +
    '{"items":[{"date":"YYYY-MM-DD","headline":"...","detail":"...","impact":"up|down|neutral"}]}';

  const prompt =
    `Asset: ${name} (${symbol})${assetClass ? ` — ${assetClass}` : ''}\n` +
    `Window: ${window}\n\n` +
    `Search the web for what actually happened to this asset in that window, then return ` +
    `the JSON described in your instructions.`;

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
        // Room for the search to think AND for the answer. The sentiment route hit
        // MAX_TOKENS on a smaller budget and silently fell through to an ungrounded
        // answer, which is exactly the outcome this feature must not have.
        generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
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

    // Grounded means the search TOOL RAN, evidenced by the queries it issued or the
    // chunks it read back. Text that merely mentions a source is not evidence of one.
    const queries = meta?.webSearchQueries ?? [];
    const chunks = meta?.groundingChunks ?? [];
    const grounded = queries.length > 0 || chunks.length > 0;

    if (!grounded) {
      const body = {
        month: ym, grounded: false, items: [], sources: [],
        reason: cand?.finishReason === 'MAX_TOKENS'
          ? 'The grounded run ran out of output budget before answering.'
          : 'The web-search tool did not run for this request.',
      };
      // Not cached: a failed search is a transient state, and caching it would keep the
      // panel empty for an hour after the cause had cleared.
      return NextResponse.json(body);
    }

    const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('').trim();
    let items: RecapItem[] = [];
    try {
      // The model is asked for bare JSON but sometimes fences it anyway.
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) as { items?: RecapItem[] } : null;
      items = Array.isArray(parsed?.items) ? parsed!.items! : [];
    } catch { items = []; }

    // Keep only well-formed items inside the requested month. A recap that quietly
    // includes last month's earnings is worse than one that is short.
    items = items
      .filter(i => i && typeof i.headline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date ?? ''))
      .filter(i => i.date >= from && i.date <= to)
      .map(i => ({
        date: i.date,
        headline: String(i.headline).slice(0, 200),
        detail: String(i.detail ?? '').slice(0, 600),
        impact: (i.impact === 'up' || i.impact === 'down' ? i.impact : 'neutral') as RecapItem['impact'],
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const sources = chunks
      .map(c => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? '' }))
      .filter(s => s.uri);

    const body = { month: ym, grounded: true, items, sources, queries };
    cache.set(key, { body, ts: Date.now() });
    return NextResponse.json(body);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({ error: aborted ? 'timeout' : 'fetch_failed' }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
