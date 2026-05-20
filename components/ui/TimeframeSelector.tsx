'use client';

import { Timeframe } from '@/lib/types';
import clsx from 'clsx';

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface Props {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  options?: Timeframe[];
}

export function TimeframeSelector({ value, onChange, options = TIMEFRAMES }: Props) {
  return (
    <div className="flex gap-1 bg-bg-input rounded-lg p-1 w-fit flex-wrap">
      {options.map(tf => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={clsx(
            'px-2.5 py-1 text-xs font-semibold rounded-md transition-all duration-150',
            value === tf
              ? 'bg-accent text-white shadow'
              : 'text-gray-400 hover:text-gray-100 hover:bg-border'
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
