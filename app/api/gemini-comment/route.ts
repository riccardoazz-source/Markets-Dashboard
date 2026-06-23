import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Turn { role: 'user' | 'model'; text: string }

interface SingleAssetRequest {
  mode?: 'single';
  name: string;
  symbol: string;
  assetClass: string;
  price?: number | null;
  dayPct?: number | null;
  r1m?: number | null;
  r3m?: number | null;
  r6m?: number | null;
  r1y?: number | null;
  messages?: Turn[];
}

interface CompareRequest {
  mode: 'compare';
  assets: { name: string; symbol: string; totalReturn?: number | null; cagr?: number | null }[];
  correlations?: { a: string; b: string; r: number }[];
  timeframe?: string;
  messages?: Turn[];
}

type CommentRequest = SingleAssetRequest | CompareRequest;

function p(v: number | null | undefined): string {
  if (v == null) return 'n/a';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function corrLabel(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.9) return r >= 0 ? 'very strong positive' : 'very strong negative';
  if (a >= 0.7) return r >= 0 ? 'strong positive' : 'strong negative';
  if (a >= 0.5) return r >= 0 ? 'moderate positive' : 'moderate negative';
  if (a >= 0.3) return r >= 0 ? 'weak positive' : 'weak negative';
  return 'near-zero';
}

// First (synthetic) user turn so the conversation always starts with a 'user'
// role for Gemini, and the model opens with its initial commentary.
const INITIAL_PROMPT = 'Give me your initial take, grounded in the latest news from your web search.';

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_key', message: 'GEMINI_API_KEY not configured in the deployment environment.' },
      { status: 200 },
    );
  }

  let body: CommentRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  let systemInstruction: string;

  if (body.mode === 'compare') {
    const { assets, correlations, timeframe } = body;
    const assetList = assets.map(a =>
      `${a.name} (${a.symbol}): return ${p(a.totalReturn)}, CAGR ${p(a.cagr)}`
    ).join('\n');
    const corrBlock = correlations && correlations.length
      ? correlations.map(c => `${c.a} ↔ ${c.b}: r = ${c.r.toFixed(2)} (${corrLabel(c.r)})`).join('\n')
      : 'n/a';

    systemInstruction =
      'You are a portfolio analyst in an ongoing chat with a trader. You are discussing ONLY the comparison of the assets below — ' +
      'their relative performance, correlation, and how they fit together in a portfolio. ' +
      'Stay strictly on this comparison: if the user asks about anything unrelated, briefly answer in the context of these assets or steer back. ' +
      'Use web search whenever current market facts would help. Cite specific numbers. Keep every reply concise (max ~130 words), plain prose, no markdown.\n\n' +
      `TIMEFRAME: ${timeframe ?? 'recent'}\n\n` +
      `ASSETS UNDER COMPARISON:\n${assetList}\n\n` +
      `CORRELATIONS:\n${corrBlock}\n\n` +
      'For your FIRST reply: give a 4-5 sentence comparative analysis — which asset leads and why, what the correlations mean for diversification, and one risk or opportunity. ' +
      'For LATER replies: answer the user\'s specific follow-up about these assets.';
  } else {
    const { name, symbol, assetClass, price, dayPct, r1m, r3m, r6m, r1y } = body as SingleAssetRequest;
    const dataBlock = [
      price != null ? `Price: ${price.toLocaleString()}` : null,
      `Day: ${p(dayPct)}`,
      r1m != null ? `1M: ${p(r1m)}` : null,
      r3m != null ? `3M: ${p(r3m)}` : null,
      r6m != null ? `6M: ${p(r6m)}` : null,
      r1y != null ? `1Y: ${p(r1y)}` : null,
    ].filter(Boolean).join(' · ');

    systemInstruction =
      `You are a market analyst in an ongoing chat with a trader. You are discussing ONLY ${name} (${symbol}), asset class ${assetClass}. ` +
      'Stay strictly on this asset: if the user asks about anything unrelated, briefly answer in the context of this asset or steer back to it. ' +
      `ALWAYS use web search when current news, catalysts or facts about ${name} would help. Cite specific numbers. ` +
      'Keep every reply concise (max ~130 words), plain prose, no markdown.\n\n' +
      `ASSET: ${name} (${symbol}) · Class: ${assetClass}\n` +
      `PERFORMANCE: ${dataBlock}\n\n` +
      `For your FIRST reply: give a 3-4 sentence commentary — the key catalyst driving recent action (from web search), the current trend from the data, and one risk or opportunity. ` +
      'For LATER replies: answer the user\'s specific follow-up about this asset.';
  }

  const history = (body.messages ?? []).filter(m => m && m.text);
  const contents = [
    { role: 'user', parts: [{ text: INITIAL_PROMPT }] },
    ...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
  ];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      signal: ctrl.signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ google_search: {} }],
        generationConfig: {
          maxOutputTokens: 600,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream', status: r.status, message: txt.slice(0, 300) }, { status: 200 });
    }

    const json = await r.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .filter(part => part.text)
      .map(part => part.text as string)
      .join('\n')
      .trim();

    if (!text) {
      return NextResponse.json({ error: 'empty_response', message: 'Gemini returned no text.' }, { status: 200 });
    }

    return NextResponse.json({ comment: text });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({ error: aborted ? 'timeout' : 'fetch_failed' }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
