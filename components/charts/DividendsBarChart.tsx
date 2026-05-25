'use client';

import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { format, parseISO } from 'date-fns';
import { type DividendEvent, formatPrice } from '@/lib/utils';

export function DividendsBarChart({ dividends, currency }: { dividends: DividendEvent[]; currency: string }) {
  if (!dividends.length) return null;
  const data = dividends.map(d => ({ date: d.date, amount: d.amount }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2133" vertical={false} />
        <XAxis dataKey="date"
          tickFormatter={d => { try { return format(parseISO(d as string), "MMM ''yy"); } catch { return d as string; } }}
          tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={56}
          tickFormatter={v => (v as number).toFixed(2)}
          domain={[(dataMin: number) => dataMin * 0.85, (dataMax: number) => dataMax * 1.1]} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1d2e', border: '1px solid #252840', borderRadius: '8px', color: '#e2e8f0', fontSize: 12 }}
          itemStyle={{ color: '#e2e8f0' }}
          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
          formatter={(value: number) => [formatPrice(value, currency), 'Dividend']}
          labelFormatter={label => { try { return format(parseISO(label as string), 'MMM d, yyyy'); } catch { return label as string; } }}
        />
        <Bar dataKey="amount" fill="#10b981" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DividendsPanel({
  dividends, currency, periodStartDate,
}: {
  dividends: DividendEvent[];
  currency: string;
  /** ISO date of the period start — only dividends on/after this date are summed */
  periodStartDate?: string;
}) {
  if (!dividends.length) return null;
  const totalDivs = dividends.reduce(
    (s, d) => (!periodStartDate || d.date >= periodStartDate ? s + d.amount : s),
    0,
  );
  return (
    <>
      <div className="rounded-lg border border-border p-3 bg-bg-input/40 space-y-1">
        <p className="text-xs text-gray-300 font-semibold">Dividends over time</p>
        <DividendsBarChart dividends={dividends} currency={currency} />
      </div>
      <details className="bg-bg-input rounded-lg px-3 py-2">
        <summary className="text-xs text-gray-300 cursor-pointer">
          {dividends.length} dividends in period — total {formatPrice(totalDivs, currency)}
        </summary>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-400 max-h-32 overflow-y-auto">
          {dividends.slice().reverse().map(d => (
            <div key={d.date + d.amount} className="flex justify-between">
              <span>{d.date}</span>
              <span className="text-gray-200">{d.amount.toFixed(4)}</span>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
