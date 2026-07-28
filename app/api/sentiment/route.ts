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
  'headline', 'drivers', 'regime_now', 'regime_next', 'macro_note', 'macro_backdrop',
  'outlook_note', 'rotation_note', 'risk_note', 'confidence', 'fear_greed',
  'catalysts',
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

  // Fetch CNN Fear & Greed index (non-fatal — if it fails, omit from the report).
  let fgScore: number | null = null;
  let fgLabel = '';
  try {
    const fgCtrl = new AbortController();
    const fgTimer = setTimeout(() => fgCtrl.abort(), 6000);
    const fgRes = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      signal: fgCtrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(fgTimer);
    if (fgRes.ok) {
      const fgJson = await fgRes.json() as { fear_and_greed?: { score?: number; rating?: string } };
      if (fgJson.fear_and_greed?.score != null) {
        fgScore = Math.round(fgJson.fear_and_greed.score);
        fgLabel = fgJson.fear_and_greed.rating ?? '';
      }
    }
  } catch { /* non-fatal */ }

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

  const fgLine = fgScore != null ? `CNN FEAR & GREED INDEX: ${fgScore}/100 — ${fgLabel}\n` : '';

  const dataBlock =
    `DATE: ${snap.date}\n` +
    (fgLine ? fgLine : '') +
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
    'You MUST do FOUR web searches before writing, and lead with what is ACTUALLY happening in the world today:\n' +
    '  1. Search for "what is moving markets today" / today\'s TOP breaking market-moving news and events RIGHT NOW — geopolitics (wars, sanctions, diplomacy), central-bank actions, economic-data surprises, major political/policy headlines, big corporate news. Identify the 1-3 real events driving the tape today and, for each, WHY it moves markets (the mechanism: e.g. "Iran deal collapse → oil spikes → risk-off"). This is the most important search.\n' +
    '  2. Search for the catalyst behind today\'s biggest daily movers shown in the data below (the names with the largest day % move).\n' +
    '  3. Search for today\'s key macro backdrop: Fed/ECB/BoJ stance, latest inflation print.\n' +
    '  4. Search for "CNN Fear and Greed Index today" and read the CURRENT numeric value (0-100) and its label (Extreme Fear / Fear / Neutral / Greed / Extreme Greed).\n' +
    '  5. Search for UPCOMING CATALYSTS — scheduled or pending events that could move specific markets in the coming weeks/months: legislation and regulation making its way through (e.g. crypto market-structure bills such as the CLARITY Act, tariff decisions, antitrust rulings), central-bank meeting dates and expected decisions, major economic releases, elections, court rulings, ETF/listing approvals, big earnings dates, OPEC meetings, treaty or sanctions deadlines. For each, note WHAT it is, WHEN it is expected, WHICH asset/sector it hits, and WHICH WAY it would push it.\n' +
    'The searches feed different fields — drivers = the real news/events moving markets today, macro_note covers the specific table movers, macro_backdrop covers rates/inflation. Be punchy and specific, always name the actual event, date and source. Never be vague. ' +
    'Distinguish the regime RIGHT NOW from the next ~month. ' +
    'Use one of these exact labels: Risk-On, Risk-Off, Stagflation Risk, Soft Landing, Transition, Reflation, Goldilocks.\n\n' +
    'Output ONLY these key: value lines — one per line, no preamble, no markdown, no bullet characters:\n' +
    'headline: <MAX 12 WORDS. The single biggest move today + the reason.>\n' +
    'drivers: <MAX 55 WORDS. From search #1: the 1-3 REAL news/events actually moving markets TODAY, each as event → market effect with a number, e.g. "Trump says Iran MoU collapsing → Brent +4%, S&P −1.8%; ...". Name the concrete event and today\'s date. This is the most important line — it must explain WHY the tape is moving today, not just describe prices.>\n' +
    'regime_now: <one label>\n' +
    'regime_next: <one label>\n' +
    'macro_note: <MAX 35 WORDS. The 2 biggest daily movers with catalysts from search #1. Numbers required.>\n' +
    'macro_backdrop: <MAX 35 WORDS. From search #2: current Fed/ECB stance + latest inflation reading + key geopolitical risk. Specific, no vague generalities.>\n' +
    'outlook_note: <MAX 25 WORDS. What changes next month given both the rotation and the macro backdrop.>\n' +
    'rotation_note: <MAX 25 WORDS. Where capital is rotating — name the strongest and weakest asset classes today.>\n' +
    classInstr + '\n' +
    'risk_note: <MAX 20 WORDS. Single biggest risk combining market + macro.>\n' +
    'catalysts: <MAX 70 WORDS. From search #5: the 2-4 most important UPCOMING catalysts — things that have not happened yet. ' +
    'Write each as "Asset/sector — event (timing): expected impact", separated by " | ". ' +
    'Example: "Crypto — CLARITY Act Senate vote (Sept): passage would legitimise token listings, bullish exchanges and alts | Gold — FOMC Sept 17 (cut priced 80%): a hold would knock gold" | ' +
    'Prefer dated, verifiable events over vague themes; say if timing is uncertain. If you genuinely find none, write "n/a".>\n' +
    'fear_greed: <From search #3: the CURRENT CNN Fear & Greed Index as "NUMBER — LABEL", e.g. "63 — Greed". Number 0-100 only. If you cannot find it, write "n/a".>\n' +
    'confidence: <Low | Medium | High>';

  const userMessage =
    'Here is the full live table from the dashboard. Read it, search the web for the catalyst behind today\'s biggest moves, then write the brief — strictly within every word limit.\n\n' +
    dataBlock;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  // camelCase payload; Google-Search grounding requires thinking (so no
  // thinkingBudget:0), and we retry without the search tool if the grounded call
  // 400s so sentiment still works.
  const MODEL = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const payload = (withSearch: boolean) => ({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
    // Thinking tokens are drawn from THIS budget before a single word of the brief
    // is written, and five grounded searches think a lot. 3500 left runs finishing
    // at MAX_TOKENS with an empty answer ("Could not read sentiment"), so keep a
    // wide margin — the brief itself is only a few hundred tokens.
    generationConfig: { maxOutputTokens: 8000, temperature: 0.2 },
  });
  const callGemini = (withSearch: boolean) => fetch(url, {
    signal: ctrl.signal,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload(withSearch)),
  });

  try {
    let r = await callGemini(true);
    if (r.status === 400) r = await callGemini(false);

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream', status: r.status, message: body.slice(0, 600) }, { status: 200 });
    }

    type GeminiResp = {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { thoughtsTokenCount?: number; candidatesTokenCount?: number };
    };
    const readText = (j: GeminiResp) => (j.candidates?.[0]?.content?.parts ?? [])
      .filter(part => part.text)
      .map(part => part.text as string)
      .join('\n');

    let json = await r.json() as GeminiResp;
    let text = readText(json);
    let parsed = parseKV(text);

    // Grounded runs spend output budget on thinking before writing, so a heavy
    // search round can stop at MAX_TOKENS with nothing (or half a brief) emitted.
    // Retry once WITHOUT the search tool: far less thinking, so the brief lands —
    // it loses today's live news, but a brief from the table beats an error.
    if (!parsed.regime_now && !parsed.headline) {
      const retry = await callGemini(false);
      if (retry.ok) {
        const j2 = await retry.json() as GeminiResp;
        const t2 = readText(j2);
        const p2 = parseKV(t2);
        if (p2.regime_now || p2.headline) { json = j2; text = t2; parsed = p2; }
      }
    }

    if (!parsed.regime_now && !parsed.headline) {
      return NextResponse.json({
        error: 'unparsed',
        finishReason: json.candidates?.[0]?.finishReason ?? null,
        thinkingTokens: json.usageMetadata?.thoughtsTokenCount ?? null,
        raw: text.slice(0, 500),
      }, { status: 200 });
    }

    // Fear & Greed: prefer the authoritative direct CNN fetch (exact number).
    // When that's unavailable (CNN blocks datacenter IPs), fall back to the value
    // Gemini read from its grounded search #3 ("63 — Greed").
    if (fgScore != null) {
      parsed.fear_greed_score = String(fgScore);
      parsed.fear_greed_label = fgLabel;
    } else if (parsed.fear_greed && parsed.fear_greed.toLowerCase() !== 'n/a') {
      const m = parsed.fear_greed.match(/(\d{1,3})\s*[—–\-]?\s*(.*)/);
      if (m && Number(m[1]) >= 0 && Number(m[1]) <= 100) {
        parsed.fear_greed_score = String(Number(m[1]));
        parsed.fear_greed_label = (m[2] || '').trim();
      }
    }
    delete parsed.fear_greed; // raw line not needed by the UI

    return NextResponse.json({ data: parsed, generatedAt: new Date().toISOString() });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({ error: aborted ? 'timeout' : 'fetch_failed' }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
