'use client';

import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
} from 'recharts';
import { DetailModal } from './DetailModal';
import { TimeframeSelector } from './TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from './ChartTools';
import { LoadingSpinner } from './LoadingSpinner';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import { PHASE_META, RotationPhase } from '@/lib/rotationPhase';

// Price ABOVE, the model's quadrant position through time BELOW, on a shared time
// axis — so "the model called this Recovering here" can be read against what the
// price actually did next. The scores come from /api/asset-quadrant, which runs
// the SAME pipeline as the live Rotation Quadrant; the formula lives in one place.

interface QPoint { date: string; score: number; r3m: number; phase: string | null; close: number | null }
interface Payload { price: HistoricalPoint[]; points: QPoint[]; stepDays: number; universeSize: number }

const TF_OPTIONS: Timeframe[] = ['1D', '1M', '3M', '6M', 'MTD', 'YTD', '5Y'];

const phaseColor = (p: string | null | undefined): string =>
  p && PHASE_META[p as RotationPhase] ? PHASE_META[p as RotationPhase].dot : '#6b7280';

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const st = stocks?.length ? `&stocks=${encodeURIComponent(stocks.join(','))}` : '';
    fetch(`/api/asset-quadrant?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}${st}`)
      .then(r => r.json())
      .then((j: Payload & { error?: string }) => {
        if (cancelled) return;
        if (j.error || !j.price?.length) { setError('No history for this asset over this window.'); setData(null); }
        else setData(j);
      })
      .catch(() => { if (!cancelled) setError('Could not load the quadrant history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, timeframe, stocks]);

  // Price series trimmed to a drag-selected range, so both charts stay in step.
  const price = useMemo(() => {
    const all = data?.price ?? [];
    if (!customRange) return all;
    return all.filter(p => p.date >= customRange.from && p.date <= customRange.to);
  }, [data, customRange]);

  const points = useMemo(() => {
    const all = data?.points ?? [];
    if (!customRange) return all;
    return all.filter(p => p.date >= customRange.from && p.date <= customRange.to);
  }, [data, customRange]);

  // Phase runs: consecutive steps sharing a phase become one shaded band, and the
  // start of each run is where the model CHANGED its mind — the line to read the
  // price against.
  const runs = useMemo(() => {
    const out: { from: string; to: string; phase: string | null }[] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && last.phase === p.phase) last.to = p.date;
      else out.push({ from: p.date, to: p.date, phase: p.phase });
    }
    return out;
  }, [points]);
  const transitions = runs.slice(1).map(r => r.from);

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of points) if (p.phase) counts.set(p.phase, (counts.get(p.phase) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [points]);

  return (
    <DetailModal onClose={onClose}>
      <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white">{name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {symbol}{group ? ` · ${group}` : ''} · price vs the model&apos;s quadrant call
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
          <TimeframeSelector
            value={timeframe}
            options={TF_OPTIONS}
            onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
            isCustom={!!customRange}
            onCustomRange={(from, to) => setCustomRange({ from, to })}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-56"><LoadingSpinner size={28} /></div>
        ) : error ? (
          <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">⚠ {error}</p>
        ) : (
          <>
            {/* PRICE — same chart component (and tools) as everywhere else. */}
            <PriceChart
              data={price}
              symbol={symbol}
              color="auto"
              height={210}
              toolsOverlay={activeTools}
              onSetRange={(from, to) => setCustomRange({ from, to })}
            />

            {/* QUADRANT POSITION — shares the price chart's time axis. */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] font-medium text-gray-400">Model quadrant over time</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(PHASE_META).map(([k, m]) => (
                    <span key={k} className="flex items-center gap-1 text-[9px] text-gray-500">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.dot }} />{m.label}
                    </span>
                  ))}
                </div>
              </div>

              <ResponsiveContainer width="100%" height={150}>
                <ComposedChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  {/* One shaded band per phase run — the model's regime, in colour. */}
                  {runs.map((r, i) => (
                    <ReferenceArea
                      key={`run-${i}`} x1={r.from} x2={r.to}
                      fill={phaseColor(r.phase)} fillOpacity={0.16} stroke="none"
                    />
                  ))}
                  {/* Dashed line at every phase change — read straight up to the price. */}
                  {transitions.map(d => (
                    <ReferenceLine key={`tr-${d}`} x={d} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.55} />
                  ))}
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={40} />
                  <YAxis
                    domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
                    tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={30}
                  />
                  {/* 50 = the quadrant's horizontal split. */}
                  <ReferenceLine y={50} stroke="#64748b" strokeDasharray="4 2" strokeWidth={1.2} />
                  <Area type="monotone" dataKey="score" stroke="none" fill="#6366f1" fillOpacity={0.12} />
                  <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: 8, color: '#e2e8f0', fontSize: 11 }}
                    formatter={(v: number, _n: string, p: { payload?: QPoint }) => {
                      const pt = p?.payload;
                      return [`score ${v} · 3M ${pt?.r3m != null ? `${pt.r3m >= 0 ? '+' : ''}${pt.r3m.toFixed(1)}%` : '—'} · ${pt?.phase ?? '—'}`, 'Model'];
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>

              <p className="text-[9px] text-gray-600 leading-snug">
                Score = the model&apos;s percentile against the whole universe on that date (above 50 = top half);
                the band colours the resulting quadrant. Dashed lines mark where the call changed — look straight up
                to see what the price did next. Rebuilt as of each date with no look-ahead, one step ≈ {data?.stepDays ?? '—'} days.
              </p>

              {summary.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wider">Time spent</span>
                  {summary.map(([ph, n]) => (
                    <span key={ph} className={clsx('text-[9px] px-1.5 py-0.5 rounded', PHASE_META[ph as RotationPhase]?.cls)}>
                      {ph} {Math.round((n / points.length) * 100)}%
                    </span>
                  ))}
                </div>
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
