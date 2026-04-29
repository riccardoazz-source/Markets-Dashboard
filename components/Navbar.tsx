'use client';

import { LucideProps, TrendingUp, BarChart2, DollarSign, Bitcoin, Grid2X2, GitCompare } from 'lucide-react';
import { ForwardRefExoticComponent, RefAttributes } from 'react';
import clsx from 'clsx';

export type Section = 'indexes' | 'currencies' | 'crypto' | 'sectors' | 'compare';

type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

const SECTIONS: { id: Section; label: string; short: string; Icon: LucideIcon }[] = [
  { id: 'indexes',    label: 'Indexes',    short: 'Indexes',   Icon: BarChart2    },
  { id: 'currencies', label: 'Currencies', short: 'FX',        Icon: DollarSign   },
  { id: 'crypto',     label: 'Crypto',     short: 'Crypto',    Icon: Bitcoin      },
  { id: 'sectors',    label: 'Sectors',    short: 'Sectors',   Icon: Grid2X2      },
  { id: 'compare',    label: 'Compare',    short: 'Compare',   Icon: GitCompare   },
];

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
}

export function Navbar({ active, onSelect }: Props) {
  return (
    <>
      {/* Top bar — logo only on mobile, logo + tabs on desktop */}
      <header className="sticky top-0 z-50 border-b border-border bg-bg/95 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 flex items-center h-12 gap-3">
          <div className="flex items-center gap-1.5 shrink-0">
            <TrendingUp size={18} className="text-accent" />
            <span className="font-bold text-white text-base tracking-tight">MarketPulse</span>
            <span className="text-[9px] font-semibold bg-up-dim text-up-text px-1.5 py-0.5 rounded uppercase tracking-wider">
              Live
            </span>
          </div>

          {/* Desktop nav — hidden on mobile */}
          <nav className="hidden sm:flex gap-0.5 flex-1 justify-end">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={clsx(
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150 whitespace-nowrap',
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

      {/* Mobile bottom tab bar — visible only on mobile */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg border-t border-border">
        <div className="flex items-stretch h-14">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={clsx(
                'flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150',
                active === s.id ? 'text-accent' : 'text-gray-500'
              )}
            >
              <s.Icon size={20} className={active === s.id ? 'text-accent' : 'text-gray-500'} />
              <span className="text-[10px] font-medium">{s.short}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
