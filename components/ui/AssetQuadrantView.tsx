'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PanelClose } from '@/components/ui/PanelClose';
import clsx from 'clsx';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
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

interface QPoint { date: string; score: number; r3m: number; phase: string | null; close: number | null }
/** A weekly sample carried forward onto every daily bar. */
interface DPoint { date: string; score: number | null; r3m: number | null; phase: string | null; close: number | null }
interface Payload { price: HistoricalPoint[]; points: QPoint[]; stepDays: number; universeSize: number; coarse?: boolean }

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
  const [refining, setRefining] = useState(false);
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

  // A long window cannot be ranked end to end inside one request's budget, so the
  // server returns what it managed and flags it. Rather than block on a single
  // very long call, ask again: the server's per-date cache makes everything
  // already computed free, so each round spends its whole budget going further
  // and the chart refines in front of the user until it is complete.
  // Depend on the CONTENT of the stock list, not the array identity: a caller that
  // rebuilds the array each render would otherwise re-fire the fetch forever.
  const stocksKey = useMemo(() => stocks?.slice().sort().join(',') ?? '', [stocks]);

  useEffect(() => {
    let cancelled = false;
    const st = stocksKey ? `&stocks=${encodeURIComponent(stocksKey)}` : '';
    const ck = `${symbol}|${timeframe}|${stocksKey}`;
    const cached = viewCache.get(ck);
    if (cached) { setData(cached); setError(null); setLoading(false); setRefining(false); return; }

    const MAX_ROUNDS = 8;
    const run = (round: number) => {
      if (cancelled) return;
      if (round === 0) setLoading(true);
      setError(null);
      fetch(`/api/asset-quadrant?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}${st}&r=${round}`)
        .then(r => r.json())
        .then((j: Payload & { error?: string }) => {
          if (cancelled) return;
          if (j.error || !j.points?.length) {
            setError('Could not build the model history for this window.');
            setData(null); setRefining(false); return;
          }
          setData(j);
          setLoading(false);
          if (j.coarse && round + 1 < MAX_ROUNDS) { setRefining(true); run(round + 1); }
          else { setRefining(false); if (!j.coarse) viewCache.set(ck, j); }
        })
        .catch(() => {
          if (cancelled) return;
          setError('Could not load the quadrant history.');
          setLoading(false); setRefining(false);
        });
    };
    run(0);
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
        score: cur?.score ?? null,
        r3m: cur?.r3m ?? null,
        phase: cur?.phase ?? null,
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
    const out: { from: string; to: string; phase: string | null }[] = [];
    for (const p of dailyPoints) {
      const last = out[out.length - 1];
      if (last && last.phase === p.phase) last.to = p.date;
      else out.push({ from: p.date, to: p.date, phase: p.phase });
    }
    // A phase holds until the next one starts, so each run ends where the next
    // begins — otherwise a one-bar phase is a zero-width band that draws nothing.
    for (let i = 0; i < out.length - 1; i++) out[i].to = out[i + 1].from;
    const last = out[out.length - 1];
    if (last && last.from === last.to && dailyPoints.length >= 2) {
      last.from = dailyPoints[dailyPoints.length - 2].date;
    }
    return out;
  }, [dailyPoints]);
  const transitions = runs.slice(1).filter(r => r.phase).map(r => r.from);

  // Time spent, measured in DAYS on the chart rather than in samples, so it says
  // what the strip shows. Days with no call are left out of the denominator.
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const p of dailyPoints) if (p.phase) { counts.set(p.phase, (counts.get(p.phase) ?? 0) + 1); total++; }
    return { rows: [...counts.entries()].sort((a, b) => b[1] - a[1]), total };
  }, [dailyPoints]);

  // Clicking a phase in "time spent" isolates it: everything else fades on the
  // strip and the matching stretches light up on the PRICE chart above, which is
  // the whole point — seeing what price did while the model held that call.
  const focused = (p: string | null | undefined) => focusPhases.size === 0 || (!!p && focusPhases.has(p));
  const togglePhase = (p: string) => setFocusPhases(prev => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });
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
    activeTools.volume,
  ].filter(Boolean).length;

  // A first estimate of the split. The constants below are only a starting point —
  // what actually decides the size is the measurement further down, because the
  // non-chart part of this panel is not a fixed number: a caption wraps, a legend
  // row appears when a moving average is on, a phase filter adds a line.
  const [fit, setFit] = useState(1);
  const heights = useMemo(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
    const CHROME = 320;
    const PANE_CHROME = 26, QUAD_CHROME = 20;
    const budget = Math.max(300, viewportH - CHROME - paneCount * PANE_CHROME - QUAD_CHROME);
    const PANE_SHARE = 0.55, QUAD_SHARE = 0.85;
    const unit = budget / (1 + QUAD_SHARE + paneCount * PANE_SHARE);
    return {
      price: clamp(unit * fit, 100, 210),
      quadrant: clamp(unit * QUAD_SHARE * fit, 80, 150),
      pane: clamp(unit * PANE_SHARE * fit, 40, 80),
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
            <h3 className="text-base font-bold text-white">{name}</h3>
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
              onSetRange={(from, to) => setCustomRange({ from, to })}
            />

            {/* QUADRANT POSITION — shares the price chart's time axis. */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] font-medium text-gray-400">
                  Model quadrant over time
                  {refining && <span className="ml-2 text-[10px] text-accent animate-pulse">refining…</span>}
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
                  <LoadingSpinner size={16} /> ranking the universe week by week…
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
                      key={`ribbon-${i}-${r.from}`} x1={r.from} x2={r.to} y1={0} y2={7}
                      fill={phaseColor(r.phase)} fillOpacity={focused(r.phase) ? 0.95 : 0.12} stroke="none"
                    />
                  ))}
                  {/* Dashed line at every phase change — read straight up to the price. */}
                  {transitions.map(d => (
                    <ReferenceLine key={`tr-${d}`} x={d} stroke="#94a3b8" strokeDasharray="3 3"
                      strokeOpacity={focusPhases.size > 0 ? 0.18 : 0.55} />
                  ))}
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={40} />
                  <YAxis
                    domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
                    tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={SYNC_AXIS_WIDTH}
                  />
                  {/* 50 = the quadrant's horizontal split. */}
                  <ReferenceLine y={50} stroke="#64748b" strokeDasharray="4 2" strokeWidth={1.2} />
                  <Area type="monotone" dataKey="score" stroke="none" fill="#6366f1" fillOpacity={0.08} />
                  {/* A dot on every daily bar turned the line into a caterpillar and
                      buried the phase colours underneath it. Thin line, no markers —
                      the score is a level to read, not a set of points to count. */}
                  <Line type="monotone" dataKey="score" stroke="#a5b4fc" strokeWidth={1.1}
                    strokeOpacity={0.9} dot={false} activeDot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: 8, color: '#e2e8f0', fontSize: 11 }}
                    formatter={(v: number, _n: string, p: { payload?: QPoint }) => {
                      const pt = p?.payload;
                      return [`score ${v} · 3M ${pt?.r3m != null ? `${pt.r3m >= 0 ? '+' : ''}${pt.r3m.toFixed(1)}%` : '—'} · ${pt?.phase ?? '—'}`, 'Model'];
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              )}

              <p className="text-[9px] text-gray-600 leading-snug">
                The <b className="text-gray-500">purple line</b> is the model&apos;s percentile against the whole
                universe on that date ({data?.universeSize ?? '—'} assets, the same set the Rotation Quadrant ranks) — above the dashed 50 line means the top half. The{' '}
                <b className="text-gray-500">colour strip along the bottom</b> (and the matching tint behind) is the
                quadrant that follows from it. Vertical dashed lines mark where the call CHANGED: read straight up to
                the price to see what happened next. Every date is rebuilt with no look-ahead, one sample ≈{' '}
                {data?.stepDays ?? '—'} days
                {data?.coarse ? ' — samples between those dates are not shown, so very short phases can be missed' : ''}.
              </p>

              {summary.rows.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wider">Time spent</span>
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
