// ── Phase bands: turning a daily label into stretches, and measuring them ─────
//
// Extracted from the panel because this is the arithmetic that has been wrong most often,
// and inside a component nothing could test it. Every rule below exists because a version
// without it produced a visibly wrong number.
//
// WHERE A BAND ENDS. A stretch is measured from the close at which its call appeared to
// the close at which the call changed. NOT to the day the next call starts: that is the
// day whose move broke the phase, so crediting it to the old band makes every band
// inherit the first day of the opposite regime — measured across ten assets that alone
// inverted the picture, Lagging reading +1.25% and Trending +2.14% where the same bands
// measured to their own last day give +4.83% and −1.55%. Nor from the day BEFORE the call
// appeared, which is worse: the phase changed BECAUSE of that day, so crediting it would
// let every phase confirm itself. The flip day belongs to neither band.
//
// WHERE THE MEASUREMENT STARTS. A Recovering band is drawn back to the low the price
// actually turned at, but the model only says so about 36 sessions later. Over twelve
// assets such a band moves +14.8% and just +0.5% of that lands after the call — so the
// figures are measured from the live call, and only the drawing starts at the low.
//
// DRAWING vs MEASURING. `drawFrom` exists solely so a one-day band is not a zero-width
// rectangle that renders nothing. It is never used for a return: an earlier version
// widened `from` itself, which quietly handed the band a day belonging to the phase
// before it.
//
// THE RUNNING STRETCH is measured to wherever the price happens to be today, so it is not
// comparable with stretches measured to where their phase actually ended, and it is the
// one thing that can put a positive number on Lagging. It is flagged, and the averages
// leave it out.

export interface PhasePoint {
  date: string;
  close: number | null;
  phase: string | null;
  /** True when this bar was redrawn into its phase after the fact — see lib/rotationPhase. */
  revised?: boolean;
}

export interface PhaseRun {
  phase: string | null;
  /** First day the call was in force. What every figure is anchored to. */
  from: string;
  /** Left edge for DRAWING only — equal to `from` except on a one-day final band. */
  drawFrom: string;
  /** Right edge for drawing: where the next band begins, so bands touch. */
  to: string;
  /** Last day this call was actually in force. */
  end: string;
  /** The day the LIVE call arrived, when later than `from`; null when they are the same. */
  confirmed: string | null;
  /** Calendar days the call was in force. */
  days: number;
  /** Move from the live call to the end, %. The figure worth quoting. */
  ret: number | null;
  /** Move over the whole drawn band, %. Larger when part of it is hindsight. */
  retFull: number | null;
  /** Deepest fall from a running high, from the live call onward, %. */
  dd: number | null;
  /** The stretch has not finished. Excluded from the averages. */
  open: boolean;
}

export function buildPhaseRuns(points: PhasePoint[]): PhaseRun[] {
  const runs: PhaseRun[] = [];
  for (const p of points) {
    const last = runs[runs.length - 1];
    if (last && last.phase === p.phase) { last.to = p.date; last.end = p.date; continue; }
    runs.push({
      phase: p.phase, from: p.date, drawFrom: p.date, to: p.date, end: p.date,
      confirmed: null, days: 0, ret: null, retFull: null, dd: null, open: false,
    });
  }
  if (!runs.length) return runs;

  // Each band is drawn to where the next begins, so they touch and a one-bar phase is
  // not invisible. `end` keeps the run's own last day, which is what returns measure to.
  for (let i = 0; i < runs.length - 1; i++) runs[i].to = runs[i + 1].from;
  const tail = runs[runs.length - 1];
  if (tail.from === tail.to && points.length >= 2) tail.drawFrom = points[points.length - 2].date;

  tail.open = true;

  const idx = new Map(points.map((p, i) => [p.date, i]));
  for (const r of runs) {
    r.days = Math.max(1, Math.round((Date.parse(r.end) - Date.parse(r.from)) / 86_400_000));
    const i0 = idx.get(r.from), i1 = idx.get(r.end);
    if (i0 == null || i1 == null) continue;

    // Where the live call arrived. For everything but a redrawn Recovering band that is
    // the band's own first day, and `confirmed` stays null.
    r.confirmed = null;
    for (let i = i0; i <= i1; i++) if (!points[i].revised) { r.confirmed = points[i].date; break; }
    if (r.confirmed === r.from) r.confirmed = null;
    const iLive = r.confirmed != null ? (idx.get(r.confirmed) ?? i0) : i0;

    const first = points[i0].close, live = points[iLive].close, end = points[i1].close;
    r.retFull = first != null && end != null && first > 0 ? (end / first - 1) * 100 : null;
    r.ret = live != null && end != null && live > 0 ? (end / live - 1) * 100 : null;

    let peak = -Infinity, worst = 0;
    for (let i = iLive; i <= i1; i++) {
      const c = points[i].close;
      if (c == null || !(c > 0)) continue;
      if (c > peak) peak = c;
      if (peak > 0) worst = Math.min(worst, (c / peak - 1) * 100);
    }
    r.dd = isFinite(worst) ? worst : null;
  }
  return runs;
}

export interface PhaseStat { avg: number | null; dd: number | null; runs: number }

/** Per-phase averages over FINISHED stretches only — see the header for why. */
export function phaseAverages(runs: PhaseRun[]): Map<string, PhaseStat> {
  const out = new Map<string, PhaseStat>();
  const phases = new Set(runs.map(r => r.phase).filter((p): p is string => !!p));
  for (const ph of phases) {
    const done = runs.filter(r => r.phase === ph && !r.open);
    const rs = done.filter(r => r.ret != null);
    const ds = done.filter(r => r.dd != null);
    out.set(ph, {
      avg: rs.length ? rs.reduce((s, r) => s + (r.ret as number), 0) / rs.length : null,
      dd: ds.length ? ds.reduce((s, r) => s + (r.dd as number), 0) / ds.length : null,
      runs: rs.length,
    });
  }
  return out;
}
