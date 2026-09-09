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
  /** ISO currency of the release — the fallback identity when the country is unknown. */
  currency?: string;
  /**
   * As published — "3.1%", "165K". Kept as text: the unit is part of the fact.
   *
   * `actual` is the field to distrust. The crawl runs on a schedule, so a release that
   * happened after the last run still shows an empty actual — on a WEEKLY schedule that is
   * most of the week. The app has its own live series for the numbers it charts, so the
   * card reads `actual` from there and takes only the forward-looking fields from here.
   */
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
 * Which way round a slashed date is written.
 *
 * The real dataset emits "09/09/2026", which is ambiguous on its own — and guessing wrong
 * silently moves half the calendar by up to eleven days, in a way nobody notices until a
 * release lands on the wrong week. So it is INFERRED from the dataset rather than assumed:
 * over a month of rows, some day is above the twelfth, and that one row settles the order
 * for all of them.
 *
 * Only when no row disambiguates does it fall back, to MM/DD — the order investing.com
 * writes in English, which is where this data comes from.
 */
export type DateOrder = 'MDY' | 'DMY';

export function inferDateOrder(items: unknown[]): DateOrder {
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const raw = (it as Record<string, unknown>).date;
    const m = typeof raw === 'string' ? raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/) : null;
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12) return 'DMY';   // the first field cannot be a month
    if (b > 12) return 'MDY';   // the second field cannot be a month
  }
  return 'MDY';
}

/**
 * The instant a row refers to.
 *
 * Actors variously emit a full ISO timestamp, a slashed date, or a date plus a separate
 * time. A date alone is NOT midnight UTC here: that would put a European morning release
 * on the previous day for anyone west of Greenwich, so it becomes midday, and `timeKnown`
 * says the hour was never published.
 *
 * `tzOffsetMinutes` shifts a wall-clock time into UTC. The feed publishes times in
 * whatever zone the scraper was reading in, which nothing in the row records — so it is a
 * setting rather than a guess, and it defaults to zero (times taken as UTC).
 */
export function rowInstant(
  row: Record<string, unknown>, order: DateOrder = 'MDY', tzOffsetMinutes = 0,
): { date: string; timeKnown: boolean } | null {
  const stamp = pick(row, ['dateUtc', 'dateTime', 'datetime', 'timestamp', 'date']);
  if (!stamp) return null;

  // A full instant, with or without a zone.
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(stamp)) {
    const iso = stamp.replace(' ', 'T');
    const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const ms = Date.parse(withZone);
    if (isFinite(ms)) return { date: new Date(ms).toISOString(), timeKnown: true };
  }

  let day = stamp.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (!day) {
    // "09/09/2026" — the shape the real feed uses, and the one the first version of this
    // rejected outright, which would have dropped every single row.
    const m = stamp.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (!m) return null;
    const [mm, dd] = order === 'DMY' ? [m[2], m[1]] : [m[1], m[2]];
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
    day = `${m[3]}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  const time = pick(row, ['time', 'releaseTime', 'hour']);
  const hm = time?.match(/^(\d{1,2}):(\d{2})/);
  if (hm) {
    const ms = Date.parse(`${day}T${hm[1].padStart(2, '0')}:${hm[2]}:00Z`);
    if (isFinite(ms)) {
      return { date: new Date(ms - tzOffsetMinutes * 60_000).toISOString(), timeKnown: true };
    }
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
export function normalizeRow(
  item: unknown, seq: number, order: DateOrder = 'MDY', tzOffsetMinutes = 0,
): ApifyCalendarRow | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;

  // The real feed writes "Car Sales (YoY)  (Aug)" — two spaces, scraped from a table cell
  // where the layout supplied the gap. Collapsed here, because the card renders text.
  const title = pick(row, ['event', 'title', 'name', 'eventName', 'indicator'])
    ?.replace(/\s+/g, ' ').trim();
  const when = rowInstant(row, order, tzOffsetMinutes);
  if (!title || !when) return null;

  // `zone` is where the real feed puts it ("indonesia", "china"), and `currency` is the
  // reliable fallback: a row without a country still has IDR or CNY on it.
  const country = pick(row, ['country', 'countryCode', 'zone', 'region']);
  const currency = pick(row, ['currency']);
  return {
    id: `apify-${seq}-${when.date.slice(0, 10)}-${title}`.toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-').slice(0, 90),
    title,
    currency,
    date: when.date,
    timeKnown: when.timeKnown,
    country,
    actual: pick(row, ['actual', 'actualValue', 'act']),
    forecast: pick(row, ['forecast', 'consensus', 'expected', 'estimate', 'cons']),
    previous: pick(row, ['previous', 'prev', 'previousValue']),
    importance: importanceOf(row),
  };
}

export interface NormalizeOptions {
  /** Drop anything the source grades below this. 2 = medium and high. */
  minImportance?: number;
  /** Minutes to subtract from a wall-clock time to reach UTC. */
  tzOffsetMinutes?: number;
  /** Keep only these countries/currencies, matched case-insensitively. Empty = keep all. */
  only?: string[];
}

/**
 * Every usable row, most imminent first, de-duplicated.
 *
 * FILTERED, and that is not a detail. This feed is the whole world: the first three rows
 * of the real dataset were Indonesian car sales, Indonesian motorbike sales and Chinese
 * CPI. Unfiltered it would bury an FOMC decision under a hundred things nobody on this
 * dashboard is looking at. The default keeps medium and high importance only — the source
 * already grades every row, so this is its judgement, not ours.
 */
export function normalizeDataset(items: unknown[], opts: NormalizeOptions = {}): ApifyCalendarRow[] {
  const { minImportance = 2, tzOffsetMinutes = 0, only = [] } = opts;
  const order = inferDateOrder(items);
  const keep = new Set(only.map(o => o.trim().toUpperCase()).filter(Boolean));
  const seen = new Set<string>();
  const out: ApifyCalendarRow[] = [];
  items.forEach((it, i) => {
    const row = normalizeRow(it, i, order, tzOffsetMinutes);
    if (!row || seen.has(row.id)) return;
    // An UNGRADED row is kept: the source declining to rate something is not the same as
    // rating it low, and dropping it would silently lose anything the actor left blank.
    if (row.importance != null && row.importance < minImportance) return;
    if (keep.size > 0) {
      const c = (row.country ?? '').toUpperCase();
      const cur = (row.currency ?? '').toUpperCase();
      if (!keep.has(c) && !keep.has(cur)) return;
    }
    seen.add(row.id);
    out.push(row);
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Countries an economic calendar actually emits → a flag.
//
// The real feed writes `zone` as a lowercase country NAME ("indonesia", "china"), not a
// code — which the first version of this did not handle, so every card would have got a
// globe. Names and codes and currencies all resolve through one map, upper-cased on the
// way in.
//
// Anything unlisted falls back to a globe rather than to a plausible-looking guess: a card
// flying the wrong country's flag misinforms, one flying none merely says less.
const FLAGS: Record<string, string> = {
  // North America
  US: '🇺🇸', USA: '🇺🇸', 'UNITED STATES': '🇺🇸', USD: '🇺🇸',
  CA: '🇨🇦', CANADA: '🇨🇦', CAD: '🇨🇦',
  MX: '🇲🇽', MEXICO: '🇲🇽', MXN: '🇲🇽',
  // Europe
  EU: '🇪🇺', EMU: '🇪🇺', 'EURO ZONE': '🇪🇺', EUROZONE: '🇪🇺', 'EURO AREA': '🇪🇺', EUR: '🇪🇺',
  DE: '🇩🇪', GERMANY: '🇩🇪',
  FR: '🇫🇷', FRANCE: '🇫🇷',
  IT: '🇮🇹', ITALY: '🇮🇹',
  ES: '🇪🇸', SPAIN: '🇪🇸',
  NL: '🇳🇱', NETHERLANDS: '🇳🇱',
  BE: '🇧🇪', BELGIUM: '🇧🇪',
  AT: '🇦🇹', AUSTRIA: '🇦🇹',
  PT: '🇵🇹', PORTUGAL: '🇵🇹',
  IE: '🇮🇪', IRELAND: '🇮🇪',
  GR: '🇬🇷', GREECE: '🇬🇷',
  GB: '🇬🇧', UK: '🇬🇧', 'UNITED KINGDOM': '🇬🇧', 'GREAT BRITAIN': '🇬🇧', GBP: '🇬🇧',
  CH: '🇨🇭', SWITZERLAND: '🇨🇭', CHF: '🇨🇭',
  SE: '🇸🇪', SWEDEN: '🇸🇪', SEK: '🇸🇪',
  NO: '🇳🇴', NORWAY: '🇳🇴', NOK: '🇳🇴',
  DK: '🇩🇰', DENMARK: '🇩🇰', DKK: '🇩🇰',
  FI: '🇫🇮', FINLAND: '🇫🇮',
  PL: '🇵🇱', POLAND: '🇵🇱', PLN: '🇵🇱',
  CZ: '🇨🇿', 'CZECH REPUBLIC': '🇨🇿', CZK: '🇨🇿',
  HU: '🇭🇺', HUNGARY: '🇭🇺', HUF: '🇭🇺',
  RU: '🇷🇺', RUSSIA: '🇷🇺', RUB: '🇷🇺',
  TR: '🇹🇷', TURKEY: '🇹🇷', TRY: '🇹🇷',
  UA: '🇺🇦', UKRAINE: '🇺🇦',
  // Asia-Pacific
  JP: '🇯🇵', JAPAN: '🇯🇵', JPY: '🇯🇵',
  CN: '🇨🇳', CHINA: '🇨🇳', CNY: '🇨🇳',
  HK: '🇭🇰', 'HONG KONG': '🇭🇰', HKD: '🇭🇰',
  KR: '🇰🇷', 'SOUTH KOREA': '🇰🇷', KOREA: '🇰🇷', KRW: '🇰🇷',
  IN: '🇮🇳', INDIA: '🇮🇳', INR: '🇮🇳',
  ID: '🇮🇩', INDONESIA: '🇮🇩', IDR: '🇮🇩',
  SG: '🇸🇬', SINGAPORE: '🇸🇬', SGD: '🇸🇬',
  MY: '🇲🇾', MALAYSIA: '🇲🇾', MYR: '🇲🇾',
  TH: '🇹🇭', THAILAND: '🇹🇭', THB: '🇹🇭',
  PH: '🇵🇭', PHILIPPINES: '🇵🇭', PHP: '🇵🇭',
  VN: '🇻🇳', VIETNAM: '🇻🇳', VND: '🇻🇳',
  TW: '🇹🇼', TAIWAN: '🇹🇼', TWD: '🇹🇼',
  AU: '🇦🇺', AUSTRALIA: '🇦🇺', AUD: '🇦🇺',
  NZ: '🇳🇿', 'NEW ZEALAND': '🇳🇿', NZD: '🇳🇿',
  // Latin America, Middle East, Africa
  BR: '🇧🇷', BRAZIL: '🇧🇷', BRL: '🇧🇷',
  AR: '🇦🇷', ARGENTINA: '🇦🇷', ARS: '🇦🇷',
  CL: '🇨🇱', CHILE: '🇨🇱', CLP: '🇨🇱',
  CO: '🇨🇴', COLOMBIA: '🇨🇴', COP: '🇨🇴',
  ZA: '🇿🇦', 'SOUTH AFRICA': '🇿🇦', ZAR: '🇿🇦',
  IL: '🇮🇱', ISRAEL: '🇮🇱', ILS: '🇮🇱',
  SA: '🇸🇦', 'SAUDI ARABIA': '🇸🇦', SAR: '🇸🇦',
  AE: '🇦🇪', 'UNITED ARAB EMIRATES': '🇦🇪', AED: '🇦🇪',
};

/** The flag for a country name, an ISO code or a currency — a globe when unknown. */
export function flagFor(country: string | undefined, currency?: string): string {
  for (const k of [country, currency]) {
    const hit = k ? FLAGS[k.trim().toUpperCase()] : undefined;
    if (hit) return hit;
  }
  return '🌐';
}
