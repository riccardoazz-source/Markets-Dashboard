import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
}

interface CompareRequest {
  mode: 'compare';
  assets: { name: string; symbol: string; totalReturn?: number | null; cagr?: number | null }[];
  correlations?: { a: string; b: string; r: number }[];
  timeframe?: string;
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
  let userMessage: string;

  if (body.mode === 'compare') {
    const { assets, correlations, timeframe } = body;
    const assetList = assets.map(a =>
      `${a.name} (${a.symbol}): return ${p(a.totalReturn)}, CAGR ${p(a.cagr)}`
    ).join('\n');

    const corrBlock = correlations && correlations.length
      ? correlations.map(c => `${c.a} ↔ ${c.b}: r = ${c.r.toFixed(2)} (${corrLabel(c.r)})`).join('\n')
      : 'n/a';

    systemInstruction =
      'You are a concise portfolio analyst. Search the web for the latest market context. ' +
      'Write a 4-5 sentence comparative analysis of the assets listed below. Cover: ' +
      '(1) which asset is leading and why based on current market conditions, ' +
      '(2) what the correlation data tells about portfolio diversification, ' +
      '(3) one specific risk or opportunity across the comparison. ' +
      'Be punchy and specific. No markdown, no bullet points — plain prose only.';

    userMessage =
      `Timeframe: ${timeframe ?? 'recent'}\n\n` +
      `ASSETS:\n${assetList}\n\n` +
      `CORRELATIONS:\n${corrBlock}\n\n` +
      `Search the web for the latest context on these assets and write the comparative analysis.`;
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
      `You are a concise market analyst writing a brief for a trader. ` +
      `ALWAYS search the web first to find the latest news, catalysts, and developments for ${name} (${symbol}). ` +
      `Write a 3-4 sentence commentary covering: ` +
      `(1) the key catalyst driving recent price action (from your web search), ` +
      `(2) the current trend using the performance data provided, ` +
      `(3) one specific risk or opportunity to watch. ` +
      `Be punchy, specific, and cite numbers. No markdown, no bullet points — plain prose only.`;

    userMessage =
      `Asset: ${name} (${symbol}) · Class: ${assetClass}\n` +
      `Performance: ${dataBlock}\n\n` +
      `Search the web for the latest news on ${name} and write the commentary.`;
  }

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
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.2,
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
