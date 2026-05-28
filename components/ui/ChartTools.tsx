'use client';

import { useState, useMemo } from 'react';
import { HistoricalPoint } from '@/lib/types';
import { Calculator, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  computeBollingerBands, computeFibLevels, computeMomentum,
} from '@/lib/indicators';

export interface ActiveTools {
  avg: boolean;
  stdDev: boolean;
  minMax: boolean;
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  ema20: boolean;
  ema100: boolean;
  bollinger: boolean;
  fib: boolean;
  rsi: boolean;
  macd: boolean;
  momentumDaily: boolean;
  momentumWeekly: boolean;
  momentumMonthly: boolean;
  spyRatio: boolean;
}

export const DEFAULT_TOOLS: ActiveTools = {
  avg: false, stdDev: false, minMax: false,
  sma20: false, sma50: false, sma200: false, ema20: false, ema100: false,
  bollinger: false, fib: false, rsi: false, macd: false,
  momentumDaily: false, momentumWeekly: false, momentumMonthly: false,
  spyRatio: false,
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

  return { avg, stdDev, min, max, annualVol, maxDrawdown };
}

/** Last non-null value from an array. */
const last = <T,>(arr: (T | null)[]): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
};

export function ChartTools({ data, activeTools, onChange, decimals = 2 }: Props) {
  const [open, setOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const closes = useMemo(
    () => data.map(d => d.close).filter((c): c is number => typeof c === 'number' && isFinite(c)),
    [data],
  );
  const stats = useMemo(() => computeStats(closes), [closes]);
  const n = closes.length;

  // Pre-compute all indicator current values once per data change
  const iv = useMemo(() => {
    if (closes.length === 0) return null;
    const sma50arr  = n >= 50  ? computeSMA(closes, 50)  : null;
    const sma200arr = n >= 200 ? computeSMA(closes, 200) : null;
    const sma50val  = sma50arr  ? last(sma50arr)  : null;
    const sma200val = sma200arr ? last(sma200arr) : null;
    const bbands    = n >= 20  ? computeBollingerBands(closes, 20, 2) : null;
    const macdOut   = n >= 34  ? computeMACD(closes) : null;
    return {
      sma20:   n >= 20  ? last(computeSMA(closes, 20))  : null,
      ema20:   n >= 20  ? last(computeEMA(closes, 20))   : null,
      ema100:  n >= 100 ? last(computeEMA(closes, 100))  : null,
      sma50:   sma50val,
      sma200:  sma200val,
      cross:   sma50val != null && sma200val != null
                 ? (sma50val > sma200val ? 'golden' : 'death') as 'golden' | 'death'
                 : null,
      bbUpper: bbands ? last(bbands.upper) : null,
      bbLower: bbands ? last(bbands.lower) : null,
      rsi:              n >= 15 ? last(computeRSI(closes, 14))       : null,
      macd:             macdOut ? last(macdOut.macd)                  : null,
      signal:           macdOut ? last(macdOut.signal)                : null,
      hist:             macdOut ? last(macdOut.hist)                  : null,
      fibs:             n >= 2  ? computeFibLevels(closes)            : null,
      momentumDaily:    n >= 2  ? last(computeMomentum(closes, 1))   : null,
      momentumWeekly:   n >= 6  ? last(computeMomentum(closes, 5))   : null,
      momentumMonthly:  n >= 22 ? last(computeMomentum(closes, 21))  : null,
    };
  }, [closes, n]);

  const toggle = (key: keyof ActiveTools) =>
    onChange({ ...activeTools, [key]: !activeTools[key] });

  const activeCount = Object.values(activeTools).filter(Boolean).length;
  const showResults = activeCount > 0 && stats != null && iv != null;

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
              {/* ── Compact chip toggles ────────────────────────────────── */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <ToolChip active={activeTools.spyRatio} onToggle={() => toggle('spyRatio')} label="vs SPY" color="slate" />
                <Divider />
                <ToolChip active={activeTools.avg}     onToggle={() => toggle('avg')}     label="Avg"      color="amber"  />
                <ToolChip active={activeTools.stdDev}  onToggle={() => toggle('stdDev')}  label="Std Dev"  color="sky"    />
                <ToolChip active={activeTools.minMax}  onToggle={() => toggle('minMax')}  label="Min/Max"  color="violet" />
                <Divider />
                <ToolChip active={activeTools.sma20}   onToggle={() => toggle('sma20')}   label="SMA 20"   color="cyan"   disabled={n < 20}  />
                <ToolChip active={activeTools.ema20}   onToggle={() => toggle('ema20')}   label="EMA 20"   color="rose"   disabled={n < 20}  />
                <ToolChip active={activeTools.ema100}  onToggle={() => toggle('ema100')}  label="EMA 100"  color="rose"   disabled={n < 100} />
                <ToolChip active={activeTools.sma50}   onToggle={() => toggle('sma50')}   label="SMA 50"   color="orange" disabled={n < 50}  />
                <ToolChip active={activeTools.sma200}  onToggle={() => toggle('sma200')}  label="SMA 200"  color="purple" disabled={n < 200} />
                <Divider />
                <ToolChip active={activeTools.bollinger} onToggle={() => toggle('bollinger')} label="Bollinger" color="teal"   disabled={n < 20} />
                <ToolChip active={activeTools.fib}       onToggle={() => toggle('fib')}       label="Fibonacci" color="yellow" disabled={n < 2}  />
                <Divider />
                <ToolChip active={activeTools.rsi}  onToggle={() => toggle('rsi')}  label="RSI 14" color="indigo" disabled={n < 15} />
                <ToolChip active={activeTools.macd} onToggle={() => toggle('macd')} label="MACD"   color="green"  disabled={n < 34} />
                <Divider />
                <ToolChip active={activeTools.momentumDaily}   onToggle={() => toggle('momentumDaily')}   label="Mom. Daily"   color="sky"    disabled={n < 2}  />
                <ToolChip active={activeTools.momentumWeekly}  onToggle={() => toggle('momentumWeekly')}  label="Mom. Weekly"  color="sky"    disabled={n < 6}  />
                <ToolChip active={activeTools.momentumMonthly} onToggle={() => toggle('momentumMonthly')} label="Mom. Monthly" color="sky"    disabled={n < 22} />
              </div>

              {/* ── Results strip — visible when any tool is active ──────── */}
              {showResults && (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5 border-t border-border/40">

                  {activeTools.avg && (
                    <Res label="Mean" value={stats.avg.toFixed(decimals)} color="text-amber-400" />
                  )}
                  {activeTools.stdDev && (
                    <>
                      <Res label="+1σ" value={(stats.avg + stats.stdDev).toFixed(decimals)} color="text-sky-400" />
                      <Res label="−1σ" value={(stats.avg - stats.stdDev).toFixed(decimals)} color="text-sky-400" />
                    </>
                  )}
                  {activeTools.minMax && (
                    <>
                      <Res label="High" value={stats.max.toFixed(decimals)} color="text-violet-400" />
                      <Res label="Low"  value={stats.min.toFixed(decimals)} color="text-violet-400" />
                    </>
                  )}

                  {activeTools.sma20 && iv.sma20 != null && (
                    <Res label="SMA 20" value={iv.sma20.toFixed(decimals)} color="text-cyan-400" />
                  )}
                  {activeTools.ema20 && iv.ema20 != null && (
                    <Res label="EMA 20" value={iv.ema20.toFixed(decimals)} color="text-rose-400" />
                  )}
                  {activeTools.ema100 && iv.ema100 != null && (
                    <Res label="EMA 100" value={iv.ema100.toFixed(decimals)} color="text-pink-400" />
                  )}
                  {activeTools.sma50 && iv.sma50 != null && (
                    <Res label="SMA 50" value={iv.sma50.toFixed(decimals)} color="text-orange-400" />
                  )}
                  {activeTools.sma200 && iv.sma200 != null && (
                    <Res label="SMA 200" value={iv.sma200.toFixed(decimals)} color="text-purple-400" />
                  )}

                  {/* Golden / Death Cross badge */}
                  {activeTools.sma50 && activeTools.sma200 && iv.cross && (
                    <div className={clsx(
                      'self-end px-2 py-0.5 rounded-full text-[10px] font-bold border',
                      iv.cross === 'golden'
                        ? 'bg-yellow-400/15 text-yellow-400 border-yellow-400/40'
                        : 'bg-red-400/15 text-red-400 border-red-400/40',
                    )}>
                      {iv.cross === 'golden' ? '✦ Golden Cross' : '✦ Death Cross'}
                    </div>
                  )}

                  {activeTools.bollinger && iv.bbUpper != null && iv.bbLower != null && (
                    <>
                      <Res label="BB ↑" value={iv.bbUpper.toFixed(decimals)} color="text-teal-400" />
                      <Res label="BB ↓" value={iv.bbLower.toFixed(decimals)} color="text-teal-400" />
                    </>
                  )}

                  {activeTools.fib && iv.fibs && iv.fibs.length > 0 && (
                    <>
                      {iv.fibs
                        .filter(f => [0.236, 0.382, 0.5, 0.618, 0.786].includes(f.ratio))
                        .map(f => (
                          <Res
                            key={f.ratio}
                            label={`Fib ${(f.ratio * 100).toFixed(1)}%`}
                            value={f.value.toFixed(decimals)}
                            color="text-yellow-400"
                          />
                        ))}
                    </>
                  )}

                  {activeTools.rsi && iv.rsi != null && (
                    <Res
                      label={iv.rsi > 70 ? 'RSI · Overbought' : iv.rsi < 30 ? 'RSI · Oversold' : 'RSI 14'}
                      value={iv.rsi.toFixed(1)}
                      color={iv.rsi > 70 ? 'text-red-400' : iv.rsi < 30 ? 'text-emerald-400' : 'text-indigo-400'}
                    />
                  )}

                  {activeTools.macd && iv.macd != null && iv.signal != null && iv.hist != null && (
                    <>
                      <Res label="MACD"   value={iv.macd.toFixed(decimals)}   color="text-emerald-400" />
                      <Res label="Signal" value={iv.signal.toFixed(decimals)} color="text-emerald-400" />
                      <Res
                        label="Histogram"
                        value={(iv.hist >= 0 ? '+' : '') + iv.hist.toFixed(decimals)}
                        color={iv.hist >= 0 ? 'text-emerald-400' : 'text-red-400'}
                      />
                    </>
                  )}

                  {activeTools.momentumDaily && iv.momentumDaily != null && (
                    <Res
                      label="Mom. 1D"
                      value={(iv.momentumDaily >= 0 ? '+' : '') + iv.momentumDaily.toFixed(2) + '%'}
                      color={iv.momentumDaily >= 0 ? 'text-sky-400' : 'text-red-400'}
                    />
                  )}
                  {activeTools.momentumWeekly && iv.momentumWeekly != null && (
                    <Res
                      label="Mom. 1W"
                      value={(iv.momentumWeekly >= 0 ? '+' : '') + iv.momentumWeekly.toFixed(2) + '%'}
                      color={iv.momentumWeekly >= 0 ? 'text-sky-400' : 'text-red-400'}
                    />
                  )}
                  {activeTools.momentumMonthly && iv.momentumMonthly != null && (
                    <Res
                      label="Mom. 1M"
                      value={(iv.momentumMonthly >= 0 ? '+' : '') + iv.momentumMonthly.toFixed(2) + '%'}
                      color={iv.momentumMonthly >= 0 ? 'text-sky-400' : 'text-red-400'}
                    />
                  )}

                  {activeTools.spyRatio && (
                    <div className="min-w-0 self-end">
                      <p className="text-[10px] text-slate-400/80 whitespace-nowrap">
                        vs SPY · benchmark line drawn on the chart
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Statistics — collapsed by default ───────────────────── */}
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
  slate:  { border: 'border-slate-300/60',  bg: 'bg-slate-300/10',  text: 'text-slate-300'  },
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

/** Result value shown below the chip row when a tool is active. */
function Res({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-gray-600 whitespace-nowrap">{label}</p>
      <p className={clsx('text-xs font-mono font-semibold tabular-nums', color)}>{value}</p>
    </div>
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
