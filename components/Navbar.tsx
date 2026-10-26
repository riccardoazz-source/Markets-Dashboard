'use client';

import { LucideProps, TrendingUp, Cloud, CloudOff, Landmark, BarChart2, DollarSign, Bitcoin, Grid2X2, GitCompare, Gem, Activity, Briefcase, BookOpen, RefreshCw, Globe, LayoutDashboard } from 'lucide-react';
import { ForwardRefExoticComponent, RefAttributes, useState } from 'react';
import clsx from 'clsx';
import { MACRO_WORLD_ENABLED } from '@/lib/imfConfig';
import { useSyncStatus, useOwedKeys } from '@/lib/gist';
import { DataBackupPanel } from '@/components/ui/DataBackupPanel';

export type Section = 'dashboard' | 'indexes' | 'bonds' | 'currencies' | 'crypto' | 'commodities' | 'sectors' | 'macro' | 'macroworld' | 'stock' | 'compare' | 'rotation' | 'sources';

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
  bonds:       Landmark,
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
  // Bonds sits right after Indexes: it is the other half of "what the market is doing",
  // and the yield curve is read alongside the equity indexes, not buried near Macro.
  { id: 'bonds',       label: 'Bonds',       short: 'Bonds'  },
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
  const syncStatus = useSyncStatus();
  const owed = useOwedKeys();
  const [backup, setBackup] = useState(false);
  // Shown ONLY when something is wrong. The same indicator already existed, but it lived
  // inside the Notes panel — inside the feature that stops working when sync does, so the
  // one case it was built to warn about is the one case nobody could see it. A person can
  // end up with a full watchlist on a phone and an empty one on a desktop and no sign
  // anywhere that the two were never connected.
  // "Unsynced" is its own state, louder than 'synced' and distinct from 'error': the
  // server is fine and reachable, and THIS DEVICE still holds things it has not managed
  // to hand over. That is exactly the condition that was invisible before — a phone
  // full of notes, a healthy badge, and a server that had never heard of them.
  const unsynced = !(syncStatus === 'local-only' || syncStatus === 'error') && owed.length > 0;
  const sickSync = syncStatus === 'local-only' || syncStatus === 'error' || unsynced;
  return (
    <>
      {/* Top bar — logo only on mobile, logo + tabs on desktop */}
      <header className="sticky top-0 z-50 border-b border-border bg-bg/95 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 flex items-center h-12 gap-3">
          <div className="flex items-center gap-1.5 shrink-0">
            <TrendingUp size={18} className="text-accent" />
            <span className="font-bold text-white text-base tracking-tight">MarketPulse</span>
            {/* Always reachable, loud only when it needs to be.
                The first version rendered this ONLY when sync was local-only or erroring,
                which left the backup panel unreachable in the case that actually bit: the
                server was configured and reachable, so the status read 'synced' and
                everything looked fine, while a whole watchlist sat on one phone that had
                never uploaded it. A status that is healthy is not the same as data that
                is present, so the way in is always here — muted when there is nothing to
                say, and a word when there is. */}
            <button onClick={() => setBackup(true)}
              title={syncStatus === 'local-only'
                ? 'Saved only on this device — nothing is shared with your other devices. Click for details and a backup.'
                : syncStatus === 'error'
                ? 'Cloud storage could not be reached. Click for details and a backup.'
                : 'Your saved data — what this device is holding, and how to back it up.'}
              className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
                syncStatus === 'local-only' || unsynced ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                  : syncStatus === 'error'  ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                  : 'text-gray-600 hover:text-gray-300')}>
              {sickSync ? <CloudOff size={10} /> : <Cloud size={11} />}
              {syncStatus === 'local-only' ? 'This device only'
                : syncStatus === 'error' ? 'Sync error'
                : unsynced ? `${owed.length} unsynced` : ''}
            </button>
            {/* The green "LIVE" badge that used to sit here has been removed.
                Nothing computed it. It was a decoration printed unconditionally on every
                page, including pages showing a policy rate read out of a table edited by
                hand — and it was read, correctly, as a promise that everything on screen
                was current. A freshness claim the code never checks is worse than no claim,
                because it overrides the per-tile dates that ARE true.
                Freshness is now stated where it can be known: each tile carries its own
                as-of date, and a CACHED / NOT LIVE mark when it is not live. */}
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

      {backup && <DataBackupPanel onClose={() => setBackup(false)} />}
    </>
  );
}
