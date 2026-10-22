// ── Government bond yields outside the US ────────────────────────────────────
//
// The US section reads the Treasury's own daily file. No other issuer publishes one this
// app can use the same way, so these come from DBnomics, which mirrors FRED, the ECB and
// the OECD, needs no key, and is already proven in this codebase (/api/macro has used it
// as FRED's fallback for a long time).
//
// TWO THINGS ARE DELIBERATELY NOT HIDDEN:
//
//   FREQUENCY  the euro-area curve is DAILY, the per-country benchmarks are MONTHLY
//              (OECD long-term rates). A monthly series drawn without saying so looks
//              like a daily one that stopped updating, and the reader cannot tell a
//              stale feed from a slow one. Every tenor carries its frequency.
//   PROVENANCE each tenor lists several candidate series. The first that answers wins
//              and diag names it. Written against keys that could not be checked from
//              the machine that wrote them, so a key that has moved costs one tenor
//              rather than the country.
//
// There are no individual securities here. For gilts and JGBs real per-issue prices do
// exist free (the UK DMO and the JSDA publish them), which is a different build; nothing
// here pretends to it.

export const GOVT_PREFIX = 'GOVT:';

export type Freq = 'daily' | 'monthly';

export interface GovtTenor {
  /** Shown on the tile. */
  label: string;
  /** Years to maturity, for ordering and for the spread pairing. */
  years: number;
  /** DBnomics series paths, tried in order. provider/dataset/series. */
  sources: string[];
  freq: Freq;
}

export interface GovtCountry {
  code: string;
  name: string;
  flag: string;
  /** Which country this one's spread is quoted against, if any. */
  spreadVs?: string;
  tenors: GovtTenor[];
}

/** The euro-area AAA spot curve, published daily by the ECB. */
const ecbYc = (tenor: string) => `ECB/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_${tenor}`;

/** OECD long-term (10-year) government bond rate, monthly, mirrored on FRED. */
const oecd10y = (cc: string) => `FRED/IRLTLT01${cc}M156N`;

const EUR_CURVE: GovtTenor[] = [
  { label: '3M',  years: 0.25, sources: [ecbYc('3M')],  freq: 'daily' },
  { label: '6M',  years: 0.5,  sources: [ecbYc('6M')],  freq: 'daily' },
  { label: '1Y',  years: 1,    sources: [ecbYc('1Y')],  freq: 'daily' },
  { label: '2Y',  years: 2,    sources: [ecbYc('2Y')],  freq: 'daily' },
  { label: '3Y',  years: 3,    sources: [ecbYc('3Y')],  freq: 'daily' },
  { label: '5Y',  years: 5,    sources: [ecbYc('5Y')],  freq: 'daily' },
  { label: '7Y',  years: 7,    sources: [ecbYc('7Y')],  freq: 'daily' },
  { label: '10Y', years: 10,   sources: [ecbYc('10Y')], freq: 'daily' },
  { label: '15Y', years: 15,   sources: [ecbYc('15Y')], freq: 'daily' },
  { label: '20Y', years: 20,   sources: [ecbYc('20Y')], freq: 'daily' },
  { label: '30Y', years: 30,   sources: [ecbYc('30Y')], freq: 'daily' },
];

/** One benchmark per country. OECD publishes the 10-year and nothing shorter. */
const bench10y = (cc: string): GovtTenor[] => [
  { label: '10Y', years: 10, sources: [oecd10y(cc)], freq: 'monthly' },
];

export const GOVT_COUNTRIES: GovtCountry[] = [
  { code: 'EMU', name: 'Euro area (AAA)', flag: '🇪🇺', tenors: EUR_CURVE },
  { code: 'DE',  name: 'Germany', flag: '🇩🇪', tenors: bench10y('DE') },
  { code: 'IT',  name: 'Italy',   flag: '🇮🇹', spreadVs: 'DE', tenors: bench10y('IT') },
  { code: 'FR',  name: 'France',  flag: '🇫🇷', spreadVs: 'DE', tenors: bench10y('FR') },
  { code: 'ES',  name: 'Spain',   flag: '🇪🇸', spreadVs: 'DE', tenors: bench10y('ES') },
  { code: 'GB',  name: 'UK',      flag: '🇬🇧', tenors: bench10y('GB') },
  { code: 'JP',  name: 'Japan',   flag: '🇯🇵', tenors: bench10y('JP') },
  { code: 'CA',  name: 'Canada',  flag: '🇨🇦', tenors: bench10y('CA') },
];

export const findCountry = (code: string): GovtCountry | null =>
  GOVT_COUNTRIES.find(c => c.code === code) ?? null;

export function findTenor(code: string, label: string): { country: GovtCountry; tenor: GovtTenor } | null {
  const country = findCountry(code);
  const tenor = country?.tenors.find(t => t.label === label);
  return country && tenor ? { country, tenor } : null;
}

// ── Symbols ──────────────────────────────────────────────────────────────────
//
// Same idea as the US side: a yield gets a symbol the shared endpoints understand, so it
// opens the standard panel instead of a bespoke one.

export const govtSymbol = (code: string, tenor: string) => `${GOVT_PREFIX}${code}:${tenor}`;

export const isGovtSymbol = (s: string): boolean =>
  typeof s === 'string' && s.startsWith(GOVT_PREFIX);

export function parseGovtSymbol(symbol: string): { country: GovtCountry; tenor: GovtTenor } | null {
  if (!isGovtSymbol(symbol)) return null;
  const rest = symbol.slice(GOVT_PREFIX.length);
  const i = rest.indexOf(':');
  if (i < 0) return null;
  return findTenor(rest.slice(0, i), rest.slice(i + 1));
}

export const govtDisplayName = (country: GovtCountry, tenor: GovtTenor) =>
  `${country.name} ${tenor.label} government bond yield`;

// ── Spreads ──────────────────────────────────────────────────────────────────

export interface YieldPoint { date: string; close: number }

/**
 * The difference between two yield series, in percentage points, on the dates BOTH have.
 *
 * Inner join, not a carry-forward: pairing a date in one series with the nearest date in
 * the other would invent a spread on days one of them never published, and the BTP–Bund
 * spread is read to the basis point. A day missing from either side is simply not a day
 * the spread is known for.
 */
export function spread(a: YieldPoint[], b: YieldPoint[]): YieldPoint[] {
  const byDate = new Map(b.map(p => [p.date, p.close]));
  const out: YieldPoint[] = [];
  for (const p of a) {
    const other = byDate.get(p.date);
    if (other === undefined || !isFinite(other) || !isFinite(p.close)) continue;
    out.push({ date: p.date, close: p.close - other });
  }
  return out;
}

/** Percentage points to basis points, which is how a spread is actually quoted. */
export const toBps = (pct: number): number => pct * 100;

// ── Reading DBnomics ─────────────────────────────────────────────────────────

/**
 * Pull `{period, value}` arrays out of a DBnomics series document.
 *
 * Nulls are dropped rather than zeroed. DBnomics marks a missing observation as null, and
 * a zero yield is a real and very different statement from an unpublished one — the Bund
 * genuinely traded near zero for years, so a null read as 0 would be invisible.
 */
export function parseDbnomics(json: unknown): YieldPoint[] {
  const docs = (json as { series?: { docs?: Array<{ period?: unknown; value?: unknown }> } })
    ?.series?.docs;
  const doc = Array.isArray(docs) ? docs[0] : undefined;
  const periods = Array.isArray(doc?.period) ? doc!.period as unknown[] : [];
  const values = Array.isArray(doc?.value) ? doc!.value as unknown[] : [];
  const out: YieldPoint[] = [];
  for (let i = 0; i < Math.min(periods.length, values.length); i++) {
    const date = normalizePeriod(String(periods[i] ?? ''));
    const raw = values[i];
    if (!date || raw === null || raw === undefined || raw === '') continue;
    const v = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!isFinite(v)) continue;
    out.push({ date, close: v });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * DBnomics periods come as `2026-10-22` for daily and `2026-10` for monthly. A monthly
 * one is anchored to the FIRST of the month, matching how this app already dates every
 * other monthly series, so a chart mixing the two does not put October's print after
 * November's.
 */
export function normalizePeriod(p: string): string | null {
  const s = p.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return null;
}

/** The DBnomics URL forms for one series path, in the order worth trying. */
export function dbnomicsUrls(path: string): string[] {
  const parts = path.split('/');
  if (parts.length < 2) return [];
  const provider = parts[0];
  const dataset = parts[1];
  const series = parts.slice(2).join('/');
  const enc = encodeURIComponent;
  if (!series) {
    // FRED-style, where the dataset IS the series id.
    return [
      `https://api.db.nomics.world/v22/series/${enc(provider)}/${enc(dataset)}/${enc(dataset)}?observations=1`,
      `https://api.db.nomics.world/v22/series/${enc(provider)}/${enc(dataset)}?observations=1`,
    ];
  }
  return [`https://api.db.nomics.world/v22/series/${enc(provider)}/${enc(dataset)}/${enc(series)}?observations=1`];
}
