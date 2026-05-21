'use client';

import { useState } from 'react';
import { Timeframe } from '@/lib/types';
import { CalendarDays } from 'lucide-react';
import clsx from 'clsx';

const TIMEFRAMES: Timeframe[] = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface Props {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  options?: Timeframe[];
  onCustomRange?: (from: string, to: string) => void;
  isCustom?: boolean;
}

export function TimeframeSelector({
  value, onChange, options = TIMEFRAMES, onCustomRange, isCustom = false,
}: Props) {
  const [showCustom, setShowCustom] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const applyCustom = () => {
    if (!from || !to) return;
    onCustomRange?.(from, to);
    setShowCustom(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="flex gap-1 bg-bg-input rounded-lg p-1 flex-wrap">
        {options.map(tf => (
          <button
            key={tf}
            onClick={() => { onChange(tf); setShowCustom(false); }}
            className={clsx(
              'px-2.5 py-1 text-xs font-semibold rounded-md transition-all duration-150',
              value === tf && !isCustom
                ? 'bg-accent text-white shadow'
                : 'text-gray-400 hover:text-gray-100 hover:bg-border'
            )}
          >
            {tf}
          </button>
        ))}
        {onCustomRange && (
          <button
            onClick={() => setShowCustom(v => !v)}
            title="Pick custom date range"
            className={clsx(
              'px-2.5 py-1 text-xs font-semibold rounded-md transition-all duration-150 flex items-center gap-1',
              isCustom
                ? 'bg-accent text-white shadow'
                : showCustom
                  ? 'bg-border text-gray-100'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-border'
            )}
          >
            <CalendarDays size={11} />
            {isCustom ? 'Custom ✓' : 'Custom'}
          </button>
        )}
      </div>

      {showCustom && (
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="bg-bg border border-border rounded-md px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-accent"
          />
          <span className="text-gray-600 text-xs">→</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="bg-bg border border-border rounded-md px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-accent"
          />
          <button
            onClick={applyCustom}
            disabled={!from || !to || from > to}
            className="px-3 py-1 text-xs font-semibold rounded-md bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition"
          >
            Apply
          </button>
          <button
            onClick={() => setShowCustom(false)}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
