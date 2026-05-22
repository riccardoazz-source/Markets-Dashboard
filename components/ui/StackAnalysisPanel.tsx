'use client';

import { useMemo } from 'react';
import { CompareAsset } from '@/lib/types';
import { CHART_COLORS } from '@/lib/utils';
import {
  computeSMA, computeEMA, computeRSI, computeMACD,
  computeBollingerBands, computeFibLevels,
} from '@/lib/indicators';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import {
  ResponsiveContainer, LineChart, ComposedChart, Line, Area, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

interface Props {
  assets: CompareAsset[];
  assetIdx: number;
  onAssetSelect: (i: number) => void;
  activeTools: ActiveTools;
  onToolsChange: (t: ActiveTools) => void;
}

const fmtD = (d: string) => { try { return format(parseISO(d), 'MMM d, yyyy'); } catch { return d; } };

export function StackAnalysisPanel({ assets, assetIdx, onAssetSelect, activeTools, onToolsChange }: Props) {
  const asset = assets[assetIdx];
  const prices = asset?.rawData ?? asset?.data ?? [];
  const color = asset?.color ?? CHART_COLORS[assetIdx % CHART_COLORS.length];

  const closes = useMemo(
    () => prices.map(p => p.close).filter((c): c is number => typeof c === 'number' && isFinite(c)),
    [prices],
  );

  const sma20Vals  = activeTools.sma20    ? computeSMA(closes, 20)               : null;
  const sma50Vals  = activeTools.sma50    ? computeSMA(closes, 50)               : null;
  const sma200Vals = activeTools.sma200   ? computeSMA(closes, 200)              : null;
  const ema20Vals  = activeTools.ema20    ? computeEMA(closes, 20)               : null;
  const bands      = activeTools.bollinger ? computeBollingerBands(closes, 20, 2) : null;
  const fibLevels  = activeTools.fib       ? computeFibLevels(closes)            : null;

  const chartData = useMemo(() => prices.map((p, i) => ({
    date: p.date,
    price: p.close,
    sma20:  sma20Vals?.[i]  ?? null,
    sma50:  sma50Vals?.[i]  ?? null,
    sma200: sma200Vals?.[i] ?? null,
    ema20:  ema20Vals?.[i]  ?? null,
    bbLo:   bands ? (bands.lower[i]  ?? null) : null,
    bbHi:   bands ? (bands.upper[i]  ?? null) : null,
    bbMid:  bands ? (bands.middle[i] ?? null) : null,
  })), [prices, sma20Vals, sma50Vals, sma200Vals, ema20Vals, bands]);

  const rsiVals = useMemo(
    () => activeTools.rsi ? computeRSI(closes) : null,
    [closes, activeTools.rsi],
  );
  const rsiData = useMemo(
    () => rsiVals ? prices.map((p, i) => ({ date: p.date, rsi: rsiVals[i] })) : [],
    [prices, rsiVals],
  );

  const macdResult = useMemo(
    () => activeTools.macd ? computeMACD(closes) : null,
    [closes, activeTools.macd],
  );
  const macdData = useMemo(() => macdResult
    ? prices.map((p, i) => ({ date: p.date, macd: macdResult.macd[i], signal: macdResult.signal[i], hist: macdResult.hist[i] }))
    : [], [prices, macdResult]);

  if (!asset || !prices.length) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
      {/* Header: asset selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-semibold text-gray-300">Technical Analysis</p>
        <div className="flex gap-1.5 flex-wrap">
          {assets.map((a, i) => (
            <button
              key={a.symbol}
              onClick={() => onAssetSelect(i)}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-all border',
                i === assetIdx
                  ? 'text-white border-transparent'
                  : 'border-border text-gray-500 hover:text-gray-300',
              )}
              style={i === assetIdx ? { backgroundColor: a.color + '33', borderColor: a.color + '99' } : {}}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
              {a.name.length > 18 ? a.symbol : a.name}
            </button>
          ))}
        </div>
      </div>

      {/* Price chart with overlays */}
      <div className="space-y-1">
        {(activeTools.sma20 || activeTools.sma50 || activeTools.sma200 || activeTools.ema20 || activeTools.bollinger) && (
          <div className="flex items-center gap-3 px-1 flex-wrap text-[10px]">
            {activeTools.sma20  && <span className="flex items-center gap-1 text-cyan-400"><span className="inline-block w-5 border-t-2 border-cyan-400" />SMA 20</span>}
            {activeTools.sma50  && <span className="flex items-center gap-1 text-amber-400"><span className="inline-block w-5 border-t-2 border-amber-400" />SMA 50</span>}
            {activeTools.sma200 && <span className="flex items-center gap-1 text-purple-400"><span className="inline-block w-5 border-t-2 border-purple-400" />SMA 200</span>}
            {activeTools.ema20  && <span className="flex items-center gap-1 text-pink-400"><span className="inline-block w-5 border-t-2 border-dashed border-pink-400" />EMA 20</span>}
            {activeTools.bollinger && <span className="flex items-center gap-1 text-yellow-400/70"><span className="inline-block w-5 border-t border-yellow-400/70" />BB 20,2σ</span>}
          </div>
        )}
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
            <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={v => {
                const n = v as number;
                if (n >= 10000) return `${Math.round(n / 1000)}k`;
                if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
                return n.toFixed(n < 10 ? 2 : 0);
              }}
            />
            {bands && (
              <Area
                type="monotone"
                dataKey="bbHi"
                stroke="none"
                fill="#eab308"
                fillOpacity={0.06}
                dot={false}
                connectNulls={false}
                legendType="none"
                yAxisId={0}
              />
            )}
            {bands && (
              <Area
                type="monotone"
                dataKey="bbLo"
                stroke="none"
                fill="#eab308"
                fillOpacity={0}
                dot={false}
                connectNulls={false}
                legendType="none"
                yAxisId={0}
              />
            )}
            {bands && (
              <Line type="monotone" dataKey="bbHi" stroke="#eab308" strokeWidth={1} strokeOpacity={0.5} dot={false} connectNulls={false} legendType="none" />
            )}
            {bands && (
              <Line type="monotone" dataKey="bbLo" stroke="#eab308" strokeWidth={1} strokeOpacity={0.5} dot={false} connectNulls={false} legendType="none" />
            )}
            {bands && (
              <Line type="monotone" dataKey="bbMid" stroke="#eab308" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="4 2" dot={false} connectNulls={false} legendType="none" />
            )}
            <Line type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} dot={false} connectNulls={false} name="Price" />
            {activeTools.sma20  && <Line type="monotone" dataKey="sma20"  stroke="#22d3ee" strokeWidth={1} dot={false} connectNulls={false} legendType="none" />}
            {activeTools.sma50  && <Line type="monotone" dataKey="sma50"  stroke="#fbbf24" strokeWidth={1} dot={false} connectNulls={false} legendType="none" />}
            {activeTools.sma200 && <Line type="monotone" dataKey="sma200" stroke="#a78bfa" strokeWidth={1} dot={false} connectNulls={false} legendType="none" />}
            {activeTools.ema20  && <Line type="monotone" dataKey="ema20"  stroke="#f472b6" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls={false} legendType="none" />}
            {fibLevels?.map(lvl => (
              <ReferenceLine key={lvl.ratio} y={lvl.value} stroke="#eab308" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="3 3" />
            ))}
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
              formatter={(v: number, name: string) => [v != null ? v.toFixed(2) : '—', name]}
              labelFormatter={l => fmtD(l as string)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI sub-chart */}
      {activeTools.rsi && rsiData.filter(d => d.rsi != null).length > 0 && (
        <div className="rounded-lg border border-border p-3 bg-bg-input/40">
          <p className="text-[10px] text-indigo-400 font-semibold mb-1">RSI 14</p>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={rsiData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
              <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
              <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
              <ReferenceLine y={50} stroke="#6b7280" strokeDasharray="1 4" strokeOpacity={0.35} />
              <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} />
              <Line type="monotone" dataKey="rsi" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
                formatter={(v: number) => [`${(v ?? 0).toFixed(1)}`, 'RSI 14']}
                labelFormatter={l => fmtD(l as string)}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MACD sub-chart */}
      {activeTools.macd && macdData.filter(d => d.hist != null).length > 0 && (
        <div className="rounded-lg border border-border p-3 bg-bg-input/40">
          <p className="text-[10px] text-blue-400 font-semibold mb-1">MACD (12, 26, 9)</p>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={macdData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
              <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} width={36} tickFormatter={v => (v as number).toFixed(2)} />
              <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.4} />
              <Bar dataKey="hist" barSize={3}>
                {macdData.map((entry, i) => (
                  <Cell key={i} fill={(entry.hist ?? 0) >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="macd" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls={false} name="MACD" />
              <Line type="monotone" dataKey="signal" stroke="#f97316" strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} name="Signal" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
                formatter={(v: number, name: string) => [v != null ? v.toFixed(4) : '—', name]}
                labelFormatter={l => fmtD(l as string)}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <ChartTools data={prices} activeTools={activeTools} onChange={onToolsChange} />
    </div>
  );
}

export { DEFAULT_TOOLS };
