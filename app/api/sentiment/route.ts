import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Daily market sentiment for the Rotation section. Fed the ACTUAL leaderboard
// already computed on screen — globally AND broken down per asset class
// (Indexes, Crypto, Commodities, Sectors, Stocks) — and asks Gemini + Google
// Search for a regime call now and over the next month, plus a macro read on
// each asset class present.

interface SnapshotMover { name: string; group: string; r1m: number | null; r3m: number | null; r1y: number | null }
interface SnapshotGroup {
  group: string;
  leaders: SnapshotMover[];
  laggards: SnapshotMover[];
  accelerating: string[];
}
interface Snapshot {
  date: string;
  leaders: SnapshotMover[];
  laggards: SnapshotMover[];
  accelerating: { name: string; group: string }[];
  byGroup?: SnapshotGroup[];
  levels: Record<string, number | null>;
}

// Per-asset-class note keys, in display order. Only emitted for classes present.
const CLASS_FIELDS = ['indexes_note', 'crypto_note', 'commodities_note', 'sectors_note', 'stocks_note'];

const FIELDS = [
  'headline', 'regime_now', 'regime_next', 'macro_note',
  'outlook_note', 'rotation_note', 'risk_note', 'confidence',
  ...CLASS_FIELDS,
];

function parseKV(txt: string): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let line of txt.split('\n')) {
    line = line.replace(/\*\*/g, '').trim();
    const i = line.indexOf(': ');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 2).trim();
      if (FIELDS.includes(k)) obj[k] = v;
    }
  }
  return obj;
}

function fmtMover(m: SnapshotMover): string {
  const p = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  return `${m.name} (${m.group}): 1M ${p(m.r1m)}, 3M ${p(m.r3m)}, 1Y ${p(m.r1y)}`;
}

// Map group name → the exact output key the model must use.
const GROUP_KEY: Record<string, string> = {
  Indexes: 'indexes_note',
  Crypto: 'crypto_note',
  Commodities: 'commodities_note',
  Sectors: 'sectors_note',
  Stocks: 'stocks_note',
};

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_key', message: 'Set GEMINI_API_KEY in the deployment environment to enable sentiment.' },
      { status: 200 },
    );
  }

  let snap: Snapshot;
  try {
    snap = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const levelsStr = Object.entries(snap.levels ?? {})
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'n/a';

  // Per-asset-class breakdown so the model can comment on each one specifically.
  const groups = (snap.byGroup ?? []).filter(g => g.leaders.length || g.laggards.length);
  const groupBlock = groups.length
    ? groups.map(g =>
        `=== ${g.group.toUpperCase()} ===\n` +
        `  Strongest: ${g.leaders.length ? g.leaders.map(m => fmtMover(m)).join(' | ') : 'n/a'}\n` +
        `  Weakest:   ${g.laggards.length ? g.laggards.map(m => fmtMover(m)).join(' | ') : 'n/a'}\n` +
        `  Accelerating: ${g.accelerating.length ? g.accelerating.join(', ') : 'none'}`
      ).join('\n\n')
    : 'n/a';

  const dataBlock =
    `DATE: ${snap.date}\n` +
    `LIVE PRICE LEVELS (from the dashboard): ${levelsStr}\n\n` +
    `CROSS-ASSET LEADERS (top by 3-month return):\n` +
    (snap.leaders ?? []).map(m => `  • ${fmtMover(m)}`).join('\n') + '\n\n' +
    `CROSS-ASSET LAGGARDS (weakest by 3-month return):\n` +
    (snap.laggards ?? []).map(m => `  • ${fmtMover(m)}`).join('\n') + '\n\n' +
    `MODEL'S "ACCELERATING / EARLY ROTATION" PICKS (climbing the leaderboard, momentum confirmed, not yet extended):\n` +
    ((snap.accelerating ?? []).length
      ? (snap.accelerating ?? []).map(m => `  • ${m.name} (${m.group})`).join('\n')
      : '  (none flagged today)') + '\n\n' +
    `PER-ASSET-CLASS BREAKDOWN:\n` + groupBlock;

  // Only require class notes for the classes actually present in the data.
  const presentClassLines = groups
    .map(g => GROUP_KEY[g.group])
    .filter((k): k is string => !!k);
  const classInstr = presentClassLines.length
    ? presentClassLines.map(k =>
        `${k}: <1-2 sentences on the ${k.replace('_note', '')} asset class: what's leading/lagging and the macro read>`
      ).join('\n')
    : '';

  const systemInstruction =
    'You are a markets strategist. You are given a real cross-asset leaderboard already computed from live prices, broken down per asset class. ' +
    'Use Google Search to find today\'s macro headlines (rates, inflation prints, central banks, geopolitics, earnings). ' +
    'Synthesize a concise, decision-useful read. Anchor your conclusions to the SUPPLIED DATA — explain what the rotation in each asset class implies, and confirm or push back on the model\'s accelerating picks using fresh news. ' +
    'Distinguish the regime RIGHT NOW from the regime you expect over the NEXT MONTH. ' +
    'Use one of these exact regime labels for regime_now and regime_next: Risk-On, Risk-Off, Stagflation Risk, Soft Landing, Transition, Reflation, Goldilocks. ' +
    'Reply with ONLY these key: value lines (no preamble, no markdown, one line each):\n' +
    'headline: <≤12 words, the single most important takeaway>\n' +
    'regime_now: <one label>\n' +
    'regime_next: <one label, the next ~month>\n' +
    'macro_note: <1-2 sentences: what is driving markets today>\n' +
    'outlook_note: <1-2 sentences: what to expect next month and why>\n' +
    'rotation_note: <1-2 sentences: the big-picture cross-asset rotation>\n' +
    (classInstr ? classInstr + '\n' : '') +
    'risk_note: <1 sentence: the biggest risk to this view>\n' +
    'confidence: <Low | Medium | High>';

  const userMessage =
    'Here is the live cross-asset leaderboard from the dashboard. Search today\'s macro headlines, then give the sentiment read with a note on each asset class present.\n\n' +
    dataBlock;

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
          maxOutputTokens: 2048,
          temperature: 0.4,
          // gemini-2.5-flash "thinks" by default — slow, and the reasoning eats
          // the output budget so the per-class notes get truncated. Turn it off.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream', status: r.status, message: body.slice(0, 300) }, { status: 200 });
    }

    const json = await r.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .filter(p => p.text)
      .map(p => p.text as string)
      .join('\n');

    const parsed = parseKV(text);
    if (!parsed.regime_now && !parsed.headline) {
      return NextResponse.json({ error: 'unparsed', raw: text.slice(0, 500) }, { status: 200 });
    }

    return NextResponse.json({ data: parsed, generatedAt: new Date().toISOString() });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({ error: aborted ? 'timeout' : 'fetch_failed' }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
