'use client';

import { useMemo } from 'react';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

interface Props {
  prices: HistoricalPoint[];
  spyPrices: HistoricalPoint[];
}

export function SpyRatioChart({ prices, spyPrices }: Props) {
  const ratioData = useMemo(() => {
    const spyMap = new Map(spyPrices.map(p => [p.date, p.close]));
    const raw: { date: string; ratio: number }[] = [];
    for (const p of prices) {
      const spy = spyMap.get(p.date);
      if (spy != null && spy > 0 && p.close != null && p.close > 0) {
        raw.push({ date: p.date, ratio: p.close / spy });
      }
    }
    if (!raw.length) return raw;
    const base = raw[0].ratio;
    return raw.map(d => ({ date: d.date, ratio: d.ratio / base }));
  }, [prices, spyPrices]);

  if (!ratioData.length) return null;

  const last = ratioData[ratioData.length - 1].ratio;
  const isUp = last >= 1;
  const color = isUp ? '#10b981' : '#ef4444';
  const pctChange = ((last - 1) * 100).toFixed(2);

  return (
    <div className="rounded-lg border border-border p-3 bg-bg-input/40">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold" style={{ color }}>
          Relative Strength vs SPY
        </p>
        <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
          {isUp ? '+' : ''}{pctChange}% vs start
        </span>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={ratioData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={v => (v as number).toFixed(2)}
          />
          <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="3 3" strokeOpacity={0.6} />
          <Line type="monotone" dataKey="ratio" stroke={color} strokeWidth={1.5} dot={false} connectNulls={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 11 }}
            formatter={(v: number) => [v.toFixed(4), 'Asset / SPY']}
            labelFormatter={l => { try { return format(parseISO(l as string), 'MMM d, yyyy'); } catch { return String(l); } }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[9px] text-gray-700 mt-1">
        Normalized to 1.0 at period start · above 1 = outperforming SPY
      </p>
    </div>
  );
}

// Self-contained panel: manages SPY fetch + renders toggle + chart
export function SpyRatioPanel({
  show, onToggle, prices, spyPrices,
}: {
  show: boolean;
  onToggle: () => void;
  prices: HistoricalPoint[];
  spyPrices: HistoricalPoint[];
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className={clsx(
          'px-2.5 py-0.5 text-[10px] font-medium rounded-full border transition-all',
          show
            ? 'border-violet-400 text-violet-400 bg-violet-400/10'
            : 'border-border text-gray-400 hover:text-gray-200',
        )}
      >
        {show ? 'Hide vs SPY' : 'vs SPY ratio'}
      </button>
      {show && spyPrices.length > 0 && prices.length > 0 && (
        <SpyRatioChart prices={prices} spyPrices={spyPrices} />
      )}
    </>
  );
}
