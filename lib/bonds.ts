// ── US Treasury securities: identity, curve, price ───────────────────────────
//
// Two things live here, and they are not the same kind of fact:
//
//   EXACT      cusip, isin, coupon, maturity, issue date, auction price.
//              Published by the Treasury. Nothing is inferred.
//   COMPUTED   today's price and yield for a given security.
//              Discounted off the live par curve. A model number, and labelled
//              as one everywhere it is shown.
//
// The second exists because there is no free public feed of secondary-market prices per
// CUSIP — TRACE is not an open API and the vendors who carry it charge for it. For
// Treasuries the computation is honest: they are the most liquid bond market there is and
// the par curve is the correct discount basis. It will still differ from the traded price
// (on-the-run premium, bid/ask, settlement), so it is never presented as a quote.

/** What the Treasury issues. FRN pays a floating coupon and is not priced here. */
export type SecurityType = 'Bill' | 'Note' | 'Bond' | 'TIPS' | 'FRN';

export interface TreasurySecurity {
  cusip: string;
  /** Derived from the CUSIP, not fetched — see isinFromCusip. */
  isin: string | null;
  type: SecurityType;
  /** As the Treasury words it: "30-Year", "10-Year", "26-Week". */
  term: string;
  issueDate: string;
  maturityDate: string;
  /** Annual rate in percent. Null for Bills, which pay none. */
  couponPct: number | null;
  /** Price per 100 at auction. Null when the auction record carried none. */
  issuePrice: number | null;
}

// ── ISIN ─────────────────────────────────────────────────────────────────────
//
// For a US security the ISIN is not a separate identifier to look up: it is "US" + the
// 9-character CUSIP + one check digit, and the check digit is computed. So the Treasury's
// auction records, which carry only CUSIPs, are enough to show an ISIN — no second source
// and nothing to be out of date.
//
// The check digit is Luhn, applied after expanding letters to numbers (A=10 … Z=35) and
// concatenating the digits of each expansion. Luhn doubles every second digit FROM THE
// RIGHT, which is why the parity is decided after the string is built, not during.

const ALNUM = /^[0-9A-Z]+$/;

/** Luhn check digit for an already letter-expanded numeric string. */
function luhnCheckDigit(digits: string): number {
  let sum = 0;
  // Rightmost digit is position 1 and IS doubled, because the check digit that will be
  // appended occupies position 0. Getting this parity backwards produces a check digit
  // that is wrong on roughly nine ISINs in ten, so it is pinned in the vet suite against
  // a published ISIN rather than reasoned about here.
  for (let i = digits.length - 1, pos = 1; i >= 0; i--, pos++) {
    let d = digits.charCodeAt(i) - 48;
    if (pos % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Expand A→10 … Z→35, digits unchanged, concatenating each expansion's digits. */
export function expandAlnum(s: string): string {
  let out = '';
  for (const ch of s) {
    out += ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
  }
  return out;
}

/**
 * The ISIN for a US CUSIP, or null if the CUSIP is not a well-formed 9-character one.
 * Returns null rather than a best effort: a wrong ISIN is worse than an absent one,
 * because it looks like a real identifier and can be pasted into a broker.
 */
export function isinFromCusip(cusip: string): string | null {
  const c = (cusip ?? '').trim().toUpperCase();
  if (c.length !== 9 || !ALNUM.test(c)) return null;
  const body = `US${c}`;
  return `${body}${luhnCheckDigit(expandAlnum(body))}`;
}

/** Whether an ISIN's own check digit is self-consistent. */
export function isValidIsin(isin: string): boolean {
  const s = (isin ?? '').trim().toUpperCase();
  if (s.length !== 12 || !ALNUM.test(s)) return false;
  return luhnCheckDigit(expandAlnum(s.slice(0, 11))) === Number(s[11]);
}

// ── Maturity buckets ─────────────────────────────────────────────────────────
//
// By REMAINING life, not by the tenor the security was issued at. A 30-year bond sold in
// 2010 has six years left and belongs with the six-year paper — that is what it behaves
// like and that is where someone looking for a six-year bond expects to find it.
//
// The ranges are the standard index convention — 1–3, 3–5, 5–7, 7–10, 10–20, 20+ — the
// one the Treasury ETFs are cut on (SHY, IEI, IEF, TLH, TLT), because that is the ladder
// people already have in their heads.
//
// An earlier version grouped these by instrument type instead (Bills / Notes / Bonds) and
// labelled the long end "20-Year" and "30-Year" on the grounds that the Treasury issues
// no tenor beyond 30. True, and beside the point: "20+" is a statement about remaining
// life, not about issuance, and there are hundreds of bonds with more than twenty years
// left. Type is still there, as a filter inside the bucket, which is where it is useful.

export interface Bucket {
  id: string;
  /** What the tile says. */
  label: string;
  /** The curve tenor this bucket is read against. */
  curveCol: string;
  /** Years of remaining life this bucket accepts, [lo, hi). */
  lo: number;
  hi: number;
  /** One line on what lives here. */
  note: string;
}

export const BUCKETS: Bucket[] = [
  { id: 'UST0_1',   label: '0–1 Y',   curveCol: '6 Mo',  lo: 0,  hi: 1,
    note: 'Bills and anything close to redemption. Bills pay no coupon — sold under 100, redeemed at 100.' },
  { id: 'UST1_3',   label: '1–3 Y',   curveCol: '2 Yr',  lo: 1,  hi: 3,  note: 'The front end. Tracks policy expectations most closely.' },
  { id: 'UST3_5',   label: '3–5 Y',   curveCol: '5 Yr',  lo: 3,  hi: 5,  note: 'Belly of the curve.' },
  { id: 'UST5_7',   label: '5–7 Y',   curveCol: '7 Yr',  lo: 5,  hi: 7,  note: 'Belly of the curve.' },
  { id: 'UST7_10',  label: '7–10 Y',  curveCol: '10 Yr', lo: 7,  hi: 10, note: 'The 10-year area — the benchmark most rates are quoted against.' },
  { id: 'UST10_20', label: '10–20 Y', curveCol: '20 Yr', lo: 10, hi: 20, note: 'Long end. Mostly old 30-year bonds with time run off them.' },
  { id: 'UST20P',   label: '20+ Y',   curveCol: '30 Yr', lo: 20, hi: 100,
    note: 'The longest paper outstanding. Most sensitive to rate moves, and where the deepest discounts to par sit.' },
];

/** Years between two ISO dates, on the actual/365.25 basis used for bucketing only. */
export function yearsBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / (365.25 * 864e5);
}

/** The bucket a security's REMAINING life falls in, or null if past maturity. */
export function bucketFor(maturityDate: string, asOf: string): Bucket | null {
  const y = yearsBetween(asOf, maturityDate);
  if (!isFinite(y) || y < 0) return null;
  return BUCKETS.find(b => y >= b.lo && y < b.hi) ?? null;
}

// ── Par curve → zero curve ───────────────────────────────────────────────────
//
// The Treasury publishes a PAR yield curve: for each tenor, the coupon a bond issued
// today at that tenor would carry to price at exactly 100. Discounting a real bond's cash
// flows at par yields is wrong — each flow has to be discounted at the zero rate for ITS
// OWN date, and the two differ whenever the curve is not flat.
//
// So the par curve is bootstrapped to discount factors, forward along the half-year grid
// the coupons fall on. For a par bond of tenor n with par yield c (annual, semi-annual
// coupons), by definition its price is 100:
//
//     100 = Σ(i<n) (100·c/2)·DF_i + (100 + 100·c/2)·DF_n
//
// which rearranges to the one unknown:
//
//     DF_n = (1 − (c/2)·Σ(i<n) DF_i) / (1 + c/2)
//
// The flat-curve case is the test that matters: if every par yield equals c, every zero
// rate must come back exactly c. That is an algebraic identity, so it holds to machine
// precision and catches a wrong compounding convention or an off-by-one in the sum, which
// a monotonicity check would not.

export interface CurvePoint {
  /** Years from settlement. */
  years: number;
  /** Annual percent. */
  pct: number;
}

/** Linear interpolation on the par curve, flat outside the quoted range. */
export function interpolate(curve: CurvePoint[], years: number): number {
  if (curve.length === 0) return NaN;
  const c = [...curve].sort((a, b) => a.years - b.years);
  if (years <= c[0].years) return c[0].pct;
  if (years >= c[c.length - 1].years) return c[c.length - 1].pct;
  for (let i = 1; i < c.length; i++) {
    if (years <= c[i].years) {
      const { years: y0, pct: p0 } = c[i - 1];
      const { years: y1, pct: p1 } = c[i];
      return y1 === y0 ? p1 : p0 + (p1 - p0) * ((years - y0) / (y1 - y0));
    }
  }
  return c[c.length - 1].pct;
}

/**
 * Discount factors on the half-year grid out to `maxYears`, bootstrapped from the par
 * curve. Index i holds DF for t = (i+1)/2 years.
 *
 * TRUNCATED, not clamped, if a factor comes out non-positive. That happens when the par
 * curve is too steep to be arbitrage-free — the implied forwards explode and the identity
 * demands a negative price for a future dollar. A linear 1%→9% over 30 years does it, and
 * the old code raised that negative factor to a fractional power and returned NaN, which
 * flowed straight through to a price on screen. Past the truncation the curve says
 * nothing, so callers get NaN from `discountFactorAt` and return null rather than a
 * number: an unpriced bond is a fact, a NaN is a bug wearing a price's clothes.
 */
export function bootstrapDiscountFactors(par: CurvePoint[], maxYears: number): number[] {
  const n = Math.max(1, Math.ceil(maxYears * 2));
  const dfs: number[] = [];
  let runningSum = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / 2;
    const c = interpolate(par, t) / 100;
    // Below one year there is a single payment, so the quoted yield IS the zero rate and
    // bootstrapping it through the coupon identity would be inventing coupons that do not
    // exist. Bills are quoted bond-equivalent, which is the same basis as the grid.
    const df = t <= 0.5
      ? 1 / (1 + c / 2)
      : (1 - (c / 2) * runningSum) / (1 + c / 2);
    if (!isFinite(df) || df <= 0) break;
    dfs.push(df);
    runningSum += df;
  }
  return dfs;
}

/**
 * The discount factor at an arbitrary time, interpolated on the log of the factors.
 * NaN beyond the bootstrapped range — see bootstrapDiscountFactors. Extending the last
 * factor flat would price a 30-year bond off the 25-year curve and look plausible.
 */
export function discountFactorAt(dfs: number[], years: number): number {
  if (years <= 0) return 1;
  const x = years * 2;            // position on the half-year grid, 1-based
  if (x > dfs.length) return NaN;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  const at = (k: number) => (k <= 0 ? 1 : dfs[k - 1]);
  if (lo === hi) return at(lo);
  // Log-linear keeps the implied forward rate positive between grid points; plain linear
  // on the factors does not, and can produce a negative forward on a steep curve.
  const a = Math.log(at(lo));
  const b = Math.log(at(hi));
  return Math.exp(a + (b - a) * (x - lo));
}

/** The zero (spot) rate implied by a discount factor, semi-annually compounded, percent. */
export function zeroRateFromDf(df: number, years: number): number {
  if (years <= 0 || df <= 0) return NaN;
  return (Math.pow(df, -1 / (2 * years)) - 1) * 2 * 100;
}

// ── Cash flows and price ─────────────────────────────────────────────────────

/**
 * Coupon dates from maturity backwards, every six months, down to (but excluding) the
 * settlement date. Built backwards because the maturity date is the anchor the Treasury
 * fixes; building forwards from issue drifts on month ends.
 */
export function couponDates(settle: string, maturity: string): string[] {
  const m = new Date(maturity);
  if (isNaN(m.getTime())) return [];
  const s = Date.parse(settle);
  const out: string[] = [];
  const day = m.getUTCDate();
  for (let k = 0; k < 2 * 60; k++) {
    const d = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 6 * k, day));
    // Rolling back from e.g. the 31st into a 30-day month must land on the month's last
    // day, not spill into the next one.
    if (d.getUTCDate() !== day) d.setUTCDate(0);
    if (d.getTime() <= s) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

/**
 * How far into the current coupon period settlement falls, as a fraction in [0, 1].
 * Zero when settlement IS a coupon date.
 */
export function elapsedFraction(settle: string, nextCoupon: string): number {
  const next = Date.parse(nextCoupon);
  const prev = new Date(next);
  prev.setUTCMonth(prev.getUTCMonth() - 6);
  const span = next - prev.getTime();
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (Date.parse(settle) - prev.getTime()) / span));
}

/**
 * When each coupon falls, measured in YEARS ON THE CURVE'S OWN GRID — coupon periods, not
 * calendar years.
 *
 * This is the distinction that silently breaks the pricing identity. A 15 Feb → 15 Aug gap
 * is 181 days, which is 0.4956 of a 365.25-day year, not 0.5. Discounting the first coupon
 * at 0.4956 and the second at 0.9993 puts every flow slightly off the half-year grid the
 * curve was bootstrapped on, and a bond whose coupon equals a flat curve then prices at
 * 100.0103 instead of exactly 100. The error is small per flow, systematic in sign, and
 * invisible on screen.
 *
 * Flow k (1-based) falls at (k − w)/2, where w is how much of the current period is gone.
 */
export function flowTimes(count: number, w: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1 - w) / 2);
}

export interface PricedBond {
  /** Quoted price per 100 face, excluding accrued interest. */
  cleanPrice: number;
  /** What a buyer actually pays: clean + accrued. */
  dirtyPrice: number;
  accrued: number;
  /** Yield to maturity, annual percent, semi-annual compounding. */
  ytmPct: number;
  years: number;
}

/**
 * Price a fixed-coupon Treasury off the bootstrapped curve.
 *
 * Returns the CLEAN price, because that is the one "below par" is about: par is 100, the
 * redemption value, and the comparison is only meaningful once accrued interest — which
 * rises through every coupon period and drops to zero on payment — has been taken out.
 * Comparing a dirty price to 100 would make almost any bond look above par in the days
 * before a coupon.
 *
 * Null, not a number, when the curve does not reach the bond's maturity.
 */
export function priceFromCurve(
  couponPct: number, maturity: string, settle: string, par: CurvePoint[],
): PricedBond | null {
  const years = yearsBetween(settle, maturity);
  if (!isFinite(years) || years <= 0) return null;
  const dates = couponDates(settle, maturity);
  if (dates.length === 0) return null;

  const w = elapsedFraction(settle, dates[0]);
  const times = flowTimes(dates.length, w);
  const dfs = bootstrapDiscountFactors(par, times[times.length - 1] + 0.5);
  const cpn = couponPct / 2;                       // per 100 face, semi-annual

  let dirty = 0;
  for (let i = 0; i < times.length; i++) {
    const flow = cpn + (i === times.length - 1 ? 100 : 0);
    dirty += flow * discountFactorAt(dfs, times[i]);
  }
  if (!isFinite(dirty)) return null;

  const accrued = cpn * w;
  const clean = dirty - accrued;
  return { cleanPrice: clean, dirtyPrice: dirty, accrued, years, ytmPct: ytm(dirty, cpn, times) };
}

/** Yield to maturity by bisection on the dirty price. Robust beats fast at this size. */
export function ytm(dirty: number, cpn: number, times: number[]): number {
  const pv = (yPct: number) => {
    const y = yPct / 200;
    let v = 0;
    for (let i = 0; i < times.length; i++) {
      const flow = cpn + (i === times.length - 1 ? 100 : 0);
      v += flow / Math.pow(1 + y, times[i] * 2);
    }
    return v;
  };
  let lo = -5, hi = 60;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > dirty) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Price per 100 of a zero-coupon bill: no coupons, one redemption at 100. */
export function billPrice(maturity: string, settle: string, par: CurvePoint[]): PricedBond | null {
  const years = yearsBetween(settle, maturity);
  if (!isFinite(years) || years <= 0) return null;
  const dfs = bootstrapDiscountFactors(par, Math.max(years, 0.5) + 0.5);
  const df = discountFactorAt(dfs, years);
  if (!isFinite(df) || df <= 0) return null;
  const price = 100 * df;
  return {
    cleanPrice: price, dirtyPrice: price, accrued: 0, years,
    ytmPct: zeroRateFromDf(df, years),
  };
}

// ── Par and issue-price comparisons ──────────────────────────────────────────
//
// TWO different questions, deliberately both answered, because they are easy to conflate
// and only one of them is what "par" means:
//
//   vs PAR (100)        is it worth less than it will pay back at maturity? This is the
//                       definition. A bill is always below par until it matures.
//   vs ISSUE PRICE      is it worth less than it was sold for at auction? This is a
//                       return-since-issue question. A bill issued at 97.5 and now at
//                       98.9 is ABOVE its issue price while still BELOW par.
//
// Showing only the second under the name "below par" would be wrong on every bill and on
// any note auctioned away from 100.

export type ParStatus = 'below' | 'at' | 'above';

/** Compare a clean price to a reference, with a tick of tolerance around equality. */
export function compareTo(price: number, reference: number, tol = 0.01): ParStatus {
  if (!isFinite(price) || !isFinite(reference)) return 'at';
  if (price < reference - tol) return 'below';
  if (price > reference + tol) return 'above';
  return 'at';
}

export const parStatus = (cleanPrice: number): ParStatus => compareTo(cleanPrice, 100);

// ── Filtering ────────────────────────────────────────────────────────────────

export interface BondRow extends TreasurySecurity {
  priced: PricedBond | null;
  vsPar: ParStatus | null;
  vsIssue: ParStatus | null;
}

export interface BondFilters {
  types?: SecurityType[];
  couponMin?: number;
  couponMax?: number;
  priceMin?: number;
  priceMax?: number;
  ytmMin?: number;
  ytmMax?: number;
  maturityFrom?: string;
  maturityTo?: string;
  /** Only securities whose clean price is under 100. */
  belowPar?: boolean;
  /** Only securities trading under what they were auctioned at. */
  belowIssue?: boolean;
  /** Substring match on CUSIP or ISIN. */
  q?: string;
}

const inRange = (v: number | null | undefined, lo?: number, hi?: number) => {
  if (lo == null && hi == null) return true;
  if (v == null || !isFinite(v)) return false;   // an unknown value is not "in range"
  return (lo == null || v >= lo) && (hi == null || v <= hi);
};

export function filterBonds(rows: BondRow[], f: BondFilters): BondRow[] {
  const q = (f.q ?? '').trim().toUpperCase();
  return rows.filter(r => {
    if (f.types?.length && !f.types.includes(r.type)) return false;
    if (!inRange(r.couponPct, f.couponMin, f.couponMax)) return false;
    if (!inRange(r.priced?.cleanPrice ?? null, f.priceMin, f.priceMax)) return false;
    if (!inRange(r.priced?.ytmPct ?? null, f.ytmMin, f.ytmMax)) return false;
    if (f.maturityFrom && r.maturityDate < f.maturityFrom) return false;
    if (f.maturityTo && r.maturityDate > f.maturityTo) return false;
    if (f.belowPar && r.vsPar !== 'below') return false;
    if (f.belowIssue && r.vsIssue !== 'below') return false;
    if (q && !(r.cusip.toUpperCase().includes(q) || (r.isin ?? '').includes(q))) return false;
    return true;
  });
}

/** Build the displayable row for one security: price it, then place it against both marks. */
export function toRow(sec: TreasurySecurity, settle: string, par: CurvePoint[]): BondRow {
  const priced = sec.type === 'Bill'
    ? billPrice(sec.maturityDate, settle, par)
    : sec.couponPct != null && sec.type !== 'FRN'
      ? priceFromCurve(sec.couponPct, sec.maturityDate, settle, par)
      : null;   // FRN coupons reset; pricing one off a fixed curve would be fiction
  return {
    ...sec,
    priced,
    vsPar: priced ? parStatus(priced.cleanPrice) : null,
    vsIssue: priced && sec.issuePrice != null ? compareTo(priced.cleanPrice, sec.issuePrice) : null,
  };
}

// ── Reading the Treasury's auction file ──────────────────────────────────────
//
// These live here rather than in the route because a Next.js route may only export its
// handlers — and because they are the part most likely to be wrong: they were written
// against a schema that could not be reached from the machine they were written on.

/** Read a field under any of the names the API has used for it. */
function pick(row: Record<string, unknown>, ...names: string[]): string | null {
  for (const n of names) {
    const v = row[n];
    if (v != null && v !== '' && v !== 'null') return String(v);
  }
  return null;
}

const num = (s: string | null): number | null => {
  if (s == null) return null;
  const v = parseFloat(s.replace(/[$,%\s]/g, ''));
  return isFinite(v) ? v : null;
};

/** The Treasury words these a few ways; anything unrecognised is dropped, not guessed. */
export function securityType(raw: string | null): SecurityType | null {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('bill')) return 'Bill';
  if (s.includes('tips') || s.includes('inflation')) return 'TIPS';
  if (s.includes('frn') || s.includes('floating')) return 'FRN';
  if (s.includes('note')) return 'Note';
  if (s.includes('bond')) return 'Bond';
  return null;
}

export function normalizeAuctionRow(row: Record<string, unknown>): TreasurySecurity | null {
  const cusip = pick(row, 'cusip', 'CUSIP');
  const maturityDate = pick(row, 'maturity_date', 'maturityDate');
  const type = securityType(pick(row, 'security_type', 'securityType'));
  if (!cusip || !maturityDate || !type) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(maturityDate)) return null;

  // Bills pay no coupon. The rate on a bill row is the discount/investment rate, NOT a
  // coupon, and carrying it as one would price the bill as if it paid interest twice a
  // year — turning a 97.9 discount instrument into something near par.
  const rate = num(pick(row, 'int_rate', 'interest_rate', 'intRate'));
  const couponPct = type === 'Bill' || type === 'FRN' ? null : rate;

  return {
    cusip,
    isin: isinFromCusip(cusip),
    type,
    term: pick(row, 'security_term', 'securityTerm') ?? '',
    issueDate: pick(row, 'issue_date', 'issueDate') ?? '',
    maturityDate,
    couponPct,
    issuePrice: num(pick(row, 'price_per100', 'pricePer100', 'avg_med_price', 'high_price')),
  };
}

/**
 * Deduplicate by CUSIP. The auction file has one row per AUCTION, so a reopened security
 * appears several times with the same CUSIP and different auction dates. Keeping the
 * first of each is enough: the terms that matter here — coupon, maturity — are fixed at
 * first issue and identical across reopenings.
 */
export function dedupeByCusip(secs: TreasurySecurity[]): TreasurySecurity[] {
  const seen = new Map<string, TreasurySecurity>();
  for (const s of secs) if (!seen.has(s.cusip)) seen.set(s.cusip, s);
  return [...seen.values()];
}
