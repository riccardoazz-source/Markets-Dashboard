// ── Treasuries as symbols ────────────────────────────────────────────────────
//
// The Bonds tab first shipped with a panel of its own, and that was the mistake: every
// other asset in this app opens the same view — toolbar, timeframe row, stat tiles,
// chart, Tools, Data table, Notes — and bonds opened something that looked nothing like
// it and did less.
//
// So a bond gets a SYMBOL, the shared endpoints learn to serve it, and the standard panel
// works on it unchanged. Two shapes:
//
//   UST:B:<bucketId>   a maturity bucket. The series is the published YIELD for its
//                      tenor. There is no price here and there is no asset to buy —
//                      "the 20+ year" is a rate — so the chart measures the rate.
//   UST:S:<cusip>      one security. The series is its PRICE per 100 face.
//
// The second one is modelled, and that is stated wherever it is shown. There is no free
// public feed of traded prices per CUSIP — TRACE is not an open API and the vendors who
// carry it charge — so each past day's price is that bond's own cash flows discounted on
// the curve THAT DAY. For Treasuries this tracks closely: they are the most liquid bond
// market there is and the par curve is the correct discount basis. It is still a model,
// and a chart of it is a chart of a model.

import {
  BUCKETS, billPrice, priceFromCurve, yearsBetween,
  type Bucket, type TreasurySecurity,
} from './bonds';
import type { CurveDay } from './curveParse';

export const BOND_PREFIX = 'UST:';

export type BondRef =
  | { kind: 'bucket'; bucket: Bucket }
  | { kind: 'security'; cusip: string };

export const bucketSymbol = (id: string) => `${BOND_PREFIX}B:${id}`;
export const securitySymbol = (cusip: string) => `${BOND_PREFIX}S:${cusip}`;

export function isBondSymbol(symbol: string): boolean {
  return typeof symbol === 'string' && symbol.startsWith(BOND_PREFIX);
}

/** Decode a bond symbol, or null when it is not one (or names no known bucket). */
export function parseBondSymbol(symbol: string): BondRef | null {
  if (!isBondSymbol(symbol)) return null;
  const rest = symbol.slice(BOND_PREFIX.length);
  if (rest.startsWith('B:')) {
    const bucket = BUCKETS.find(b => b.id === rest.slice(2));
    return bucket ? { kind: 'bucket', bucket } : null;
  }
  if (rest.startsWith('S:')) {
    const cusip = rest.slice(2).trim().toUpperCase();
    return /^[0-9A-Z]{9}$/.test(cusip) ? { kind: 'security', cusip } : null;
  }
  return null;
}

/** What the panel should call it. */
export function bondDisplayName(ref: BondRef, sec?: TreasurySecurity | null): string {
  if (ref.kind === 'bucket') return `US Treasuries ${ref.bucket.label}`;
  if (!sec) return `US Treasury ${ref.cusip}`;
  const cpn = sec.couponPct != null ? `${sec.couponPct.toFixed(3)}% ` : '';
  return `${cpn}${sec.type} due ${sec.maturityDate}`;
}

/** The unit the chart is measuring. Bonds are the one place in this app where it varies. */
export const bondUnit = (ref: BondRef): 'yield' | 'price' =>
  ref.kind === 'bucket' ? 'yield' : 'price';

export interface SeriesPoint { date: string; close: number }

/**
 * A bucket's series: the published par yield for its tenor, exactly as it came out.
 * Nothing here is computed — this is the Treasury's own daily file, read.
 */
export function bucketSeries(bucket: Bucket, days: CurveDay[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const d of days) {
    const v = d.byCol[bucket.curveCol];
    if (isFinite(v)) out.push({ date: d.date, close: v });
  }
  return out;
}

/**
 * One security's price per 100 face, on every day the curve was published.
 *
 * MODELLED. Each point discounts the bond's remaining cash flows AS OF THAT DAY on THAT
 * DAY's curve, so the series reflects both the curve moving and the bond shortening. It
 * is not a record of trades.
 *
 * Days before issue are skipped — the bond did not exist — and so is anything on or after
 * maturity, where there is nothing left to discount.
 */
export function securityPriceSeries(sec: TreasurySecurity, days: CurveDay[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const d of days) {
    if (sec.issueDate && d.date < sec.issueDate) continue;
    if (yearsBetween(d.date, sec.maturityDate) <= 0) continue;
    const priced = sec.type === 'Bill'
      ? billPrice(sec.maturityDate, d.date, d.points)
      : sec.couponPct != null && sec.type !== 'FRN'
        ? priceFromCurve(sec.couponPct, sec.maturityDate, d.date, d.points)
        : null;
    if (priced && isFinite(priced.cleanPrice)) out.push({ date: d.date, close: priced.cleanPrice });
  }
  return out;
}

/** The same series expressed as yield to maturity, for the stat line. */
export function securityYieldSeries(sec: TreasurySecurity, days: CurveDay[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const d of days) {
    if (sec.issueDate && d.date < sec.issueDate) continue;
    if (yearsBetween(d.date, sec.maturityDate) <= 0) continue;
    const priced = sec.type === 'Bill'
      ? billPrice(sec.maturityDate, d.date, d.points)
      : sec.couponPct != null && sec.type !== 'FRN'
        ? priceFromCurve(sec.couponPct, sec.maturityDate, d.date, d.points)
        : null;
    if (priced && isFinite(priced.ytmPct)) out.push({ date: d.date, close: priced.ytmPct });
  }
  return out;
}

/** Percent change between the first and last point, or null when there is no pair. */
export function pctChange(series: SeriesPoint[]): number | null {
  if (series.length < 2) return null;
  const a = series[0].close, b = series[series.length - 1].close;
  if (!isFinite(a) || !isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** The first point on or after a date, for anchoring YTD and MTD. */
export function fromDate(series: SeriesPoint[], iso: string): SeriesPoint[] {
  return series.filter(p => p.date >= iso);
}

// ── Resolving a symbol to a series ───────────────────────────────────────────
//
// One function both /api/historical and /api/quotes call, so a bucket's chart and its
// stat tiles can never be drawn from two different fetches that disagree.

/**
 * Everything the shared endpoints need to serve one bond symbol.
 * Returns null when the symbol is not a bond, or names nothing that exists.
 */
export async function resolveBondSeries(
  symbol: string,
  years: number,
  deps: {
    fetchCurveRows: (years: number) => Promise<CurveDay[]>;
    fetchSecurityRows: (cusip: string) => Promise<Record<string, unknown>[]>;
    normalizeAuctionRow: (row: Record<string, unknown>) => TreasurySecurity | null;
  },
): Promise<{
  ref: BondRef; name: string; unit: 'yield' | 'price';
  series: SeriesPoint[]; security: TreasurySecurity | null;
} | null> {
  const ref = parseBondSymbol(symbol);
  if (!ref) return null;

  if (ref.kind === 'bucket') {
    const days = await deps.fetchCurveRows(years);
    return {
      ref, name: bondDisplayName(ref), unit: 'yield',
      series: bucketSeries(ref.bucket, days), security: null,
    };
  }

  // A reopened security appears once per auction with identical terms; the first is as
  // good as any, and the earliest issue date is the one the price series should start at.
  const rows = await deps.fetchSecurityRows(ref.cusip);
  const parsed = rows.map(deps.normalizeAuctionRow).filter((s): s is TreasurySecurity => s !== null);
  if (parsed.length === 0) return { ref, name: bondDisplayName(ref), unit: 'price', series: [], security: null };
  const sec = parsed.reduce((a, b) => (a.issueDate && b.issueDate && b.issueDate < a.issueDate ? b : a));

  const days = await deps.fetchCurveRows(years);
  return {
    ref, name: bondDisplayName(ref, sec), unit: 'price',
    series: securityPriceSeries(sec, days), security: sec,
  };
}
