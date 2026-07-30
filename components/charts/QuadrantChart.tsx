'use client';

import { useMemo } from 'react';
import { quadrantPosition } from '@/lib/rotationPhase';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  Tooltip,
  Customized,
} from 'recharts';

// Rotation Quadrant chart.
//
// Every asset is plotted as a dot (see lib/rotationPhase.ts for the definition and
// the evidence behind it):
//   X = TREND GAP — how far the price is from its own 40-day trend (%), month-averaged
//   Y = MOMENTUM  — the MACD(16,35,12) histogram as % of price
//
// Both splits sit at zero:
//   Top-right   → Trending:   above its trend and still gaining ground
//   Top-left    → Recovering: below its trend but momentum has turned up — entry
//   Bottom-right→ Fading:     above its trend but momentum has turned down — exit
//   Bottom-left → Lagging:    below its trend and still losing ground — wait
//
// Accelerating names (top-8 by score) and any clicked rows are drawn bigger and
// labelled. Labels are placed by a dedicated layer that spaces them apart and
// draws a thin leader line back to the dot, so they never overlap each other.

const GROUP_COLORS: Record<string, string> = {
  Indexes:     '#3b82f6',
  Crypto:      '#f97316',
  Commodities: '#f59e0b',
  Sectors:     '#8b5cf6',
  Stocks:      '#f43f5e',
};

export interface QuadrantAsset {
  symbol: string;
  name: string;
  group: string;
  /** x-axis: % above/below its own 40-day trend, month-averaged. */
  trendGap: number;
  /** y-axis: the MACD histogram as % of price. Both axes are the
   *  asset's own absolute numbers and centred on zero, so distance from the centre
   *  is the SIZE of the swing — an index orbits small, a high-beta name wide — and
   *  every asset crosses all four quadrants. */
  momentum: number;
  /** 3M return %, tooltip only — not a coordinate any more. */
  r3m: number | null;
  /** @deprecated the old percentile Y. Only saved snapshots still carry it. */
  accScore?: number;
  r1m: number | null;
  r1y: number | null;
  isAccel: boolean;
  isSelected: boolean;
}

// Internal: the coordinates clamped to the visible domain (so a single outlier
// can't squash the rest against one edge), while the raw values stay for the
// tooltip.
interface PlotAsset extends QuadrantAsset {
  xPlot: number;
  yPlot: number;
  /** True when a search is active and this asset is not one of the traced ones. */
  dimmed?: boolean;
}

function shortName(name: string): string {
  if (name.length <= 14) return name;
  const first = name.split(/[\s&]/)[0];
  return first.length >= 4 ? first : name.slice(0, 13) + '…';
}

// Plain circle — no text. All labels are drawn by the LabelLayer below.
function QuadrantDot(props: { cx?: number; cy?: number; payload?: PlotAsset; onClick?: () => void }) {
  const { cx, cy, payload, onClick } = props;
  if (cx == null || cy == null || !payload) return null;
  const color = GROUP_COLORS[payload.group] ?? '#6b7280';
  const { isAccel, isSelected, dimmed } = payload;
  // While assets are being traced, everything else fades right back so the paths
  // are actually visible — the dots stay as faint context, not clutter.
  if (dimmed) {
    return (
      <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
        <circle cx={cx} cy={cy} r={2} fill={color} fillOpacity={0.1} />
        <circle cx={cx} cy={cy} r={8} fill="transparent" />
      </g>
    );
  }
  const r = isSelected ? 7 : isAccel ? 5 : 3.5;
  const opacity = isAccel || isSelected ? 0.95 : 0.4;
  return (
    <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {isSelected && (
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.5} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={opacity} />
      {/* Larger invisible hit area so small dots are easy to click */}
      <circle cx={cx} cy={cy} r={Math.max(r + 4, 10)} fill="transparent" />
    </g>
  );
}

interface TooltipPayload { payload: QuadrantAsset }
function QuadrantTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const color = GROUP_COLORS[p.group] ?? '#6b7280';
  // Where the dot actually is, not just which box it fell in.
  const pos = quadrantPosition(p.trendGap, p.momentum);
  return (
    <div className="rounded-lg border border-white/10 bg-[#1e293b] px-3 py-2 text-[11px] space-y-0.5 shadow-xl">
      <p className="font-semibold" style={{ color }}>{p.name}</p>
      <p className="text-gray-400">{p.group}</p>
      {p.r3m != null && <p className="text-gray-300">3M: <span className={p.r3m >= 0 ? 'text-green-400' : 'text-red-400'}>{p.r3m >= 0 ? '+' : ''}{p.r3m.toFixed(1)}%</span></p>}
      {p.r1m != null && <p className="text-gray-300">1M: <span className={p.r1m >= 0 ? 'text-green-400' : 'text-red-400'}>{p.r1m >= 0 ? '+' : ''}{p.r1m.toFixed(1)}%</span></p>}
      {p.r1y != null && <p className="text-gray-300">1Y: <span className={p.r1y >= 0 ? 'text-green-400' : 'text-red-400'}>{p.r1y >= 0 ? '+' : ''}{p.r1y.toFixed(1)}%</span></p>}
      <p className="text-gray-300">From its 40-day trend:{' '}
        <span className={p.trendGap >= 0 ? 'text-green-400' : 'text-red-400'}>
          {p.trendGap >= 0 ? '+' : ''}{p.trendGap.toFixed(2)}%
        </span>
      </p>
      <p className="text-gray-300">Momentum:{' '}
        <span className={p.momentum >= 0 ? 'text-green-400' : 'text-red-400'}>
          {p.momentum >= 0 ? '+' : ''}{p.momentum.toFixed(2)}% {p.momentum >= 0 ? '(gaining)' : '(losing)'}
        </span>
      </p>
      {pos && (
        <p className="text-gray-500">
          {pos.radius.toFixed(1)} %/mo from the centre · {pos.angle.toFixed(0)}°
        </p>
      )}
      {p.isAccel && <p className="text-green-400 font-semibold">🌱 Accelerating</p>}
    </div>
  );
}

interface Box { x1: number; y1: number; x2: number; y2: number }
function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// Recharts axis-map shape (only the bits we use).
interface AxisLike { scale?: (v: number) => number }
interface CustomizedProps {
  xAxisMap?: Record<string, AxisLike>;
  yAxisMap?: Record<string, AxisLike>;
  offset?: { top: number; left: number; width: number; height: number };
}

/** One asset's path across the quadrants, oldest point first. */
export interface QuadrantTrail {
  symbol: string;
  name: string;
  group: string;
  /** The same two coordinates the live dots use, as of each past date. */
  points: { date: string; trendGap: number; momentum: number }[];
}

// Trail layer: draws each traced asset's journey as a fading tail, oldest segment
// faintest, so direction is readable at a glance (down-left → up-right = an asset
// climbing out of Lagging). Drawn under the dots, inside the chart so it can use
// recharts' live pixel scales.
function makeTrailLayer(trails: QuadrantTrail[], clampEdge: number, clampEdgeY: number, live: Map<string, PlotAsset>) {
  return function TrailLayer(props: CustomizedProps) {
    const { xAxisMap, yAxisMap, offset } = props;
    if (!xAxisMap || !yAxisMap || !offset || trails.length === 0) return null;
    const xScale = Object.values(xAxisMap)[0]?.scale;
    const yScale = Object.values(yAxisMap)[0]?.scale;
    if (!xScale || !yScale) return null;
    const midX = offset.left + offset.width / 2;

    const nodes: React.ReactNode[] = [];
    for (const t of trails) {
      const color = GROUP_COLORS[t.group] ?? '#6b7280';
      const pts = t.points.map(p => ({
        x: xScale(Math.max(-clampEdge, Math.min(clampEdge, p.trendGap))),
        y: yScale(Math.max(-clampEdgeY, Math.min(clampEdgeY, p.momentum))),
        date: p.date,
      }));
      // The path must END on the live dot. The trail's own "today" step is
      // recomputed server-side from full history, while the dot comes from the
      // rolling-returns endpoint — near-identical but not bit-identical, which
      // left a visible gap. Replace that last step with the dot's real position
      // so the two always meet by construction.
      const dot = live.get(t.symbol);
      if (dot) {
        pts.pop();
        pts.push({ x: xScale(dot.xPlot), y: yScale(dot.yPlot), date: '' });
      }
      if (pts.length < 2) continue;

      // Include the year once the path spans more than a year, otherwise the
      // month alone is unambiguous and far less cluttered.
      // Measured on the SERVER's dates: the final plotted point is the live dot,
      // which carries no date of its own.
      const srv = t.points;
      const spanDays = (new Date(srv[srv.length - 1].date).getTime() - new Date(srv[0].date).getTime()) / 86_400_000;
      const fmtDate = (iso: string) => {
        const d = new Date(iso + 'T12:00:00Z');
        return d.toLocaleDateString('en-US', spanDays > 400
          ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
          : { month: 'short', day: 'numeric', timeZone: 'UTC' });
      };
      // Label the ends plus a few waypoints — enough to read the timing without
      // burying the chart in text.
      const every = Math.max(2, Math.ceil((pts.length - 1) / 3));
      const labelAt = (i: number) => i === 0 || i === pts.length - 1 || i % every === 0;

      for (let i = 1; i < pts.length; i++) {
        const frac = i / (pts.length - 1);          // 0 = oldest, 1 = newest
        const a = pts[i - 1], b = pts[i];
        nodes.push(
          <line
            key={`${t.symbol}-seg-${i}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={color}
            strokeWidth={1 + frac * 1.8}
            strokeOpacity={0.22 + frac * 0.6}
            strokeLinecap="round"
          />,
        );
        // Arrowhead at the segment midpoint — this is what makes the direction of
        // travel readable (a loop back on itself is otherwise indistinguishable).
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 14) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
          nodes.push(
            <path
              key={`${t.symbol}-arr-${i}`}
              d="M -3.2 -2.6 L 3.2 0 L -3.2 2.6 Z"
              transform={`translate(${mx} ${my}) rotate(${ang})`}
              fill={color} fillOpacity={0.35 + frac * 0.5}
            />,
          );
        }
      }

      // A dot per step, so the pace of the move is visible (bunched = stalled).
      // The final position is skipped: that IS the asset's live dot, already drawn
      // and already labelled with its name — a second marker and a "now" caption
      // there would just duplicate what the chart is showing.
      pts.forEach((p, i) => {
        if (i === pts.length - 1) return;
        const frac = pts.length > 1 ? i / (pts.length - 1) : 1;
        nodes.push(
          <circle
            key={`${t.symbol}-pt-${i}`}
            cx={p.x} cy={p.y} r={2}
            fill={color} fillOpacity={0.3 + frac * 0.6}
          >
            <title>{`${t.name} · ${p.date}`}</title>
          </circle>,
        );
        if (labelAt(i)) {
          // Put the text on the inward side so it never runs off the plot edge.
          const leftish = p.x < midX;
          nodes.push(
            <text
              key={`${t.symbol}-lbl-${i}`}
              x={p.x + (leftish ? 6 : -6)} y={p.y - 5}
              textAnchor={leftish ? 'start' : 'end'}
              fill={color} fillOpacity={0.55 + frac * 0.25}
              fontSize={8.5}
              style={{ paintOrder: 'stroke', stroke: '#0b1020', strokeWidth: 2.5, strokeLinejoin: 'round' }}
            >
              {fmtDate(p.date)}
            </text>,
          );
        }
      });
    }
    return <g>{nodes}</g>;
  };
}

// Dedicated label layer with collision avoidance + leader lines. Runs inside the
// chart so it can read the live pixel scales from recharts' axis maps.
function makeLabelLayer(labeled: PlotAsset[]) {
  return function LabelLayer(props: CustomizedProps) {
    const { xAxisMap, yAxisMap, offset } = props;
    if (!xAxisMap || !yAxisMap || !offset) return null;
    const xScale = Object.values(xAxisMap)[0]?.scale;
    const yScale = Object.values(yAxisMap)[0]?.scale;
    if (!xScale || !yScale) return null;

    const { left, top, width, height } = offset;
    const right = left + width;
    const bottom = top + height;
    const midX = left + width / 2;

    const LH = 13;       // label box height
    const CHAR = 5.3;    // approx px per character at 9.5px
    const GAP = 5;       // gap between dot edge and text

    // Selected first, then by vertical position so nudging is stable.
    const order = [...labeled].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return yScale(b.yPlot) - yScale(a.yPlot);
    });

    const placed: Box[] = [];
    const nodes: React.ReactNode[] = [];

    for (const a of order) {
      const color = GROUP_COLORS[a.group] ?? '#6b7280';
      const cx = xScale(a.xPlot);
      const cy = yScale(a.yPlot);
      const r = a.isSelected ? 7 : 5;
      const text = shortName(a.name);
      const w = text.length * CHAR + 4;

      // Place on the side that keeps the label inside the plot.
      const placeRight = cx <= midX;
      let anchorX = placeRight ? cx + r + GAP : cx - r - GAP;
      let labelY = cy;

      // Try the dot's own height first, then nudge vertically until free.
      const offsets = [0, -LH, LH, -2 * LH, 2 * LH, -3 * LH, 3 * LH, -4 * LH, 4 * LH];
      let chosen: Box | null = null;
      for (const dy of offsets) {
        let y = cy + dy;
        y = Math.max(top + LH / 2, Math.min(bottom - LH / 2, y));
        const box: Box = placeRight
          ? { x1: anchorX, y1: y - LH / 2, x2: anchorX + w, y2: y + LH / 2 }
          : { x1: anchorX - w, y1: y - LH / 2, x2: anchorX, y2: y + LH / 2 };
        if (box.x1 < left) { box.x1 = left; box.x2 = left + w; }
        if (box.x2 > right) { box.x2 = right; box.x1 = right - w; }
        if (!placed.some(p => overlaps(box, p))) { chosen = box; labelY = y; break; }
      }
      if (!chosen) {
        // Fallback: stack at the first free slot scanning downward.
        let y = top + LH / 2;
        while (y < bottom) {
          const box: Box = { x1: anchorX, y1: y - LH / 2, x2: anchorX + w, y2: y + LH / 2 };
          if (!placed.some(p => overlaps(box, p))) { chosen = box; labelY = y; break; }
          y += LH;
        }
        if (!chosen) chosen = { x1: anchorX, y1: cy - LH / 2, x2: anchorX + w, y2: cy + LH / 2 };
      }
      placed.push(chosen);

      const textX = placeRight ? chosen.x1 : chosen.x2;
      const textAnchor = placeRight ? 'start' : 'end';
      // Leader line: from dot edge to the label, only when the label moved.
      const moved = Math.abs(labelY - cy) > 2;
      const lineEndX = placeRight ? chosen.x1 - 2 : chosen.x2 + 2;

      nodes.push(
        <g key={a.symbol}>
          {moved && (
            <line
              x1={cx + (placeRight ? r : -r)}
              y1={cy}
              x2={lineEndX}
              y2={labelY}
              stroke={color}
              strokeOpacity={0.35}
              strokeWidth={0.75}
            />
          )}
          <text
            x={textX}
            y={labelY + 3.3}
            fontSize={9.5}
            fontWeight={a.isSelected ? 600 : 400}
            fill={color}
            fillOpacity={0.95}
            textAnchor={textAnchor}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {text}
          </text>
        </g>
      );
    }

    // Quadrant names parked in the true corners, very faint.
    const corner = (txt: string, x: number, y: number, anchor: 'start' | 'end', fill: string) => (
      <text x={x} y={y} fontSize={10.5} fontStyle="italic" fill={fill} fillOpacity={0.6} textAnchor={anchor}
        style={{ pointerEvents: 'none', userSelect: 'none' }}>{txt}</text>
    );

    return (
      <g>
        {corner('Recovering', left + 6, top + 14, 'start', '#60a5fa')}
        {corner('Trending', right - 6, top + 14, 'end', '#22c55e')}
        {corner('Lagging', left + 6, bottom - 8, 'start', '#f87171')}
        {corner('Fading', right - 6, bottom - 8, 'end', '#d97706')}
        {nodes}
      </g>
    );
  };
}

interface Props {
  assets: QuadrantAsset[];
  loading?: boolean;
  onAssetClick?: (asset: QuadrantAsset) => void;
  /** Historical paths to overlay — one per traced asset, oldest point first. */
  trails?: QuadrantTrail[];
  /** When non-empty, only these assets stay lit; everything else fades back. */
  focusSymbols?: string[];
}

export function QuadrantChart({ assets, loading, onAssetClick, trails, focusSymbols }: Props) {
  // BOTH domains are symmetric around zero and outlier-clamped, so the crosshair
  // of the quadrant sits in the middle and a lone extreme mover cannot squash
  // everyone else onto the axes. Symmetry is what makes "distance from the centre"
  // readable as the size of an asset's swing.
  const { plot, normal, accel, labeled, xDomain, yDomain, clampEdge, clampEdgeY } = useMemo(() => {
    if (assets.length === 0) {
      return {
        plot: [] as PlotAsset[], normal: [] as PlotAsset[], accel: [] as PlotAsset[], labeled: [] as PlotAsset[],
        xDomain: [-5, 5] as [number, number], yDomain: [-1.5, 1.5] as [number, number],
        clampEdge: 4.93, clampEdgeY: 1.48,
      };
    }
    // Half-range for one axis: the 90th percentile of |value| padded out, but never
    // smaller than `floor` and never cutting a trail off screen.
    const halfRange = (vals: number[], floor: number, pad: number, trailVals: number[]) => {
      const abs = vals.filter(v => isFinite(v)).map(Math.abs).sort((a, b) => a - b);
      const p90 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))] ?? floor;
      const maxAbs = abs[abs.length - 1] ?? floor;
      const trailMax = trailVals.length ? Math.max(...trailVals.map(Math.abs)) : 0;
      return Math.max(floor, Math.min(Math.max(maxAbs, trailMax) + pad, Math.max(p90 * 1.3, trailMax * 1.05)));
    };
    // Both axes are in % of price, and they live on different scales: the gap to the
    // 40-day trend runs to a few points, the MACD histogram rarely past ±2%.
    const M = halfRange(
      assets.map(a => a.trendGap), 4, 1.5,
      trails?.flatMap(t => t.points.map(p => p.trendGap)) ?? [],
    );
    const MY = halfRange(
      assets.map(a => a.momentum), 1, 0.4,
      trails?.flatMap(t => t.points.map(p => p.momentum)) ?? [],
    );
    const clampEdge = M * 0.985;
    const clampEdgeY = MY * 0.985;

    // A search in Rotation focuses the chart: only the searched assets stay lit
    // and labelled, everything else fades to faint context. Clearing the search
    // brings the whole universe back.
    const focus = new Set(focusSymbols ?? []);
    const focusing = focus.size > 0;

    const plot: PlotAsset[] = assets.map(a => ({
      ...a,
      xPlot: Math.max(-clampEdge, Math.min(clampEdge, a.trendGap)),
      yPlot: Math.max(-clampEdgeY, Math.min(clampEdgeY, a.momentum)),
      dimmed: focusing && !focus.has(a.symbol),
    }));
    const normal = plot.filter(a => !a.isAccel);
    const accel = plot.filter(a => a.isAccel);
    const labeled = focusing
      ? plot.filter(a => focus.has(a.symbol))
      : plot.filter(a => a.isAccel || a.isSelected);
    return {
      plot, normal, accel, labeled,
      xDomain: [-M, M] as [number, number], yDomain: [-MY, MY] as [number, number],
      clampEdge, clampEdgeY,
    };
  }, [assets, trails, focusSymbols]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px] text-[11px] text-gray-600">
        Loading leaderboard…
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-[11px] text-gray-500">
        Waiting for rolling-return data…
      </div>
    );
  }

  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;
  const LabelLayer = makeLabelLayer(labeled);
  // Live dot positions, so each trail can terminate exactly on its asset's dot.
  const TrailLayer = makeTrailLayer(trails ?? [], clampEdge, clampEdgeY, new Map(plot.map(a => [a.symbol, a])));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-gray-600 px-1">
        <span>X = 3-month return · Y = model score vs universe (0–100)</span>
        <div className="flex items-center gap-3">
          {Object.entries(GROUP_COLORS).map(([g, c]) => (
            <span key={g} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: c }} />
              <span>{g}</span>
            </span>
          ))}
        </div>
      </div>
      {trails && trails.length > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] px-1 pb-0.5">
          <span className="text-gray-600">Trail: faint → solid = past → now, arrows show direction</span>
          {trails.map(t => {
            const c = GROUP_COLORS[t.group] ?? '#6b7280';
            const from = t.points[0]?.date;
            // Day-level start date — a "2026-07 → 2026-07" range said nothing on
            // the shorter windows, where the whole path sits inside one month.
            const fromLabel = from
              ? new Date(from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
              : '';
            return (
              <span key={t.symbol} className="flex items-center gap-1" style={{ color: c }}>
                <span className="inline-block w-3 border-t-2" style={{ borderColor: c }} />
                {t.name}
                <span className="text-gray-600">from {fromLabel} · {t.points.length} steps</span>
              </span>
            );
          })}
        </div>
      )}
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
          {/* Quadrant background tints — both splits now sit at zero. */}
          <ReferenceArea x1={0} x2={xMax} y1={0} y2={yMax} fill="#16a34a" fillOpacity={0.05} />
          <ReferenceArea x1={xMin} x2={0} y1={0} y2={yMax} fill="#3b82f6" fillOpacity={0.05} />
          <ReferenceArea x1={0} x2={xMax} y1={yMin} y2={0} fill="#f59e0b" fillOpacity={0.035} />
          <ReferenceArea x1={xMin} x2={0} y1={yMin} y2={0} fill="#ef4444" fillOpacity={0.035} />

          <CartesianGrid stroke="#1e293b" strokeDasharray="0" />
          <XAxis
            dataKey="xPlot"
            type="number"
            name="Trend gap"
            domain={[xMin, xMax]}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(1)}%`}
            label={{ value: 'Distance from its 40-day trend (%)', position: 'insideBottom', offset: -12, fill: '#4b5563', fontSize: 10 }}
          />
          <YAxis
            dataKey="yPlot"
            type="number"
            name="Momentum"
            domain={[yMin, yMax]}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(1)}`}
            label={{ value: 'Momentum — MACD histogram (%)', angle: -90, position: 'insideLeft', fill: '#4b5563', fontSize: 10 }}
            width={36}
          />

          <ReferenceLine x={0}  stroke="#334155" strokeWidth={1.5} />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1.5} />

          <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#475569' }} />

          {/* Trails first, so today's dots stay on top of the path. */}
          <Customized component={TrailLayer} />

          <Scatter
            data={normal}
            shape={(props: { cx?: number; cy?: number; payload?: PlotAsset }) => (
              <QuadrantDot
                {...props}
                onClick={props.payload && onAssetClick ? () => onAssetClick(props.payload!) : undefined}
              />
            )}
            isAnimationActive={false}
          />
          <Scatter
            data={accel}
            shape={(props: { cx?: number; cy?: number; payload?: PlotAsset }) => (
              <QuadrantDot
                {...props}
                onClick={props.payload && onAssetClick ? () => onAssetClick(props.payload!) : undefined}
              />
            )}
            isAnimationActive={false}
          />

          {/* Labels drawn last so they sit above every dot. */}
          <Customized component={LabelLayer} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
