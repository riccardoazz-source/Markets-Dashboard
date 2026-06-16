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

  // Block subsidy after each halving: 50 → 25 → 12.5 → 6.25 → 3.125 …
  const fmt = (s: string) => { try { return format(parseISO(s), 'd MMM yyyy'); } catch { return s; } };
  const rewardAfter = (i: number) => 50 / Math.pow(2, i + 1); // reward after the (i+1)-th halving
  const halvingRows = BTC_HALVING_DATES.map((date, i) => ({
    date,
    n: i + 1,
    from: 50 / Math.pow(2, i),
    to: rewardAfter(i),
    estimated: false,
  }));
  const nextN = BTC_HALVING_DATES.length + 1;
  const nextRow = {
    date: nextDate,
    n: nextN,
    from: 50 / Math.pow(2, BTC_HALVING_DATES.length),
    to: 50 / Math.pow(2, BTC_HALVING_DATES.length + 1),
    estimated: true,
  };
  const listRows = [nextRow, ...halvingRows.slice().reverse()]; // next first, then newest → oldest

  return (
    <div className="border border-border rounded-lg overflow-hidden">
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

      {/* Halving list — date + block-reward change */}
      <div className="border-t border-border">
        <div className="px-3 py-2 bg-bg-input/50 border-b border-border flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
          <span className="text-xs font-semibold text-gray-200">Bitcoin Halvings</span>
          <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border">
            {BTC_HALVING_DATES.length}
          </span>
        </div>
        <div className="divide-y divide-border">
          {listRows.map(r => (
            <div key={`halv-row-${r.n}`} className="flex items-start gap-2.5 px-3 py-2">
              <span className="inline-block w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: '#f59e0b' }} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-200">
                    Halving #{r.n}{r.estimated && <span className="text-amber-400/80 font-normal"> (est.)</span>}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">{fmt(r.date)}</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-snug mt-0.5">
                  Block reward {r.from} → <span className="text-amber-400/90">{r.to}</span> BTC
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
