'use client';

import { useMemo } from 'react';
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
// Every asset is plotted as a dot:
//   X = 3-month return (%) — shows where the asset has been
//   Y = acceleration score (0–100 percentile) — shows if capital is rotating IN now
//
// Quadrant split at X=0 (zero 3M return) and Y=50 (median acceleration):
//   Top-right   → Trending:   strong 3M + accelerating (confirmed uptrend)
//   Top-left    → Recovering: weak 3M but accelerating (early rotation — the target)
//   Bottom-right→ Fading:     strong 3M but slowing (watch for exit)
//   Bottom-left → Lagging:    weak + decelerating (avoid)
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
  r3m: number;       // x-axis: 3M return %
  accScore: number;  // y-axis: accPctile × 100 (0–100)
  accel?: number;    // raw acceleration in percentage points (last month vs prior two)
  r1m: number | null;
  r1y: number | null;
  isAccel: boolean;
  isSelected: boolean;
}

// Internal: r3m clamped to the visible domain (so a single outlier can't squash
// the rest against one edge), while r3m keeps the true value for the tooltip.
interface PlotAsset extends QuadrantAsset {
  r3mPlot: number;
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
  const { isAccel, isSelected } = payload;
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
  return (
    <div className="rounded-lg border border-white/10 bg-[#1e293b] px-3 py-2 text-[11px] space-y-0.5 shadow-xl">
      <p className="font-semibold" style={{ color }}>{p.name}</p>
      <p className="text-gray-400">{p.group}</p>
      <p className="text-gray-300">3M: <span className={p.r3m >= 0 ? 'text-green-400' : 'text-red-400'}>{p.r3m >= 0 ? '+' : ''}{p.r3m.toFixed(1)}%</span></p>
      {p.r1m != null && <p className="text-gray-300">1M: <span className={p.r1m >= 0 ? 'text-green-400' : 'text-red-400'}>{p.r1m >= 0 ? '+' : ''}{p.r1m.toFixed(1)}%</span></p>}
      {p.r1y != null && <p className="text-gray-300">1Y: <span className={p.r1y >= 0 ? 'text-green-400' : 'text-red-400'}>{p.r1y >= 0 ? '+' : ''}{p.r1y.toFixed(1)}%</span></p>}
      <p className="text-gray-300">Accel: <span className="text-gray-100">{p.accScore.toFixed(0)}/100</span>{p.accel != null && <span className={p.accel >= 0 ? 'text-green-400' : 'text-red-400'}> ({p.accel >= 0 ? '+' : ''}{p.accel.toFixed(1)}pp)</span>}</p>
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
      return yScale(b.accScore) - yScale(a.accScore);
    });

    const placed: Box[] = [];
    const nodes: React.ReactNode[] = [];

    for (const a of order) {
      const color = GROUP_COLORS[a.group] ?? '#6b7280';
      const cx = xScale(a.r3mPlot);
      const cy = yScale(a.accScore);
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
}

export function QuadrantChart({ assets, loading, onAssetClick }: Props) {
  // Symmetric, outlier-clamped X domain so the X=0 divider sits in the centre and
  // a lone extreme mover can't squash everyone against one edge.
  const { plot, normal, accel, labeled, xDomain } = useMemo(() => {
    if (assets.length === 0) {
      return { plot: [] as PlotAsset[], normal: [] as PlotAsset[], accel: [] as PlotAsset[], labeled: [] as PlotAsset[], xDomain: [-20, 20] as [number, number] };
    }
    const absVals = assets.map(a => Math.abs(a.r3m)).sort((x, y) => x - y);
    // 90th percentile of |r3m|, padded — the visible half-range.
    const p90 = absVals[Math.min(absVals.length - 1, Math.floor(absVals.length * 0.9))] ?? 20;
    const maxAbs = absVals[absVals.length - 1] ?? 20;
    const M = Math.max(15, Math.min(maxAbs + 6, p90 * 1.3));
    const clampEdge = M * 0.985;

    const plot: PlotAsset[] = assets.map(a => ({
      ...a,
      r3mPlot: Math.max(-clampEdge, Math.min(clampEdge, a.r3m)),
    }));
    const normal = plot.filter(a => !a.isAccel);
    const accel = plot.filter(a => a.isAccel);
    const labeled = plot.filter(a => a.isAccel || a.isSelected);
    return { plot, normal, accel, labeled, xDomain: [-M, M] as [number, number] };
  }, [assets]);

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
  const LabelLayer = makeLabelLayer(labeled);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-gray-600 px-1">
        <span>X = 3-month return · Y = acceleration vs universe (0–100)</span>
        <div className="flex items-center gap-3">
          {Object.entries(GROUP_COLORS).map(([g, c]) => (
            <span key={g} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: c }} />
              <span>{g}</span>
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
          {/* Quadrant background tints */}
          <ReferenceArea x1={0} x2={xMax} y1={50} y2={100} fill="#16a34a" fillOpacity={0.05} />
          <ReferenceArea x1={xMin} x2={0} y1={50} y2={100} fill="#3b82f6" fillOpacity={0.05} />
          <ReferenceArea x1={0} x2={xMax} y1={0} y2={50} fill="#f59e0b" fillOpacity={0.035} />
          <ReferenceArea x1={xMin} x2={0} y1={0} y2={50} fill="#ef4444" fillOpacity={0.035} />

          <CartesianGrid stroke="#1e293b" strokeDasharray="0" />
          <XAxis
            dataKey="r3mPlot"
            type="number"
            name="3M Return"
            domain={[xMin, xMax]}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`}
            label={{ value: '3M Return', position: 'insideBottom', offset: -12, fill: '#4b5563', fontSize: 10 }}
          />
          <YAxis
            dataKey="accScore"
            type="number"
            name="Acceleration"
            domain={[0, 100]}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}`}
            label={{ value: 'Accel', angle: -90, position: 'insideLeft', fill: '#4b5563', fontSize: 10 }}
            width={36}
          />

          <ReferenceLine x={0}  stroke="#334155" strokeWidth={1.5} />
          <ReferenceLine y={50} stroke="#334155" strokeWidth={1.5} />

          <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#475569' }} />

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
