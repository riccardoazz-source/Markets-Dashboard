'use client';

import { TrendingUp } from 'lucide-react';
import clsx from 'clsx';

export type Section = 'indexes' | 'currencies' | 'crypto' | 'sectors' | 'compare';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'indexes',    label: 'Indexes'    },
  { id: 'currencies', label: 'Currencies' },
  { id: 'crypto',     label: 'Crypto'     },
  { id: 'sectors',    label: 'Sectors'    },
  { id: 'compare',    label: 'Compare'    },
];

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
}

export function Navbar({ active, onSelect }: Props) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/95 backdrop-blur-md">
      <div className="max-w-screen-2xl mx-auto px-4 flex items-center h-12 gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <TrendingUp size={18} className="text-accent" />
          <span className="font-bold text-white text-base tracking-tight">MarketPulse</span>
          <span className="text-[9px] font-semibold bg-up-dim text-up-text px-1.5 py-0.5 rounded uppercase tracking-wider">
            Live
          </span>
        </div>

        <nav className="flex gap-0.5 overflow-x-auto scrollbar-hide flex-1 justify-end">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150 whitespace-nowrap shrink-0',
                active === s.id
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-border'
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
