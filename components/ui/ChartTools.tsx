'use client';

import { useState, useMemo } from 'react';
import { HistoricalPoint } from '@/lib/types';
import { Calculator, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

export interface ActiveTools {
  avg: boolean;
  stdDev: boolean;
  minMax: boolean;
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  ema20: boolean;
  bollinger: boolean;
  fib: boolean;
  rsi: boolean;
  macd: boolean;
}

export const DEFAULT_TOOLS: ActiveTools = {
  avg: false, stdDev: false, minMax: false,
  sma20: false, sma50: false, sma200: false, ema20: false,
  bollinger: false, fib: false, rsi: false, macd: false,
};

interface Props {
  data: HistoricalPoint[];
  activeTools: ActiveTools;
  onChange: (tools: ActiveTools) => void;
  decimals?: number;
}

function computeStats(closes: number[]) {
  if (closes.length < 2) return null;
  const avg = closes.reduce((s, v) => s + v, 0) / closes.length;
  const variance = closes.reduce((s, v) => s + (v - avg) ** 2, 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

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

  let maxDrawdown = 0, peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = peak > 0 ? (peak - c) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return { avg, stdDev, sdUpper: avg + stdDev, sdLower: avg - stdDev, min, max, annualVol, maxDrawdown };
}

export function ChartTools({ data, activeTools, onChange, decimals = 2 }: Props) {
  const [open, setOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const closes = useMemo(
    () => data.map(d => d.close).filter((c): c is number => typeof c === 'number' && isFinite(c)),
    [data],
  );
  const stats = useMemo(() => computeStats(closes), [closes]);
  const n = closes.length;

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
        <div className="px-3 py-2 space-y-2 bg-bg-card">
          {!stats ? (
            <p className="text-xs text-gray-600 italic">No data available.</p>
          ) : (
            <>
              {/* All tools in a compact single flex-wrap row */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <ToolChip active={activeTools.avg}     onToggle={() => toggle('avg')}     label="Avg"      color="amber"  />
                <ToolChip active={activeTools.stdDev}  onToggle={() => toggle('stdDev')}  label="Std Dev"  color="sky"    />
                <ToolChip active={activeTools.minMax}  onToggle={() => toggle('minMax')}  label="Min/Max"  color="violet" />

                <Divider />

                <ToolChip active={activeTools.sma20}   onToggle={() => toggle('sma20')}   label="SMA 20"   color="cyan"   disabled={n < 20}  />
                <ToolChip active={activeTools.ema20}   onToggle={() => toggle('ema20')}   label="EMA 20"   color="rose"   disabled={n < 20}  />
                <ToolChip active={activeTools.sma50}   onToggle={() => toggle('sma50')}   label="SMA 50"   color="orange" disabled={n < 50}  />
                <ToolChip active={activeTools.sma200}  onToggle={() => toggle('sma200')}  label="SMA 200"  color="purple" disabled={n < 200} />

                <Divider />

                <ToolChip active={activeTools.bollinger} onToggle={() => toggle('bollinger')} label="Bollinger" color="teal"   disabled={n < 20} />
                <ToolChip active={activeTools.fib}       onToggle={() => toggle('fib')}       label="Fibonacci" color="yellow" disabled={n < 2}  />

                <Divider />

                <ToolChip active={activeTools.rsi}  onToggle={() => toggle('rsi')}  label="RSI 14" color="indigo" disabled={n < 15} />
                <ToolChip active={activeTools.macd} onToggle={() => toggle('macd')} label="MACD"   color="green"  disabled={n < 34} />
              </div>

              {/* Statistics — collapsed by default */}
              <div>
                <button
                  onClick={() => setStatsOpen(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <ChevronDown
                    size={10}
                    className={clsx('transition-transform duration-150', statsOpen && 'rotate-180')}
                  />
                  Statistics
                </button>
                {statsOpen && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1.5 mt-1.5 pt-1.5 border-t border-border/30">
                    <MiniStat label="Mean"     value={stats.avg.toFixed(decimals)} />
                    <MiniStat label="Std Dev"  value={stats.stdDev.toFixed(decimals)} />
                    <MiniStat label="Low"      value={stats.min.toFixed(decimals)} />
                    <MiniStat label="High"     value={stats.max.toFixed(decimals)} />
                    {stats.annualVol != null && (
                      <MiniStat label="Ann. Vol" value={`${stats.annualVol.toFixed(1)}%`} />
                    )}
                    <MiniStat label="Max DD" value={`-${(stats.maxDrawdown * 100).toFixed(1)}%`} color="text-down-text" />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Divider() {
  return <span className="w-px h-4 bg-border/50 mx-0.5 self-center shrink-0" />;
}

const COLOR_MAP = {
  amber:  { border: 'border-amber-400/60',  bg: 'bg-amber-400/10',  text: 'text-amber-400'  },
  sky:    { border: 'border-sky-400/60',    bg: 'bg-sky-400/10',    text: 'text-sky-400'    },
  violet: { border: 'border-violet-400/60', bg: 'bg-violet-400/10', text: 'text-violet-400' },
  orange: { border: 'border-orange-400/60', bg: 'bg-orange-400/10', text: 'text-orange-400' },
  purple: { border: 'border-purple-400/60', bg: 'bg-purple-400/10', text: 'text-purple-400' },
  indigo: { border: 'border-indigo-400/60', bg: 'bg-indigo-400/10', text: 'text-indigo-400' },
  green:  { border: 'border-emerald-400/60',bg: 'bg-emerald-400/10',text: 'text-emerald-400'},
  cyan:   { border: 'border-cyan-400/60',   bg: 'bg-cyan-400/10',   text: 'text-cyan-400'   },
  rose:   { border: 'border-rose-400/60',   bg: 'bg-rose-400/10',   text: 'text-rose-400'   },
  teal:   { border: 'border-teal-400/60',   bg: 'bg-teal-400/10',   text: 'text-teal-400'   },
  yellow: { border: 'border-yellow-400/60', bg: 'bg-yellow-400/10', text: 'text-yellow-400' },
} as const;

type ColorKey = keyof typeof COLOR_MAP;

function ToolChip({
  active, onToggle, label, color, disabled = false,
}: {
  active: boolean; onToggle: () => void;
  label: string; color: ColorKey; disabled?: boolean;
}) {
  const c = COLOR_MAP[color];
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className={clsx(
        'px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-all whitespace-nowrap',
        disabled
          ? 'border-border text-gray-700 opacity-40 cursor-not-allowed'
          : active
            ? `${c.bg} ${c.border} ${c.text}`
            : 'border-border text-gray-500 hover:text-gray-300 hover:border-border-light',
      )}
    >
      {label}
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
