'use client';

import { useState } from 'react';
import { HistoricalPoint } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronUp, Table2 } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  data: HistoricalPoint[];
  unit?: string;
  decimals?: number;
}

function formatVal(v: number, decimals: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(decimals);
}

export function ChartDataTable({ data, unit, decimals }: Props) {
  const [open, setOpen] = useState(false);

  if (!data || data.length === 0) return null;

  const dec = decimals ?? (data[0]?.close < 10 ? 4 : data[0]?.close < 100 ? 2 : 2);
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-input text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Table2 size={13} />
          Data table
          <span className="text-gray-600 font-normal">({data.length} rows)</span>
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-input">
              <tr>
                <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Date</th>
                <th className="text-right px-3 py-1.5 text-gray-500 font-semibold">
                  Value{unit ? ` (${unit})` : ''}
                </th>
                <th className="text-right px-3 py-1.5 text-gray-500 font-semibold">Δ%</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const prev = sorted[i + 1];
                const change = prev ? (row.close - prev.close) / Math.abs(prev.close) * 100 : null;
                return (
                  <tr key={row.date} className="border-t border-border hover:bg-bg-hover/10">
                    <td className="px-3 py-1.5 text-gray-400 tabular-nums">
                      {(() => { try { return format(parseISO(row.date), 'MMM d, yyyy'); } catch { return row.date; } })()}
                    </td>
                    <td className="px-3 py-1.5 text-gray-100 text-right tabular-nums font-mono">
                      {formatVal(row.close, dec)}
                    </td>
                    <td className={clsx(
                      'px-3 py-1.5 text-right tabular-nums font-mono text-[11px]',
                      change == null ? 'text-gray-600' : change >= 0 ? 'text-emerald-400' : 'text-red-400'
                    )}>
                      {change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
