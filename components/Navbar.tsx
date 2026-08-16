'use client';

import { LucideProps, TrendingUp, BarChart2, DollarSign, Bitcoin, Grid2X2, GitCompare, Gem, Activity, Briefcase, BookOpen, RefreshCw, Globe, LayoutDashboard } from 'lucide-react';
import { ForwardRefExoticComponent, RefAttributes } from 'react';
import clsx from 'clsx';
import { MACRO_WORLD_ENABLED } from '@/lib/imfConfig';

export type Section = 'dashboard' | 'indexes' | 'currencies' | 'crypto' | 'commodities' | 'sectors' | 'macro' | 'macroworld' | 'stock' | 'compare' | 'rotation' | 'sources';

type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

/**
 * The icon that stands for each section, everywhere in the app.
 *
 * Exported because the Dashboard labels its pinned subsections with these same marks, and
 * a second copy of "commodities means a gem" would eventually disagree with this one —
 * at which point the icon stops being a shorthand for the tab and becomes decoration.
 */
export const SECTION_ICONS: Record<Section, LucideIcon> = {
  dashboard:   LayoutDashboard,
  commodities: Gem,
  indexes:     BarChart2,
  currencies:  DollarSign,
  crypto:      Bitcoin,
  sectors:     Grid2X2,
  macro:       Activity,
  macroworld:  Globe,
  stock:       Briefcase,
  compare:     GitCompare,
  rotation:    RefreshCw,
  sources:     BookOpen,
};

// Commodities sits ahead of Indexes, matching the order the Dashboard lists pinned
// assets in. One order for the whole app: the tab bar and the landing page disagreeing
// about where commodities belong is a small thing that has to be re-learned every time.
const SECTIONS: { id: Section; label: string; short: string }[] = [
  { id: 'dashboard',   label: 'Dashboard',   short: 'Home'   },
  { id: 'commodities', label: 'Commodities', short: 'Cmdty'  },
  { id: 'indexes',     label: 'Indexes',     short: 'Idx'    },
  { id: 'currencies',  label: 'Currencies',  short: 'FX'     },
  { id: 'crypto',      label: 'Crypto',      short: 'Crypto' },
  { id: 'sectors',     label: 'Sectors',     short: 'Sec'    },
  { id: 'macro',       label: 'Macro',       short: 'Macro'  },
  // Macro World (IMF) — only shown when the feature flag is on.
  ...(MACRO_WORLD_ENABLED ? [{ id: 'macroworld' as Section, label: 'Macro World', short: 'World' }] : []),
  { id: 'stock',       label: 'Stocks',      short: 'Stocks' },
  { id: 'compare',     label: 'Compare',     short: 'vs.'    },
  { id: 'rotation',    label: 'Rotation',    short: 'RRG'    },
  { id: 'sources',     label: 'Sources',     short: 'Src'    },
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
          <nav className="hidden sm:flex gap-0.5 flex-1 justify-end overflow-x-auto scrollbar-hide">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={clsx(
                  'px-2 py-1.5 text-xs lg:px-3 lg:text-sm font-medium rounded-md transition-all duration-150 whitespace-nowrap shrink-0',
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
          {SECTIONS.map(s => {
            const Icon = SECTION_ICONS[s.id];
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={clsx(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150',
                  active === s.id ? 'text-accent' : 'text-gray-500'
                )}
              >
                <Icon size={20} className={active === s.id ? 'text-accent' : 'text-gray-500'} />
                <span className="text-[10px] font-medium">{s.short}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
