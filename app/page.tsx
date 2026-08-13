'use client';

import { useState } from 'react';
import { Navbar, Section } from '@/components/Navbar';
import { DashboardSection } from '@/components/sections/DashboardSection';
import { IndexesSection } from '@/components/sections/IndexesSection';
import { CurrenciesSection } from '@/components/sections/CurrenciesSection';
import { CryptoCommoditiesSection } from '@/components/sections/CryptoCommoditiesSection';
import { CommoditiesSection } from '@/components/sections/CommoditiesSection';
import { SectorsSection } from '@/components/sections/SectorsSection';
import { CompareSection } from '@/components/sections/CompareSection';
import { MacroSection } from '@/components/sections/MacroSection';
import { MacroWorldSection } from '@/components/sections/MacroWorldSection';
import { MACRO_WORLD_ENABLED } from '@/lib/imfConfig';
import { StockSection } from '@/components/sections/StockSection';
import { SourcesSection } from '@/components/sections/SourcesSection';
import { RotationSection } from '@/components/sections/RotationSection';
import { SectionNotesPanel } from '@/components/ui/SectionNotesPanel';
import { ScrollNav } from '@/components/ui/ScrollNav';
import { isNotesSection, type NotesSection } from '@/lib/sectionNotes';

const SECTION_LABELS: Record<Section, string> = {
  dashboard:   'Dashboard',
  indexes:     'Global Market Indexes',
  currencies:  'Currency Exchange Rates',
  crypto:      'Cryptocurrency',
  commodities: 'Commodities',
  sectors:     'Sector Heat Rankings',
  macro:       'Macro Indicators',
  macroworld:  'Macro World',
  stock:       'Stocks',
  compare:     'Asset Comparison',
  rotation:    'Capital Rotation',
  sources:     'Data Sources',
};

const SECTION_DESCRIPTIONS: Record<Section, string> = {
  dashboard:   'The dollar, the policy rate, the VIX and unemployment — the five numbers that set the weather — and everything you have pinned',
  indexes:     'Live prices and performance for major global indexes and ETFs',
  currencies:  'Real-time currency conversion rates with historical charts',
  crypto:      'Live cryptocurrency prices with CAGR and return analysis',
  commodities: 'Live prices for metals, energy and agricultural commodities',
  sectors:     'US sector ETF performance ranked by return — click any sector for details',
  macro:       'Key macroeconomic indicators from the Federal Reserve (FRED)',
  macroworld:  'Country macro data from the IMF World Economic Outlook — growth, inflation, debt, jobs & more',
  stock:       'Search any stock by ticker or ISIN — price, total return with dividends, CAGR & IRR',
  compare:     'Normalized performance, dividend-adjusted CAGR, IRR and correlation between any combination of assets',
  rotation:    'Relative Rotation Graph — see which asset classes are gaining or losing relative momentum vs a benchmark',
  sources:     'Reference table of every data source feeding this dashboard',
};

export default function Home() {
  const [section, setSection] = useState<Section>('dashboard');
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  const handleSectionSelect = (s: Section) => {
    setSection(s);
    setJumpTarget(null);
  };

  const handleNavigate = (targetSection: NotesSection, chartId: string) => {
    setSection(targetSection as Section);
    setJumpTarget(chartId);
  };

  const handleCompare = (symbol: string) => {
    setSection('compare');
    setJumpTarget(`compare:${symbol}`);
  };

  return (
    <>
      <Navbar active={section} onSelect={handleSectionSelect} />
      <main className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-3 sm:py-5 pb-20 sm:pb-5">
        <div className="mb-3 sm:mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white">{SECTION_LABELS[section]}</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5 hidden sm:block">{SECTION_DESCRIPTIONS[section]}</p>
          </div>
          {isNotesSection(section) && (
            <SectionNotesPanel
              section={section}
              sectionLabel={SECTION_LABELS[section]}
              onNavigate={handleNavigate}
            />
          )}
        </div>

        {section === 'dashboard'   && <DashboardSection onNavigate={s => handleSectionSelect(s as Section)} />}
        {section === 'indexes'     && <IndexesSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'currencies'  && <CurrenciesSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'crypto'      && <CryptoCommoditiesSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'commodities' && <CommoditiesSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'sectors'     && <SectorsSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'macro'       && <MacroSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'macroworld'  && MACRO_WORLD_ENABLED && <MacroWorldSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'stock'       && <StockSection jumpTo={jumpTarget} onCompare={handleCompare} />}
        {section === 'compare'     && <CompareSection jumpTo={jumpTarget} />}
        {section === 'rotation'    && <RotationSection onNavigate={(s, id) => { setSection(s as Section); setJumpTarget(id); }} onCompare={handleCompare} />}
        {section === 'sources'     && <SourcesSection />}
      </main>

      <footer className="max-w-screen-2xl mx-auto px-4 py-6 mt-8 border-t border-border">
        <p className="text-xs text-gray-600">
          Data sourced from Yahoo Finance, CoinGecko, and ECB via Frankfurter.
          Refreshes every 60 seconds. Not financial advice.
        </p>
      </footer>

      {/* Fixed page-jump arrows on the right edge — reachable from any scroll position */}
      <ScrollNav />
    </>
  );
}
