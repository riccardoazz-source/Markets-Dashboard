import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Daily market sentiment for the Rotation section. Fed the ENTIRE live table
// the user sees on screen (all asset classes, with today's day-move + rolling
// returns) and asks Gemini + Google Search for a tight daily brief: a regime
// call now and next month, plus one sharp note per asset class — always
// anchored to the biggest DAILY movers, with the catalyst pulled from the web.

interface Mover {
  name: string; group: string;
  dayPct: number | null;
  r1m: number | null; r3m: number | null; r6m: number | null; r1y: number | null;
}
interface Snapshot {
  date: string;
  table: Mover[];                                  // the full on-screen table
  accelerating: { name: string; group: string }[];
  levels: Record<string, number | null>;
}

const CLASS_FIELDS = ['indexes_note', 'crypto_note', 'commodities_note', 'sectors_note', 'stocks_note'];
const FIELDS = [
  'headline', 'regime_now', 'regime_next', 'macro_note', 'macro_backdrop',
  'outlook_note', 'rotation_note', 'risk_note', 'confidence',
  ...CLASS_FIELDS,
];

// Asset-class display order and the exact output key the model must use.
const GROUP_ORDER = ['Indexes', 'Crypto', 'Commodities', 'Sectors', 'Stocks'];
const GROUP_KEY: Record<string, string> = {
  Indexes: 'indexes_note',
  Crypto: 'crypto_note',
  Commodities: 'commodities_note',
  Sectors: 'sectors_note',
  Stocks: 'stocks_note',
};

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

function p(v: number | null): string {
  if (v == null) return 'n/a';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

// One compact table row: name then day / 1M / 3M / 6M / 1Y.
function fmtRow(m: Mover): string {
  return `${m.name}: day ${p(m.dayPct)}, 1M ${p(m.r1m)}, 3M ${p(m.r3m)}, 6M ${p(m.r6m)}, 1Y ${p(m.r1y)}`;
}

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

  const table = snap.table ?? [];

  const levelsStr = Object.entries(snap.levels ?? {})
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'n/a';

  // Today's biggest moves across everything — the headline anchor.
  const withDay = table.filter(m => m.dayPct != null);
  const byDay = [...withDay].sort((a, b) => (b.dayPct ?? 0) - (a.dayPct ?? 0));
  const topUp = byDay.slice(0, 6).map(m => `${m.name} ${p(m.dayPct)}`).join(', ');
  const topDown = [...byDay].reverse().slice(0, 6).map(m => `${m.name} ${p(m.dayPct)}`).join(', ');

  // Full table grouped by asset class, each class sorted by today's move (desc).
  const presentGroups = GROUP_ORDER.filter(g => table.some(m => m.group === g));
  const tableBlock = presentGroups.map(g => {
    const rows = table.filter(m => m.group === g).sort((a, b) => (b.dayPct ?? -Infinity) - (a.dayPct ?? -Infinity));
    return `=== ${g.toUpperCase()} (${rows.length}) ===\n` + rows.map(m => `  ${fmtRow(m)}`).join('\n');
  }).join('\n\n');

  const dataBlock =
    `DATE: ${snap.date}\n` +
    `KEY PRICE LEVELS: ${levelsStr}\n\n` +
    `TODAY'S BIGGEST MOVES (anchor the headline + macro_note here FIRST):\n` +
    `  UP:   ${topUp || 'n/a'}\n` +
    `  DOWN: ${topDown || 'n/a'}\n\n` +
    `MODEL'S ACCELERATING PICKS (climbing the leaderboard, not yet extended):\n` +
    (snap.accelerating?.length
      ? snap.accelerating.map(m => `  • ${m.name} (${m.group})`).join('\n')
      : '  (none flagged today)') + '\n\n' +
    `FULL TABLE — every asset on screen, grouped by class, sorted by today's move:\n` +
    tableBlock;

  // Per-class note instructions, only for classes actually present.
  const classInstr = presentGroups
    .map(g => {
      const key = GROUP_KEY[g];
      return `${key}: <MAX 25 WORDS. Lead with ${g}'s biggest mover TODAY (name + day %), then its 3M leader. One sharp sentence.>`;
    })
    .join('\n');

  const systemInstruction =
    'You are a markets desk analyst writing a DAILY BRIEF from a live table you have been given. Style: Bloomberg terminal flash, not a research essay. ' +
    'READ THE FULL TABLE BELOW — it is exactly what the user sees on screen. Every field has a strict WORD LIMIT you must never exceed. ' +
    'Always name specific assets and exact numbers FROM THE TABLE. ' +
    'You MUST do TWO web searches before writing:\n' +
    '  1. Search for the catalyst behind today\'s biggest daily movers (e.g. why KOSPI dropped 10%).\n' +
    '  2. Search for today\'s key macro backdrop: Fed/ECB/BoJ stance, latest inflation print, and the most important geopolitical development.\n' +
    'Both searches feed different fields — macro_note covers the daily moves, macro_backdrop covers rates/inflation/geopolitics. Be punchy and specific, never vague. ' +
    'Distinguish the regime RIGHT NOW from the next ~month. ' +
    'Use one of these exact labels: Risk-On, Risk-Off, Stagflation Risk, Soft Landing, Transition, Reflation, Goldilocks.\n\n' +
    'Output ONLY these key: value lines — one per line, no preamble, no markdown, no bullet characters:\n' +
    'headline: <MAX 12 WORDS. The single biggest move today + the reason.>\n' +
    'regime_now: <one label>\n' +
    'regime_next: <one label>\n' +
    'macro_note: <MAX 35 WORDS. The 2 biggest daily movers with catalysts from search #1. Numbers required.>\n' +
    'macro_backdrop: <MAX 35 WORDS. From search #2: current Fed/ECB stance + latest inflation reading + key geopolitical risk. Specific, no vague generalities.>\n' +
    'outlook_note: <MAX 25 WORDS. What changes next month given both the rotation and the macro backdrop.>\n' +
    'rotation_note: <MAX 25 WORDS. Where capital is rotating — name the strongest and weakest asset classes today.>\n' +
    classInstr + '\n' +
    'risk_note: <MAX 20 WORDS. Single biggest risk combining market + macro.>\n' +
    'confidence: <Low | Medium | High>';

  const userMessage =
    'Here is the full live table from the dashboard. Read it, search the web for the catalyst behind today\'s biggest moves, then write the brief — strictly within every word limit.\n\n' +
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
          maxOutputTokens: 1200,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream', status: r.status, message: body.slice(0, 300) }, { status: 200 });
    }

    const json = await r.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .filter(part => part.text)
      .map(part => part.text as string)
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
