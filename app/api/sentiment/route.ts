import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Daily market sentiment for the Rotation section. Unlike a generic "what's the
// market doing" prompt, this is fed the ACTUAL leaderboard already computed on
// screen (leaders, laggards, the model's accelerating picks, key price levels)
// and asks Claude to combine that with a live web search into a read of:
//   • today's regime, and
//   • the regime it expects over the NEXT month.

interface SnapshotMover { name: string; group: string; r1m: number | null; r3m: number | null; r1y: number | null }
interface Snapshot {
  date: string;
  leaders: SnapshotMover[];
  laggards: SnapshotMover[];
  accelerating: { name: string; group: string }[];
  levels: Record<string, number | null>;
}

const FIELDS = [
  'headline', 'regime_now', 'regime_next', 'macro_note',
  'outlook_note', 'rotation_note', 'risk_note', 'confidence',
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

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_key', message: 'Set ANTHROPIC_API_KEY in the deployment environment to enable sentiment.' },
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

  const dataBlock =
    `DATE: ${snap.date}\n` +
    `LIVE PRICE LEVELS (from the dashboard): ${levelsStr}\n\n` +
    `LEADERS (top by 3-month return, all asset classes):\n` +
    (snap.leaders ?? []).map(m => `  • ${fmtMover(m)}`).join('\n') + '\n\n' +
    `LAGGARDS (weakest by 3-month return):\n` +
    (snap.laggards ?? []).map(m => `  • ${fmtMover(m)}`).join('\n') + '\n\n' +
    `MODEL'S "ACCELERATING / EARLY ROTATION" PICKS (climbing the leaderboard, momentum confirmed, not yet extended):\n` +
    ((snap.accelerating ?? []).length
      ? (snap.accelerating ?? []).map(m => `  • ${m.name} (${m.group})`).join('\n')
      : '  (none flagged today)');

  const system =
    'You are a markets strategist. You are given a real cross-asset leaderboard already computed from live prices, plus the ability to web-search for today\'s macro headlines (rates, inflation prints, central banks, geopolitics, earnings). ' +
    'Synthesize a concise, decision-useful read. Anchor your conclusions to the SUPPLIED DATA — explain what the rotation in the leaderboard implies, and confirm or push back on the model\'s accelerating picks using fresh news. ' +
    'Distinguish the regime RIGHT NOW from the regime you expect over the NEXT MONTH. ' +
    'Use one of these exact regime labels for regime_now and regime_next: Risk-On, Risk-Off, Stagflation Risk, Soft Landing, Transition, Reflation, Goldilocks. ' +
    'Reply with ONLY these key: value lines (no preamble, no markdown, one line each):\n' +
    'headline: <≤12 words, the single most important takeaway>\n' +
    'regime_now: <one label>\n' +
    'regime_next: <one label, the next ~month>\n' +
    'macro_note: <1-2 sentences: what is driving markets today>\n' +
    'outlook_note: <1-2 sentences: what to expect next month and why>\n' +
    'rotation_note: <1-2 sentences: where capital is rotating, referencing the leaders/accelerating data>\n' +
    'risk_note: <1 sentence: the biggest risk to this view>\n' +
    'confidence: <Low | Medium | High>';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      signal: ctrl.signal,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        system,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{
          role: 'user',
          content:
            'Here is the live cross-asset leaderboard from the dashboard. Web-search today\'s macro headlines, then give the sentiment read.\n\n' +
            dataBlock,
        }],
      }),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream', status: r.status, message: body.slice(0, 300) }, { status: 200 });
    }

    const json = await r.json() as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text as string)
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
