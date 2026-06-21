'use client';

export interface RRGAssetData {
  symbol: string;
  name: string;
  color: string;
  positions: { date: string; rsRatio: number; rsMomentum: number }[];
}

interface RRGProps {
  assets: RRGAssetData[];
  tailWeeks?: number;
  height?: number;
}

const PADDING = { top: 40, bottom: 40, left: 50, right: 40 };

export function RelativeRotationGraph({ assets, tailWeeks = 8, height = 500 }: RRGProps) {
  const svgWidth = height; // square

  const chartWidth  = svgWidth  - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top  - PADDING.bottom;

  // Collect the last tailWeeks+1 positions from each asset to determine axis range
  const allPoints: { rsRatio: number; rsMomentum: number }[] = [];
  for (const asset of assets) {
    const tail = asset.positions.slice(-(tailWeeks + 1));
    for (const p of tail) allPoints.push(p);
  }

  if (allPoints.length === 0) return null;

  let minX = Math.min(...allPoints.map(p => p.rsRatio));
  let maxX = Math.max(...allPoints.map(p => p.rsRatio));
  let minY = Math.min(...allPoints.map(p => p.rsMomentum));
  let maxY = Math.max(...allPoints.map(p => p.rsMomentum));

  // Pad 10% each side
  const padX = Math.max((maxX - minX) * 0.1, 0.2);
  const padY = Math.max((maxY - minY) * 0.1, 0.2);
  minX -= padX; maxX += padX;
  minY -= padY; maxY += padY;

  // Ensure minimum span of 4 units on each axis, centered at 100
  if (maxX - minX < 4) { minX = Math.min(minX, 98); maxX = Math.max(maxX, 102); }
  if (maxY - minY < 4) { minY = Math.min(minY, 98); maxY = Math.max(maxY, 102); }

  const toSvgX = (v: number) => PADDING.left + (v - minX) / (maxX - minX) * chartWidth;
  const toSvgY = (v: number) => PADDING.top  + (maxY - v) / (maxY - minY) * chartHeight;

  const cx = toSvgX(100);
  const cy = toSvgY(100);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${svgWidth} ${height}`}
      className="overflow-visible"
      aria-label="Relative Rotation Graph"
    >
      {/* Quadrant backgrounds */}
      {/* Improving: x<100, y>100 — blue tint */}
      <rect
        x={PADDING.left} y={PADDING.top}
        width={cx - PADDING.left} height={cy - PADDING.top}
        fill="#1d4ed8" fillOpacity={0.08}
      />
      {/* Leading: x>100, y>100 — green tint */}
      <rect
        x={cx} y={PADDING.top}
        width={PADDING.left + chartWidth - cx} height={cy - PADDING.top}
        fill="#16a34a" fillOpacity={0.08}
      />
      {/* Weakening: x>100, y<100 — amber tint */}
      <rect
        x={cx} y={cy}
        width={PADDING.left + chartWidth - cx} height={PADDING.top + chartHeight - cy}
        fill="#d97706" fillOpacity={0.08}
      />
      {/* Lagging: x<100, y<100 — red tint */}
      <rect
        x={PADDING.left} y={cy}
        width={cx - PADDING.left} height={PADDING.top + chartHeight - cy}
        fill="#dc2626" fillOpacity={0.08}
      />

      {/* Quadrant labels */}
      <text x={cx - 6} y={PADDING.top + 14} textAnchor="end" fontSize={10} fill="#16a34a" fillOpacity={0.6} fontWeight={600}>Leading</text>
      <text x={cx + 6} y={PADDING.top + 14} textAnchor="start" fontSize={10} fill="#d97706" fillOpacity={0.6} fontWeight={600}>Weakening</text>
      <text x={cx - 6} y={PADDING.top + chartHeight - 6} textAnchor="end" fontSize={10} fill="#1d4ed8" fillOpacity={0.7} fontWeight={600}>Improving</text>
      <text x={cx + 6} y={PADDING.top + chartHeight - 6} textAnchor="start" fontSize={10} fill="#dc2626" fillOpacity={0.6} fontWeight={600}>Lagging</text>

      {/* Center crosshair */}
      <line x1={cx} y1={PADDING.top} x2={cx} y2={PADDING.top + chartHeight}
        stroke="#475569" strokeWidth={1} strokeDasharray="4 3" />
      <line x1={PADDING.left} y1={cy} x2={PADDING.left + chartWidth} y2={cy}
        stroke="#475569" strokeWidth={1} strokeDasharray="4 3" />

      {/* Axis labels */}
      <text
        x={PADDING.left + chartWidth / 2} y={PADDING.top + chartHeight + 28}
        textAnchor="middle" fontSize={9} fill="#6b7280"
      >
        ← Lagging  |  RS-Ratio  |  Leading →
      </text>
      <text
        x={14} y={PADDING.top + chartHeight / 2}
        textAnchor="middle" fontSize={9} fill="#6b7280"
        transform={`rotate(-90, 14, ${PADDING.top + chartHeight / 2})`}
      >
        ↑ Momentum ↓
      </text>

      {/* Per-asset tails and dots */}
      {assets.map(asset => {
        const tail = asset.positions.slice(-(tailWeeks + 1));
        if (tail.length === 0) return null;

        const current = tail[tail.length - 1];
        const svgCx = toSvgX(current.rsRatio);
        const svgCy = toSvgY(current.rsMomentum);
        const inRightHalf = current.rsRatio >= 100;

        const tailPoints = tail.map(p => `${toSvgX(p.rsRatio)},${toSvgY(p.rsMomentum)}`).join(' ');

        return (
          <g key={asset.symbol}>
            {/* Tail polyline — rendered as individual segments for opacity gradient */}
            {tail.length > 1 && tail.slice(0, -1).map((pt, i) => {
              const next = tail[i + 1];
              const opacity = 0.2 + (i / (tail.length - 1)) * 0.5;
              return (
                <line
                  key={i}
                  x1={toSvgX(pt.rsRatio)} y1={toSvgY(pt.rsMomentum)}
                  x2={toSvgX(next.rsRatio)} y2={toSvgY(next.rsMomentum)}
                  stroke={asset.color}
                  strokeWidth={1.5}
                  strokeOpacity={opacity}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Current position dot */}
            <circle cx={svgCx} cy={svgCy} r={7} fill={asset.color} fillOpacity={0.9} />

            {/* Label */}
            <text
              x={inRightHalf ? svgCx + 10 : svgCx - 10}
              y={svgCy + 3}
              textAnchor={inRightHalf ? 'start' : 'end'}
              fontSize={10}
              fill={asset.color}
              fontWeight={600}
            >
              {asset.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
