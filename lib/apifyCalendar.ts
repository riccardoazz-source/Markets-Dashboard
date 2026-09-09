// ── Normalising an Apify economic-calendar dataset ───────────────────────────
//
// Apify solves the problem that stopped us: the scraping happens on THEIR machines, with
// their IPs and their anti-bot handling, and what reaches this app is plain JSON. The
// wall that a datacenter IP hits on investing.com is their side of the fence, not ours.
//
// What arrives, though, is whatever the actor's author decided to call things. There is no
// standard shape for an economic-calendar row, so this reads TOLERANTLY: for each field it
// tries the names actors actually use, in order, and takes the first that is there. A row
// missing a date or a title is dropped rather than rendered half-blank; everything else is
// optional.
//
// Written before seeing a real response — this sandbox's proxy refuses every outbound
// host, Apify included — so `/api/apify-calendar?mode=diag` returns the raw first item and
// its keys. One look at that either confirms these names or says which to add.

export interface ApifyCalendarRow {
  id: string;
  title: string;
  /** Absolute instant, ISO 8601 UTC. */
  date: string;
  timeKnown: boolean;
  country?: string;
  /** As published — "3.1%", "165K". Kept as text: the unit is part of the fact. */
  actual?: string;
  forecast?: string;
  previous?: string;
  /** 1–3, low to high, when the actor grades it. */
  importance?: number;
}

/** First present, non-empty string among the given keys. */
function pick(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * The instant a row refers to.
 *
 * Actors variously emit a full ISO timestamp, a date plus a separate time, or a date
 * alone. A date alone is NOT midnight UTC here: that would put a European morning release
 * on the previous day for anyone west of Greenwich, so it becomes midday, and `timeKnown`
 * says the hour was never published.
 */
export function rowInstant(row: Record<string, unknown>): { date: string; timeKnown: boolean } | null {
  const stamp = pick(row, ['dateUtc', 'dateTime', 'datetime', 'timestamp', 'date']);
  if (!stamp) return null;

  // A full instant, with or without a zone.
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(stamp)) {
    const iso = stamp.replace(' ', 'T');
    const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const ms = Date.parse(withZone);
    if (isFinite(ms)) return { date: new Date(ms).toISOString(), timeKnown: true };
  }

  const day = stamp.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!day) return null;

  const time = pick(row, ['time', 'releaseTime', 'hour']);
  const hm = time?.match(/^(\d{1,2}):(\d{2})/);
  if (hm) {
    const ms = Date.parse(`${day}T${hm[1].padStart(2, '0')}:${hm[2]}:00Z`);
    if (isFinite(ms)) return { date: new Date(ms).toISOString(), timeKnown: true };
  }
  return { date: `${day}T12:00:00.000Z`, timeKnown: false };
}

/** 'high' | '3' | 3 → 3. Anything unrecognised is left undefined rather than guessed at 1. */
export function importanceOf(row: Record<string, unknown>): number | undefined {
  const raw = pick(row, ['importance', 'impact', 'volatility', 'priority']);
  if (!raw) return undefined;
  const n = Number(raw);
  if (isFinite(n) && n >= 1 && n <= 3) return n;
  const word = raw.toLowerCase();
  if (word.includes('high')) return 3;
  if (word.includes('med') || word.includes('mod')) return 2;
  if (word.includes('low')) return 1;
  return undefined;
}

/**
 * One dataset item → one calendar row, or null when it cannot carry a card.
 *
 * `seq` only disambiguates the id: two releases can share a country and an instant, and
 * two cards with the same key would collapse into one on the rail.
 */
export function normalizeRow(item: unknown, seq: number): ApifyCalendarRow | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;

  const title = pick(row, ['event', 'title', 'name', 'eventName', 'indicator']);
  const when = rowInstant(row);
  if (!title || !when) return null;

  const country = pick(row, ['country', 'countryCode', 'zone', 'currency', 'region']);
  return {
    id: `apify-${seq}-${when.date.slice(0, 10)}-${title}`.toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-').slice(0, 90),
    title,
    date: when.date,
    timeKnown: when.timeKnown,
    country,
    actual: pick(row, ['actual', 'actualValue', 'act']),
    forecast: pick(row, ['forecast', 'consensus', 'expected', 'estimate', 'cons']),
    previous: pick(row, ['previous', 'prev', 'previousValue']),
    importance: importanceOf(row),
  };
}

/** Every usable row, most imminent first, de-duplicated by id. */
export function normalizeDataset(items: unknown[]): ApifyCalendarRow[] {
  const seen = new Set<string>();
  const out: ApifyCalendarRow[] = [];
  items.forEach((it, i) => {
    const row = normalizeRow(it, i);
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Countries an economic calendar actually emits, as ISO-ish names or codes → a flag. Only
// what the majors need; anything else falls back to a globe rather than to the wrong flag,
// because a card claiming the wrong country is worse than one claiming none.
const FLAGS: Record<string, string> = {
  US: '🇺🇸', USA: '🇺🇸', 'UNITED STATES': '🇺🇸', USD: '🇺🇸',
  EU: '🇪🇺', EMU: '🇪🇺', 'EURO ZONE': '🇪🇺', EUROZONE: '🇪🇺', EUR: '🇪🇺',
  DE: '🇩🇪', GERMANY: '🇩🇪',
  FR: '🇫🇷', FRANCE: '🇫🇷',
  IT: '🇮🇹', ITALY: '🇮🇹',
  ES: '🇪🇸', SPAIN: '🇪🇸',
  GB: '🇬🇧', UK: '🇬🇧', 'UNITED KINGDOM': '🇬🇧', GBP: '🇬🇧',
  JP: '🇯🇵', JAPAN: '🇯🇵', JPY: '🇯🇵',
  CN: '🇨🇳', CHINA: '🇨🇳', CNY: '🇨🇳',
  CA: '🇨🇦', CANADA: '🇨🇦', CAD: '🇨🇦',
  AU: '🇦🇺', AUSTRALIA: '🇦🇺', AUD: '🇦🇺',
  CH: '🇨🇭', SWITZERLAND: '🇨🇭', CHF: '🇨🇭',
  IN: '🇮🇳', INDIA: '🇮🇳', INR: '🇮🇳',
  BR: '🇧🇷', BRAZIL: '🇧🇷', BRL: '🇧🇷',
  NZ: '🇳🇿', 'NEW ZEALAND': '🇳🇿', NZD: '🇳🇿',
};

export function flagFor(country: string | undefined): string {
  if (!country) return '🌐';
  return FLAGS[country.trim().toUpperCase()] ?? '🌐';
}
