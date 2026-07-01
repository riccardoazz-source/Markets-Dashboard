// ── Weekly ADX / DMI (Wilder) — the M26 "Gemini model" trend engine ──────────
// Gemini's strategy validates momentum on the WEEKLY timeframe with the Average
// Directional Index: a trend is "born" when ADX breaks up through 25 (with +DI
// leading −DI), and "exhausted" when ADX, after reaching extreme altitude (>50),
// rolls its slope over — the trend has lost propulsion before price collapses.
//
// ADX needs the true range (high/low), which our other signals (all close-only)
// don't. We now keep daily high/low from Yahoo, resample them to WEEKLY bars, and
// run the standard Wilder DMI/ADX. Everything here is computed from bars UP TO the
// as-of date only, so it is look-ahead-free and works identically live and in the
// backtest — the same contract as the rest of the model.

export interface OHLCPoint { date: string; close: number; high?: number; low?: number }
export interface Bar { high: number; low: number; close: number }

export interface ADXState {
  adx: number;        // 0..100 — trend strength on the weekly frame
  plusDI: number;     // +DI — up-pressure
  minusDI: number;    // −DI — down-pressure
  adxSlope: number;   // adx[last] − adx[last − slopeWk]; >0 building, <0 exhausting
}

// Resample daily OHLC (already filtered to ≤ as-of) into weekly bars keyed by ISO
// year-week. Weekly high = max daily high, low = min daily low, close = last close.
// When a bar lacks high/low (non-Yahoo source), close stands in for both.
export function resampleWeekly(daily: OHLCPoint[]): Bar[] {
  if (daily.length === 0) return [];
  const byWeek = new Map<string, Bar & { lastDate: string }>();
  for (const p of daily) {
    const hi = p.high != null && isFinite(p.high) ? p.high : p.close;
    const lo = p.low != null && isFinite(p.low) ? p.low : p.close;
    // ISO week key from the date string (YYYY-MM-DD).
    const d = new Date(p.date + 'T00:00:00Z');
    const key = isoYearWeek(d);
    const cur = byWeek.get(key);
    if (!cur) {
      byWeek.set(key, { high: hi, low: lo, close: p.close, lastDate: p.date });
    } else {
      if (hi > cur.high) cur.high = hi;
      if (lo < cur.low) cur.low = lo;
      // daily is chronological → the last seen close in the week is the weekly close
      if (p.date >= cur.lastDate) { cur.close = p.close; cur.lastDate = p.date; }
    }
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({ high: v.high, low: v.low, close: v.close }));
}

// ISO-8601 year-week (e.g. "2026-W07"), so weeks sort chronologically as strings.
function isoYearWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;            // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);    // nearest Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Full Wilder DMI/ADX on a bar series. Returns the whole ADX series so callers can
// read the slope (freshly-born vs rolling-over). Needs ≥ 2·period+1 bars.
function wilderADXSeries(bars: Bar[], period: number): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = bars.length;
  if (n < period + 1) return { adx: [], plusDI: [], minusDI: [] };

  const tr: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (tr.length < period) return { adx: [], plusDI: [], minusDI: [] };

  // Wilder smoothing (seed = simple sum of first `period`).
  const smooth = (xs: number[]): number[] => {
    const out: number[] = [];
    let s = 0;
    for (let i = 0; i < period; i++) s += xs[i];
    out.push(s);
    for (let i = period; i < xs.length; i++) { s = s - s / period + xs[i]; out.push(s); }
    return out;
  };
  const trS = smooth(tr), pS = smooth(plusDM), mS = smooth(minusDM);

  const plusDI: number[] = [], minusDI: number[] = [], dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = trS[i] > 0 ? 100 * pS[i] / trS[i] : 0;
    const mdi = trS[i] > 0 ? 100 * mS[i] / trS[i] : 0;
    plusDI.push(pdi); minusDI.push(mdi);
    const sum = pdi + mdi;
    dx.push(sum > 0 ? 100 * Math.abs(pdi - mdi) / sum : 0);
  }
  if (dx.length < period) return { adx: [], plusDI, minusDI };

  // ADX = Wilder average of DX.
  const adx: number[] = [];
  let a = 0;
  for (let i = 0; i < period; i++) a += dx[i];
  a /= period;
  adx.push(a);
  for (let i = period; i < dx.length; i++) { a = (a * (period - 1) + dx[i]) / period; adx.push(a); }
  return { adx, plusDI, minusDI };
}

// The public entry: daily OHLC up to the as-of date → weekly ADX state (or null when
// there isn't enough weekly history). slopeWk = how many weeks back to measure slope.
export function computeWeeklyADX(daily: OHLCPoint[], period = 14, slopeWk = 3): ADXState | null {
  const bars = resampleWeekly(daily);
  const { adx, plusDI, minusDI } = wilderADXSeries(bars, period);
  if (adx.length === 0) return null;
  const last = adx.length - 1;
  const prevIdx = Math.max(0, last - slopeWk);
  // plusDI/minusDI series is longer than adx (adx starts `period` bars later); align to the end.
  const di = plusDI.length - 1;
  return {
    adx: adx[last],
    plusDI: plusDI[di] ?? 0,
    minusDI: minusDI[di] ?? 0,
    adxSlope: adx[last] - adx[prevIdx],
  };
}
