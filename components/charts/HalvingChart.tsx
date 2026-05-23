'use client';

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { BTC_HALVING_DATES } from '@/lib/config';
import { format, parseISO } from 'date-fns';

interface NextHalving { estimatedDate: string; blocksRemaining: number | null; blockHeight: number | null }

// Bitcoin halvings shown as vertical reference lines on a continuous time axis.
// Past halvings → solid amber lines. Estimated next halving → dashed amber line.
export function HalvingChart({ height = 240 }: { height?: number }) {
  const [next, setNext] = useState<NextHalving | null>(null);

  useEffect(() => {
    fetch('/api/macro?mode=btc-next-halving')
      .then(r => r.json() as Promise<NextHalving>)
      .then(d => setNext(d))
      .catch(() => null);
  }, []);

  // Fallback estimate when API hasn't loaded yet: +4y from last known halving
  const lastKnown = BTC_HALVING_DATES[BTC_HALVING_DATES.length - 1];
  const nextDate: string = next?.estimatedDate ?? (() => {
    const d = new Date(lastKnown + 'T12:00:00Z');
    d.setFullYear(d.getFullYear() + 4);
    return d.toISOString().slice(0, 10);
  })();

  // Monthly axis from Jan 2012 → estimated next halving
  const data: { date: string; v: number }[] = [];
  const axisEnd = new Date(nextDate + 'T12:00:00Z');
  const d = new Date(2012, 0, 1);
  while (d <= axisEnd) {
    data.push({ date: format(d, 'yyyy-MM-dd'), v: 0 });
    d.setMonth(d.getMonth() + 1);
  }

  const snap = (target: string): string => {
    const tt = parseISO(target).getTime();
    let best = data[0]?.date ?? target, bestDiff = Infinity;
    for (const p of data) {
      const diff = Math.abs(parseISO(p.date).getTime() - tt);
      if (diff < bestDiff) { bestDiff = diff; best = p.date; }
    }
    return best;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 26, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={v => { try { return format(parseISO(v as string), 'yyyy'); } catch { return v as string; } }}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false} tickLine={false} minTickGap={36}
        />
        <YAxis hide domain={[0, 1]} />
        <Line dataKey="v" stroke="transparent" dot={false} isAnimationActive={false} />

        {/* Past halvings — solid amber */}
        {BTC_HALVING_DATES.map(hd => (
          <ReferenceLine
            key={hd}
            x={snap(hd)}
            stroke="#f59e0b"
            strokeWidth={2}
            label={{ value: `⚡ ${format(parseISO(hd), "MMM ''yy")}`, fill: '#f59e0b', fontSize: 10, position: 'insideTop' }}
          />
        ))}

        {/* Estimated next halving — dashed amber */}
        {data.length > 0 && (
          <ReferenceLine
            x={snap(nextDate)}
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            strokeOpacity={0.65}
            label={{ value: `⚡ ~${format(parseISO(nextDate), "MMM ''yy")} (est.)`, fill: '#f59e0b', fontSize: 10, position: 'insideTop' }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
