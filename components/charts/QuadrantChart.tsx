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
  Tooltip,
} from 'recharts';

// Rotation Quadrant chart — replaces the normalized line chart.
//
// Every asset is plotted as a dot:
//   X = 3-month return (%) — shows where the asset has been
//   Y = acceleration score (0–100 percentile) — shows if capital is rotating IN now
//
// Quadrant split at X=0 (zero 3M return) and Y=50 (median acceleration):
//   Top-right  → Trending:   strong 3M + accelerating (confirmed uptrend)
//   Top-left   → Recovering: weak 3M but accelerating (early rotation — the target)
//   Bottom-right→ Fading:    strong 3M but slowing (watch for exit)
//   Bottom-left → Lagging:   weak + decelerating (avoid)
//
// Accelerating names (top-8 by score) are shown bigger with labels.
// Clicking a row in the table highlights the dot here.

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
  r1m: number | null;
  r1y: number | null;
  isAccel: boolean;
  isSelected: boolean;
}

function shortName(name: string): string {
  if (name.length <= 14) return name;
  // Use first word if it's meaningful
  const first = name.split(/[\s&]/)[0];
  return first.length >= 4 ? first : name.slice(0, 13) + '…';
}

// Custom scatter dot — big + labeled for accel/selected, tiny + dim otherwise.
function QuadrantDot(props: { cx?: number; cy?: number; payload?: QuadrantAsset }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const color = GROUP_COLORS[payload.group] ?? '#6b7280';
  const { isAccel, isSelected } = payload;
  const r = isSelected ? 6 : isAccel ? 4.5 : 2.5;
  const opacity = isAccel || isSelected ? 0.9 : 0.3;
  const label = shortName(payload.name);
  return (
    <g>
      {isSelected && (
        <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.45} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={opacity} />
      {(isAccel || isSelected) && (
        <text
          x={cx + r + 4}
          y={cy + 3.5}
          fontSize={9}
          fill={color}
          fillOpacity={0.85}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {label}
        </text>
      )}
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
      <p className="text-gray-300">Accel: <span className="text-gray-100">{p.accScore.toFixed(0)}/100</span></p>
      {p.isAccel && <p className="text-green-400 font-semibold">🌱 Accelerating</p>}
    </div>
  );
}

// Faint quadrant-label overlay rendered via a custom chart layer.
function QuadrantLabels({
  xScale, yScale, width, height,
}: {
  xScale: (v: number) => number;
  yScale: (v: number) => number;
  width: number;
  height: number;
}) {
  const cx0 = xScale(0);
  const cy50 = yScale(50);
  const labels = [
    { text: 'Recovering', x: cx0 / 2,              y: height * 0.15, anchor: 'middle' },
    { text: 'Trending',   x: (cx0 + width) / 2,    y: height * 0.15, anchor: 'middle' },
    { text: 'Lagging',    x: cx0 / 2,              y: height * 0.9,  anchor: 'middle' },
    { text: 'Fading',     x: (cx0 + width) / 2,    y: height * 0.9,  anchor: 'middle' },
  ];
  return (
    <g pointerEvents="none">
      {labels.map(l => (
        <text
          key={l.text}
          x={l.x}
          y={l.y}
          textAnchor={l.anchor as 'middle'}
          fontSize={10}
          fill="#334155"
          fontStyle="italic"
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}

interface Props {
  assets: QuadrantAsset[];
  loading?: boolean;
}

export function QuadrantChart({ assets, loading }: Props) {
  // Separate accel (drawn last so they appear on top) from normal dots.
  const { normal, accel } = useMemo(() => {
    const normal: QuadrantAsset[] = [];
    const accel: QuadrantAsset[] = [];
    for (const a of assets) {
      (a.isAccel ? accel : normal).push(a);
    }
    return { normal, accel };
  }, [assets]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[320px] text-[11px] text-gray-600">
        Loading leaderboard…
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center h-[320px] text-[11px] text-gray-500">
        Waiting for rolling-return data…
      </div>
    );
  }

  const allX = assets.map(a => a.r3m);
  const xPad = 8;
  const xMin = Math.min(...allX) - xPad;
  const xMax = Math.max(...allX) + xPad;

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
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="0" />
          <XAxis
            dataKey="r3m"
            type="number"
            name="3M Return"
            domain={[xMin, xMax]}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`}
            label={{ value: '3M Return', position: 'insideBottom', offset: -10, fill: '#4b5563', fontSize: 10 }}
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
          <ReferenceLine x={0}  stroke="#334155" strokeWidth={1} />
          <ReferenceLine y={50} stroke="#334155" strokeWidth={1} />
          <Tooltip
            content={<QuadrantTooltip />}
            cursor={false}
          />
          <Scatter
            data={normal}
            shape={(props: { cx?: number; cy?: number; payload?: QuadrantAsset }) => <QuadrantDot {...props} />}
            isAnimationActive={false}
          />
          <Scatter
            data={accel}
            shape={(props: { cx?: number; cy?: number; payload?: QuadrantAsset }) => <QuadrantDot {...props} />}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
