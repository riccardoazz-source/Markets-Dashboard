'use client';

import { useState, useMemo } from 'react';
import { HistoricalPoint } from '@/lib/types';
import { Calculator, TrendingUp, Sigma, ArrowUpDown } from 'lucide-react';
import clsx from 'clsx';

export interface ActiveTools {
  avg: boolean;
  stdDev: boolean;
  minMax: boolean;
}

export const DEFAULT_TOOLS: ActiveTools = { avg: false, stdDev: false, minMax: false };

interface Props {
  data: HistoricalPoint[];
  activeTools: ActiveTools;
  onChange: (tools: ActiveTools) => void;
  decimals?: number;
}

function computeStats(data: HistoricalPoint[]) {
  const closes = data
    .map(d => d.close)
    .filter((c): c is number => typeof c === 'number' && isFinite(c));
  if (closes.length < 2) return null;

  const avg = closes.reduce((s, v) => s + v, 0) / closes.length;
  const variance = closes.reduce((s, v) => s + (v - avg) ** 2, 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  // Annualized volatility from daily log returns (assumes daily data)
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0)
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  let annualVol: number | null = null;
  if (logReturns.length > 1) {
    const lrMean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const lrVar = logReturns.reduce((s, v) => s + (v - lrMean) ** 2, 0) / (logReturns.length - 1);
    annualVol = Math.sqrt(lrVar * 252) * 100;
  }

  // Max drawdown over the period
  let maxDrawdown = 0;
  let peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = peak > 0 ? (peak - c) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return { avg, stdDev, sdUpper: avg + stdDev, sdLower: avg - stdDev, min, max, annualVol, maxDrawdown };
}

export function ChartTools({ data, activeTools, onChange, decimals = 2 }: Props) {
  const [open, setOpen] = useState(false);
  const stats = useMemo(() => computeStats(data), [data]);

  const toggle = (key: keyof ActiveTools) =>
    onChange({ ...activeTools, [key]: !activeTools[key] });

  const activeCount = Object.values(activeTools).filter(Boolean).length;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-input text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Calculator size={13} />
          Tools
          {activeCount > 0 && (
            <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-[10px] text-gray-600">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="px-3 py-3 space-y-3 bg-bg-card">
          {!stats ? (
            <p className="text-xs text-gray-600 italic">No data available.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <ToolBtn
                  active={activeTools.avg}
                  onToggle={() => toggle('avg')}
                  icon={<TrendingUp size={11} />}
                  label="Average"
                  color="amber"
                  sub={activeTools.avg ? stats.avg.toFixed(decimals) : 'Mean line'}
                />
                <ToolBtn
                  active={activeTools.stdDev}
                  onToggle={() => toggle('stdDev')}
                  icon={<Sigma size={11} />}
                  label="Std Dev"
                  color="sky"
                  sub={activeTools.stdDev ? `±${stats.stdDev.toFixed(decimals)}` : 'Mean ± 1σ'}
                />
                <ToolBtn
                  active={activeTools.minMax}
                  onToggle={() => toggle('minMax')}
                  icon={<ArrowUpDown size={11} />}
                  label="Min / Max"
                  color="violet"
                  sub={activeTools.minMax
                    ? `${stats.min.toFixed(decimals)} – ${stats.max.toFixed(decimals)}`
                    : 'Period range'}
                />
              </div>

              <div className="border-t border-border/40 pt-2.5">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-semibold">Statistics</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2">
                  <MiniStat label="Mean" value={stats.avg.toFixed(decimals)} />
                  <MiniStat label="Std Dev (σ)" value={stats.stdDev.toFixed(decimals)} />
                  <MiniStat label="Period Low" value={stats.min.toFixed(decimals)} />
                  <MiniStat label="Period High" value={stats.max.toFixed(decimals)} />
                  {stats.annualVol != null && (
                    <MiniStat label="Ann. Volatility" value={`${stats.annualVol.toFixed(1)}%`} />
                  )}
                  <MiniStat
                    label="Max Drawdown"
                    value={`-${(stats.maxDrawdown * 100).toFixed(1)}%`}
                    color="text-down-text"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  active, onToggle, icon, label, color, sub,
}: {
  active: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  color: 'amber' | 'sky' | 'violet';
  sub: string;
}) {
  const c = {
    amber:  { border: 'border-amber-400/60',  bg: 'bg-amber-400/10',  text: 'text-amber-400'  },
    sky:    { border: 'border-sky-400/60',    bg: 'bg-sky-400/10',    text: 'text-sky-400'    },
    violet: { border: 'border-violet-400/60', bg: 'bg-violet-400/10', text: 'text-violet-400' },
  }[color];

  return (
    <button
      onClick={onToggle}
      className={clsx(
        'flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border transition-all text-left',
        active ? `${c.bg} ${c.border}` : 'border-border hover:border-border-light',
      )}
    >
      <span className={clsx('flex items-center gap-1 text-[11px] font-semibold', active ? c.text : 'text-gray-400')}>
        {icon}{label}
      </span>
      <span className={clsx('text-[10px] font-mono break-all', active ? c.text : 'text-gray-600')}>{sub}</span>
    </button>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-600">{label}</p>
      <p className={clsx('text-xs font-mono font-semibold tabular-nums', color ?? 'text-gray-300')}>{value}</p>
    </div>
  );
}
