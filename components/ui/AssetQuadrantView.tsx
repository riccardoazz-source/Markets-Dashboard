'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PhaseBadge } from '@/components/ui/PhaseBadge';
import { PanelClose } from '@/components/ui/PanelClose';
import clsx from 'clsx';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Customized,
} from 'recharts';
import { DetailModal } from './DetailModal';
import { TimeframeSelector } from './TimeframeSelector';
import { PriceChart, SYNC_AXIS_WIDTH } from '@/components/charts/PriceChart';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from './ChartTools';
import { LoadingSpinner } from './LoadingSpinner';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import { PHASE_META, RotationPhase } from '@/lib/rotationPhase';

// Price ABOVE, the model's quadrant position through time BELOW, on a shared time
// axis — so "the model called this Recovering here" can be read against what the
// price actually did next. The scores come from /api/asset-quadrant, which runs
// the SAME pipeline as the live Rotation Quadrant; the formula lives in one place.

interface QPoint { date: string; macroGap: number; momentum: number; r3m: number | null; phase: string | null; close: number | null; radius: number; angle: number; revised?: boolean }
/** A weekly sample carried forward onto every daily bar. */
interface DPoint { date: string; macroGap: number | null; momentum: number | null; r3m: number | null; phase: string | null; close: number | null; radius: number | null; angle: number | null; revised?: boolean }
interface Payload { price: HistoricalPoint[]; points: QPoint[]; stepDays: number; universeSize: number }

// Recharts hands a Customized layer the live pixel scales; only the parts used here.
interface AxisLike { scale?: (v: string) => number }
interface LayerProps {
  xAxisMap?: Record<string, AxisLike>;
  offset?: { top: number; left: number; width: number; height: number };
}

const fmtRet = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

/**
 * What the price did during each call, written above its band.
 *
 * Drawn in a Customized layer rather than as ReferenceArea labels because it needs
 * the real pixel width of each band: a two-day call is a sliver, and a number
 * printed on it would overlap its neighbours and make the strip unreadable. Bands
 * narrower than the text simply go unlabelled — the figure is still in the tooltip
 * and in the CSV, so nothing is lost, and the chart stays legible.
 */
function makeRunLabelLayer(runs: Run[], lit: (p: string | null | undefined) => boolean) {
  return function RunLabelLayer(props: LayerProps) {
    const { xAxisMap, offset } = props;
    const xScale = Object.values(xAxisMap ?? {})[0]?.scale;
    // Below ~44px the pane is a colour strip with no room for text.
    if (!xScale || !offset || offset.height < 44) return null;
    const nodes: React.ReactNode[] = [];
    for (const r of runs) {
      if (!r.phase || r.ret == null) continue;
      const x1 = xScale(r.from), x2 = xScale(r.to);
      if (x1 == null || x2 == null || !isFinite(x1) || !isFinite(x2)) continue;
      const w = Math.abs(x2 - x1);
      const text = fmtRet(r.ret);
      if (w < text.length * 5.2 + 6) continue;
      nodes.push(
        <text
          key={`runlab-${r.from}`}
          x={(x1 + x2) / 2}
          y={offset.top + 9}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill={phaseColor(r.phase)}
          opacity={lit(r.phase) ? 0.95 : 0.2}
        >
          {text}
        </text>,
      );
    }
    return <g>{nodes}</g>;
  };
}

/** One stretch of chart where the model held the same call, and what the price did. */
interface Run {
  from: string;
  /** Right edge for DRAWING: the day the next call starts, so bands touch. */
  to: string;
  /** Last day this call was actually in force — what the return is measured to. */
  end: string;
  phase: string | null;
  /**
   * Price change over the run FROM THE DAY THE LIVE CALL ARRIVED, %. For every phase but
   * a redrawn Recovering that is the band's own start, so nothing changes; for those, it
   * is what acting on the label could actually have earned.
   */
  ret: number | null;
  /** The whole band including the redrawn part — tooltip only, and labelled as hindsight. */
  retFull: number | null;
  /** Deepest fall from a running high INSIDE the run, %, ≤ 0. Null without closes. */
  dd: number | null;
  /**
   * For a Recovering band drawn back to the low: the day the LIVE call actually arrived.
   * Everything before it was labelled Lagging at the time and is only Recovering with
   * hindsight, so the band is dimmed up to here and a tick marks the spot.
   */
  confirmed: string | null;
  /** Calendar days the call was in force. */
  days: number;
}

const phaseColor = (p: string | null | undefined): string =>
  p && PHASE_META[p as RotationPhase] ? PHASE_META[p as RotationPhase].dot : '#6b7280';

// Module-level so flicking between timeframes (or reopening the panel) redraws
// instantly instead of waiting on the network again.
const viewCache = new Map<string, Payload>();

// Ties the price chart, its indicator panes and the quadrant panel to one crosshair.
const SYNC_ID = 'asset-quadrant';

export function AssetQuadrantView({ symbol, name, group, stocks, onClose }: {
  symbol: string;
  name: string;
  group?: string;
  /** Watchlist symbols, so a searched stock is scored inside the same universe. */
  stocks?: string[];
  onClose: () => void;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [priceData, setPriceData] = useState<HistoricalPoint[] | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [focusPhases, setFocusPhases] = useState<Set<string>>(new Set());

  // The price is ONE symbol and comes back in milliseconds; the model history has
  // to rank the whole universe week by week and takes seconds. Fetching them
  // together meant staring at a spinner for the slow one before seeing either, so
  // they run in parallel and the chart draws as soon as the price lands.
  useEffect(() => {
    let cancelled = false;
    setPriceLoading(true);
    setPriceData(null);
    fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`)
      .then(r => r.json())
      .then((rows: HistoricalPoint[]) => { if (!cancelled) setPriceData(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setPriceData([]); })
      .finally(() => { if (!cancelled) setPriceLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  // One request is now enough: the server computes the whole history in a single pass
  // and can no longer come back partial, so the rounds of refinement this used to need
  // are gone with the weekly grid that made them necessary.
  // Depend on the CONTENT of the stock list, not the array identity: a caller that
  // rebuilds the array each render would otherwise re-fire the fetch forever.
  const stocksKey = useMemo(() => stocks?.slice().sort().join(',') ?? '', [stocks]);

  useEffect(() => {
    let cancelled = false;
    const st = stocksKey ? `&stocks=${encodeURIComponent(stocksKey)}` : '';
    const ck = `${symbol}|${timeframe}|${stocksKey}`;
    const cached = viewCache.get(ck);
    if (cached) { setData(cached); setError(null); setLoading(false); return; }

    setLoading(true);
    setError(null);
    fetch(`/api/asset-quadrant?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}${st}`)
      .then(r => r.json())
      .then((j: Payload & { error?: string }) => {
        if (cancelled) return;
        if (j.error || !j.points?.length) {
          setError('Could not build the model history for this window.');
          setData(null); return;
        }
        setData(j);
        setLoading(false);
        viewCache.set(ck, j);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load the quadrant history.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [symbol, timeframe, stocksKey]);

  // Price series trimmed to a drag-selected range, so both charts stay in step.
  const price = useMemo(() => {
    const all = priceData ?? [];
    if (!customRange) return all;
    return all.filter(p => p.date >= customRange.from && p.date <= customRange.to);
  }, [priceData, customRange]);

  const points = useMemo(() => {
    const all = data?.points ?? [];
    if (!customRange) return all;
    const inside = all.filter(p => p.date >= customRange.from && p.date <= customRange.to);
    // Keep the last sample BEFORE the range as well: the call it carries is the one
    // in force on the range's opening days, and without it they have no colour.
    const before = all.filter(p => p.date < customRange.from).pop();
    return before ? [before, ...inside] : inside;
  }, [data, customRange]);

  // The model is sampled WEEKLY but the price is daily, and the shared crosshair
  // matches on the date value — so hovering a Tuesday found nothing in a
  // Monday-only array and the panel simply did not react. Carry each sample
  // forward across the price's own dates: the call holds until the model next
  // changes it, which is also what the phase bands already assume.
  const dailyPoints = useMemo<DPoint[]>(() => {
    if (!points.length) return [];
    if (!price.length) return points.map(p => ({ ...p }));
    let i = 0;
    let cur: QPoint | null = null;
    return price.map(bar => {
      while (i < points.length && points[i].date <= bar.date) cur = points[i++];
      return {
        date: bar.date,
        macroGap: cur?.macroGap ?? null,
        momentum: cur?.momentum ?? null,
        r3m: cur?.r3m ?? null,
        phase: cur?.phase ?? null,
        radius: cur?.radius ?? null,
        angle: cur?.angle ?? null,
        revised: cur?.revised,
        close: bar.close,
      };
    });
  }, [points, price]);

  // Phase runs: consecutive DAYS sharing a phase become one shaded band, and the
  // start of each run is where the model CHANGED its mind — the line to read the
  // price against.
  //
  // Built from the DAILY series, not from the weekly samples: a band's edges have
  // to be dates the chart actually plots. A weekly grid date that fell on a
  // holiday, or before the first bar, is not among the plotted categories, and
  // Recharts silently drops a reference area whose edge it cannot place — which is
  // why some stretches came out uncoloured.
  const runs = useMemo(() => {
    const out: Run[] = [];
    for (const p of dailyPoints) {
      const last = out[out.length - 1];
      if (last && last.phase === p.phase) { last.to = p.date; last.end = p.date; }
      else out.push({ from: p.date, to: p.date, end: p.date, phase: p.phase, ret: null, retFull: null, dd: null, confirmed: null, days: 0 });
    }
    // A phase holds until the next one starts, so each band is DRAWN to where the next
    // begins — otherwise a one-bar phase is a zero-width band that draws nothing. `end`
    // keeps the run's own last day, which is what the return is measured to.
    for (let i = 0; i < out.length - 1; i++) out[i].to = out[i + 1].from;
    const last = out[out.length - 1];
    if (last && last.from === last.to && dailyPoints.length >= 2) {
      last.from = dailyPoints[dailyPoints.length - 2].date;
    }
    // What the PRICE did while each call was showing: from the close at which the call
    // appeared to the close at which it changed.
    //
    // Not to the day the NEXT call starts, which is what this used to do. That day is
    // the one whose move broke the phase, so every band was inheriting the first day of
    // the opposite regime — Trending gave up its first day down, Lagging collected its
    // first day of rebound. Measured across ten assets it inverted the whole picture:
    // Lagging came out at +1.25% on average and Trending at +2.14%, where the same bands
    // measured to their own last day give Trending +4.83% and Lagging −1.55%.
    //
    // Nor from the day BEFORE the call appeared, which would be worse still: the phase
    // changed BECAUSE of that day's move, so crediting the move to the new phase would
    // let every phase confirm itself.
    //
    // The flip day itself therefore belongs to neither band, and that is the honest
    // place for it: it is the day the model changed its mind because of what happened.
    const closeAt = new Map(dailyPoints.map(p => [p.date, p.close]));
    // The net move alone hides what a stretch felt like. A Lagging band ends only once the
    // bottom has been called, and every confirmation that avoids calling a bear-market
    // rally lands ABOVE the low — so the rebound falls inside the band and the net reads
    // mildly positive while the drawdown suffered inside it is the worst of the four.
    // Both numbers are shown for exactly that reason.
    const idx = new Map(dailyPoints.map((p, i) => [p.date, i]));
    for (const r of out) {
      const i0 = idx.get(r.from), i1 = idx.get(r.end);
      r.days = Math.max(1, Math.round((Date.parse(r.end) - Date.parse(r.from)) / 86_400_000));
      if (i0 == null || i1 == null) continue;
      // Where the LIVE call arrived inside this band. For everything except a Recovering
      // band drawn back to its low, that is the band's own first day.
      r.confirmed = null;
      for (let i = i0; i <= i1; i++) if (!dailyPoints[i].revised) { r.confirmed = dailyPoints[i].date; break; }
      if (r.confirmed === r.from) r.confirmed = null;
      const iLive = r.confirmed != null ? (idx.get(r.confirmed) ?? i0) : i0;

      const full = closeAt.get(r.from), live = dailyPoints[iLive].close, end = closeAt.get(r.end);
      r.retFull = full != null && end != null && full > 0 ? (end / full - 1) * 100 : null;
      // THE figure the chips and the band labels quote. Measured from the live call, not
      // from the low: over twelve assets a Recovering band moves +14.8% but only +0.5% of
      // it lands after the model has said so. Quoting the whole band would advertise a
      // buy signal that is 97% hindsight.
      r.ret = live != null && end != null && live > 0 ? (end / live - 1) * 100 : null;
      // The drawdown likewise runs from the live call — the pain you would actually take.
      let peak = -Infinity, worst = 0;
      for (let i = iLive; i <= i1; i++) {
        const c = dailyPoints[i].close;
        if (c == null || !(c > 0)) continue;
        if (c > peak) peak = c;
        if (peak > 0) worst = Math.min(worst, (c / peak - 1) * 100);
      }
      r.dd = isFinite(worst) ? worst : null;
    }
    return out;
  }, [dailyPoints]);
  const transitions = runs.slice(1).filter(r => r.phase).map(r => r.from);

  // Symmetric domain: zero has to sit in the MIDDLE, or "above the line" and
  // "below the line" stop being readable at a glance.
  const momentumDomain = useMemo<[number, number]>(() => {
    const m = Math.max(2, ...dailyPoints.map(p => Math.abs(p.momentum ?? 0)));
    const pad = Math.ceil(m * 1.1);
    return [-pad, pad];
  }, [dailyPoints]);
  // The ribbon is a strip along the FLOOR of the pane, so its height has to follow the
  // axis. Hard-coding it (it used to run 0 → 7) made it a band across the middle of the
  // chart the moment the axis changed scale.
  const ribbonTop = momentumDomain[0] + (momentumDomain[1] - momentumDomain[0]) * 0.11;

  // Time spent, measured in DAYS on the chart rather than in samples, so it says
  // what the strip shows. Days with no call are left out of the denominator.
  //
  // Alongside it, what the price did on AVERAGE while that call was showing, over
  // this window only — the number that says whether the label was worth anything
  // here. A phase the window never contains simply has no chip: with a 1-year view
  // of a rising asset there may be no Lagging at all, and inventing a 0% for it
  // would read as "flat" instead of "never happened".
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const p of dailyPoints) if (p.phase) { counts.set(p.phase, (counts.get(p.phase) ?? 0) + 1); total++; }
    const stats = new Map<string, { avg: number | null; dd: number | null; runs: number }>();
    for (const ph of counts.keys()) {
      const rs = runs.filter(r => r.phase === ph && r.ret != null);
      const ds = runs.filter(r => r.phase === ph && r.dd != null);
      stats.set(ph, {
        avg: rs.length ? rs.reduce((s, r) => s + (r.ret as number), 0) / rs.length : null,
        dd: ds.length ? ds.reduce((s, r) => s + (r.dd as number), 0) / ds.length : null,
        runs: rs.length,
      });
    }
    return { rows: [...counts.entries()].sort((a, b) => b[1] - a[1]), total, stats };
  }, [dailyPoints, runs]);

  // Clicking a phase in "time spent" isolates it: everything else fades on the
  // strip and the matching stretches light up on the PRICE chart above, which is
  // the whole point — seeing what price did while the model held that call.
  const focused = (p: string | null | undefined) => focusPhases.size === 0 || (!!p && focusPhases.has(p));
  const togglePhase = (p: string) => setFocusPhases(prev => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });
  // What the model said, date by date, as CSV columns beside the price and the
  // tools. A file that shows only what the market did cannot answer "was the call
  // right?", which is the whole reason for exporting from this panel.
  const exportExtra = useMemo(() => {
    const m = new Map<string, Record<string, string | number | null>>();
    for (const p of dailyPoints) {
      m.set(p.date, {
        model_phase: p.phase,
        // Four decimals: these two columns decide the phase — x against the severity
        // boundary and y against zero — and two decimals can round a genuine
        // -1.9996 to the wrong side of it.
        model_x_cycle_depth_sigma: p.macroGap,
        model_y_leg_sigma: p.momentum,
        model_radius_sigma: p.radius,
        model_angle_deg: p.angle,
        model_r3m_pct: p.r3m,
      });
    }
    // The same run figures the strip is labelled with, carried on every date of the
    // run: a spreadsheet can then pivot on run_id to get one row per call, without
    // the file having to hold two tables of different lengths.
    const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
    runs.forEach((r, i) => {
      if (!r.phase) return;
      const avg = summary.stats.get(r.phase)?.avg ?? null;
      const avgDd = summary.stats.get(r.phase)?.dd ?? null;
      for (const p of dailyPoints) {
        if (p.date < r.from || p.date > r.end) continue;
        const row = m.get(p.date);
        if (!row) continue;
        row.model_run_id = i + 1;
        row.model_run_start = r.from;
        // Where the LIVE call arrived. Equal to the start for every band but a Recovering
        // one drawn back to its low, and the date the return below is measured from.
        row.model_run_live_call = r.confirmed ?? r.from;
        row.model_run_days = r.days;
        row.model_run_return_pct = r2(r.ret);
        row.model_run_return_from_low_pct = r2(r.retFull);
        row.model_run_worst_drawdown_pct = r2(r.dd);
        row.model_phase_avg_return_pct = r2(avg);
        row.model_phase_avg_worst_drawdown_pct = r2(avgDd);
      }
    });
    return m;
  }, [dailyPoints, runs, summary]);

  // The same figure the band is labelled with, reachable by date — a narrow band
  // carries no label, and the tooltip is where it can still be read.
  const runRetAt = useMemo(() => {
    const m = new Map<string, { ret: number | null; retFull: number | null; dd: number | null; days: number; phase: string | null; confirmed: string | null }>();
    for (const r of runs) {
      for (const p of dailyPoints) {
        if (p.date < r.from || p.date > r.end) continue;
        m.set(p.date, { ret: r.ret, retFull: r.retFull, dd: r.dd, days: r.days, phase: r.phase, confirmed: r.confirmed });
      }
    }
    return m;
  }, [runs, dailyPoints]);

  const priceBands = useMemo(() => (
    focusPhases.size === 0 ? undefined
      : runs.filter(r => r.phase && focusPhases.has(r.phase))
          .map(r => ({ from: r.from, to: r.to, color: phaseColor(r.phase), opacity: 0.22 }))
  ), [runs, focusPhases]);

  // The whole point of this panel is reading the price AGAINST the model's call, so
  // both have to be on screen at once. Turning on RSI and MACD pushed the quadrant
  // strip below the fold and the comparison became impossible — and since Print
  // saves the view, the export inherited the problem. The stack is therefore fitted
  // to the window: the more panes are open, the shorter each one gets, down to a
  // floor where it is still legible.
  const [viewportH, setViewportH] = useState(900);
  useEffect(() => {
    const measure = () => setViewportH(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const paneCount = [
    activeTools.rsi, activeTools.rsiWeekly, activeTools.rsiMonthly,
    activeTools.macd, activeTools.macdWeekly, activeTools.macdMonthly,
    activeTools.momentumDaily, activeTools.momentumWeekly, activeTools.momentumMonthly,
    activeTools.volume, activeTools.stretchSigma, activeTools.maSlope, activeTools.drawdown,
  ].filter(Boolean).length;

  // A first estimate of the split. The constants below are only a starting point —
  // what actually decides the size is the measurement further down, because the
  // non-chart part of this panel is not a fixed number: a caption wraps, a legend
  // row appears when a moving average is on, a phase filter adds a line.
  const [fit, setFit] = useState(1);
  const heights = useMemo(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
    const CHROME = 320;
    // A pane's caption sits ON TOP of its plot once compressed (see PaneFrame), so
    // past that point a pane costs only its height plus a small margin. Charging 26px
    // of header per pane is what stopped the stack fitting with seven tools open.
    const PANE_CHROME = 6, QUAD_CHROME = 20;
    const budget = Math.max(300, viewportH - CHROME - paneCount * PANE_CHROME - QUAD_CHROME);
    const PANE_SHARE = 0.55, QUAD_SHARE = 0.85;
    const unit = budget / (1 + QUAD_SHARE + paneCount * PANE_SHARE);
    return {
      price: clamp(unit * fit, 100, 210),
      quadrant: clamp(unit * QUAD_SHARE * fit, 70, 150),
      pane: clamp(unit * PANE_SHARE * fit, 32, 80),
    };
  }, [viewportH, paneCount, fit]);

  // Then MEASURE, instead of predicting. Every attempt to guess the non-chart
  // height was wrong by whatever had been forgotten, and the stack landed just
  // past the bottom of the window — near enough to look deliberate, far enough to
  // hide the quadrant strip. So the panel reads its own height after laying out
  // and corrects the charts by the exact overflow.
  //
  // It lands in ONE step rather than creeping: the chart heights are known, so
  // subtracting them from the measured height gives the true chrome, and the
  // charts can be scaled to exactly the room that is left. Naively scaling by the
  // overflow ratio would shrink the chrome too — which it cannot do — and take a
  // dozen re-renders of every chart to converge.
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // Measure the whole thing the window has to hold — the panel plus the Print
    // row above it plus the modal's outer padding — not just the card.
    const wrapper = (el.closest('[data-print-root]') as HTMLElement | null) ?? el;
    const outerPad = window.innerWidth >= 640 ? 48 : 16;   // p-2 / sm:p-6
    const total = wrapper.offsetHeight + outerPad;
    if (total <= 0) return;

    const charts = heights.price + heights.quadrant + heights.pane * paneCount;
    const chrome = total - charts;
    // A few pixels of slack: the heights are rounded, so aiming at the exact
    // bottom edge lands a hair past it as often as on it.
    const room = window.innerHeight - chrome - 8;
    if (charts <= 0 || room <= 0) return;

    const next = Math.max(0.45, Math.min(1, fit * (room / charts)));
    // Only when it makes a visible difference, so a rounding wobble cannot start
    // an endless shrink/grow cycle.
    if (Math.abs(next - fit) > 0.01) setFit(next);
  });

  return (
    <DetailModal onClose={onClose}>
      <div ref={panelRef} className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <PanelClose onClose={onClose} />
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              {name}
              <PhaseBadge symbol={symbol} />
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {symbol}{group ? ` · ${group}` : ''} · price vs the model&apos;s quadrant call
            </p>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
          {/* Full standard ladder: 1D…MAX + Custom, same as every other chart. */}
          <TimeframeSelector
            value={timeframe}
            onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
            isCustom={!!customRange}
            onCustomRange={(from, to) => setCustomRange({ from, to })}
          />
        </div>

        {priceLoading ? (
          <div className="flex items-center justify-center h-56"><LoadingSpinner size={28} /></div>
        ) : (
          <>
            {/* PRICE — same chart component (and tools) as everywhere else. */}
            {/* One sync group for the price, every indicator pane the tools open,
                and the quadrant panel below: hovering any of them moves the
                crosshair on all, so the model's call can be read at the exact
                point on the price you are pointing at. */}
            <PriceChart
              data={price}
              symbol={symbol}
              color="auto"
              height={heights.price}
              subChartHeight={heights.pane}
              toolsOverlay={activeTools}
              syncId={SYNC_ID}
              highlightBands={priceBands}
              exportExtra={exportExtra}
              onSetRange={(from, to) => setCustomRange({ from, to })}
            />

            {/* QUADRANT POSITION — shares the price chart's time axis. */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] font-medium text-gray-400">
                  Model quadrant over time
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(PHASE_META).map(([k, m]) => (
                    <span key={k} className="flex items-center gap-1 text-[9px] text-gray-400" title={m.hint}>
                      <span className="inline-block w-4 h-2.5 rounded-sm" style={{ background: m.dot }} />{m.label}
                    </span>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 text-[11px] text-gray-500" style={{ height: heights.quadrant }}>
                  <LoadingSpinner size={16} /> rebuilding the model day by day…
                </div>
              ) : error ? (
                <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">⚠ {error}</p>
              ) : (
              <ResponsiveContainer width="100%" height={heights.quadrant}>
                <ComposedChart data={dailyPoints} syncId={SYNC_ID} syncMethod="value" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  {/* Each phase run twice: a faint full-height wash for context, and
                      a SOLID ribbon along the bottom that actually reads as a colour.
                      The wash alone was too pale to tell the four phases apart. */}
                  {runs.filter(r => r.phase).map((r, i) => (
                    <ReferenceArea
                      key={`wash-${i}-${r.from}`} x1={r.from} x2={r.to}
                      fill={phaseColor(r.phase)} fillOpacity={focused(r.phase) ? 0.1 : 0.02} stroke="none"
                    />
                  ))}
                  {runs.filter(r => r.phase).map((r, i) => (
                    <ReferenceArea
                      key={`ribbon-${i}-${r.from}`} x1={r.from} x2={r.to} y1={momentumDomain[0]} y2={ribbonTop}
                      fill={phaseColor(r.phase)} fillOpacity={focused(r.phase) ? 0.95 : 0.12} stroke="none"
                    />
                  ))}
                  {/* The part of a Recovering band that only exists in hindsight: the
                      price had turned, but the model went on saying Lagging for another
                      36 sessions on average. Drawn faint, with a tick where the live call
                      actually arrived, so the band reads as a cycle without claiming the
                      whole of it was callable. */}
                  {runs.filter(r => r.confirmed).map((r, i) => (
                    <ReferenceArea
                      key={`prov-${i}-${r.from}`} x1={r.from} x2={r.confirmed as string}
                      y1={momentumDomain[0]} y2={ribbonTop}
                      fill="#0b1020" fillOpacity={focused(r.phase) ? 0.55 : 0.1} stroke="none"
                    />
                  ))}
                  {runs.filter(r => r.confirmed).map(r => (
                    <ReferenceLine
                      key={`conf-${r.confirmed}`} x={r.confirmed as string}
                      stroke={phaseColor(r.phase)} strokeWidth={1.5}
                      strokeOpacity={focused(r.phase) ? 0.9 : 0.2}
                    />
                  ))}
                  {/* What the price did during each call, over its own band. */}
                  <Customized component={makeRunLabelLayer(runs, focused)} />
                  {/* Dashed line at every phase change — read straight up to the price. */}
                  {transitions.map(d => (
                    <ReferenceLine key={`tr-${d}`} x={d} stroke="#94a3b8" strokeDasharray="3 3"
                      strokeOpacity={focusPhases.size > 0 ? 0.18 : 0.55} />
                  ))}
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
                  <XAxis dataKey="date" scale="point" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={40} />
                  <YAxis
                    domain={momentumDomain}
                    tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={SYNC_AXIS_WIDTH}
                    tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`}
                  />
                  {/* Zero = steady. Above it the move is speeding up, below it slowing. */}
                  <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 2" strokeWidth={1.2} />
                  {/* Shares the line's dataKey — kept out of the tooltip so the
                      reading is not listed twice. */}
                  <Area type="monotone" dataKey="momentum" stroke="none" fill="#6366f1" fillOpacity={0.08}
                    tooltipType="none" />
                  {/* A dot on every daily bar turned the line into a caterpillar and
                      buried the phase colours underneath it. Thin line, no markers —
                      this is a level to read, not a set of points to count. */}
                  <Line type="monotone" dataKey="momentum" stroke="#a5b4fc" strokeWidth={1.1}
                    strokeOpacity={0.9} dot={false} activeDot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  <Tooltip
                    position={{ y: 0 }}
                    labelFormatter={() => ''}
                    contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: 6, color: '#e2e8f0', fontSize: 10, padding: '2px 6px', lineHeight: 1.35 }}
                    formatter={(v: number, _n: string, p: { payload?: DPoint }) => {
                      const pt = p?.payload;
                      const mom = v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ ${v >= 0 ? 'off the low' : 'off the high'}` : '—';
                      const gap = pt?.macroGap != null ? `${pt.macroGap.toFixed(2)}σ below its high` : '—';
                      const run = pt ? runRetAt.get(pt.date) : undefined;
                      const runTxt = run?.ret != null ? ` · this call ${fmtRet(run.ret)} in ${run.days}d` : '';
                      const ddTxt = run?.dd != null ? ` (worst ${fmtRet(run.dd)})` : '';
                      // The whole band, said separately and named as what it is.
                      const fullTxt = run?.confirmed && run.retFull != null
                        ? ` · band from the low ${fmtRet(run.retFull)}, of which ${fmtRet(run.ret ?? 0)} after the call` : '';
                      // Say so on the exact days that are hindsight, not only in a caption.
                      const provTxt = pt?.revised ? ' · in hindsight — the live call that day was Lagging' : '';
                      return [`depth ${gap} · leg ${mom} · ${pt?.phase ?? '—'}${runTxt}${ddTxt}${fullTxt}${provTxt}`, 'Model'];
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              )}

              {summary.rows.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wider"
                    title="Share of the visible window spent in each phase, the average net move per stretch, and the average worst drawdown suffered inside a stretch.&#10;A Recovering band is drawn from the low the price actually turned at, but the figures are measured from the tick — the day the live call arrived, 36 sessions later on average. The dimmed stretch before it was labelled Lagging at the time, and over twelve assets it carries 14.3 of the 14.8 points such a band shows.">
                    Time spent · avg move · worst inside
                  </span>
                  {summary.rows.map(([ph, n]) => (
                    <button
                      key={ph}
                      data-print-keep
                      onClick={() => togglePhase(ph)}
                      title={focusPhases.has(ph) ? 'Click to stop isolating this phase' : 'Click to show only this phase'}
                      className={clsx(
                        'text-[9px] px-1.5 py-0.5 rounded transition-opacity cursor-pointer',
                        PHASE_META[ph as RotationPhase]?.cls,
                        focusPhases.size > 0 && !focusPhases.has(ph) && 'opacity-35',
                        focusPhases.has(ph) && 'ring-1 ring-white/60',
                      )}
                    >
                      {ph} {Math.round((n / Math.max(1, summary.total)) * 100)}%
                      {summary.stats.get(ph)?.avg != null && (
                        <span className="opacity-70"> · avg {fmtRet(summary.stats.get(ph)!.avg as number)}</span>
                      )}
                      {summary.stats.get(ph)?.dd != null && (
                        <span className="opacity-50"> · worst {fmtRet(summary.stats.get(ph)!.dd as number)}</span>
                      )}
                    </button>
                  ))}
                  {focusPhases.size > 0 && (
                    <button onClick={() => setFocusPhases(new Set())}
                      className="text-[9px] px-1.5 py-0.5 rounded border border-border text-gray-400 hover:text-gray-200">
                      show all
                    </button>
                  )}
                </div>
              )}
              {focusPhases.size > 0 && (
                <p className="text-[9px] text-gray-600">
                  Showing only <b className="text-gray-400">{[...focusPhases].join(' + ')}</b> — those stretches are
                  shaded on the price chart above too.
                </p>
              )}
            </div>

            {price.length > 1 && (
              <ChartTools data={price} activeTools={activeTools} onChange={setActiveTools} symbol={symbol} />
            )}
          </>
        )}
      </div>
    </DetailModal>
  );
}
