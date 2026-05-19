'use client';

import { useState } from 'react';
import { Navbar, Section } from '@/components/Navbar';
import { IndexesSection } from '@/components/sections/IndexesSection';
import { CurrenciesSection } from '@/components/sections/CurrenciesSection';
import { CryptoCommoditiesSection } from '@/components/sections/CryptoCommoditiesSection';
import { CommoditiesSection } from '@/components/sections/CommoditiesSection';
import { SectorsSection } from '@/components/sections/SectorsSection';
import { CompareSection } from '@/components/sections/CompareSection';
import { MacroSection } from '@/components/sections/MacroSection';
import { StockSection } from '@/components/sections/StockSection';
import { GeneralSection } from '@/components/sections/GeneralSection';
import { SourcesSection } from '@/components/sections/SourcesSection';

const SECTION_LABELS: Record<Section, string> = {
  indexes:     'Global Market Indexes',
  currencies:  'Currency Exchange Rates',
  crypto:      'Cryptocurrency',
  commodities: 'Commodities',
  sectors:     'Sector Heat Rankings',
  macro:       'Macro Indicators',
  stock:       'Stock Lookup',
  compare:     'Asset Comparison',
  general:     'General Overview',
  sources:     'Data Sources',
};

const SECTION_DESCRIPTIONS: Record<Section, string> = {
  indexes:     'Live prices and performance for major global indexes and ETFs',
  currencies:  'Real-time currency conversion rates with historical charts',
  crypto:      'Live cryptocurrency prices with CAGR and return analysis',
  commodities: 'Live prices for metals, energy and agricultural commodities',
  sectors:     'US sector ETF performance ranked by return — click any sector for details',
  macro:       'Key macroeconomic indicators from the Federal Reserve (FRED)',
  stock:       'Search any stock by ticker or ISIN — price, total return with dividends, CAGR & IRR',
  compare:     'Normalized performance, dividend-adjusted CAGR, IRR and correlation between any combination of assets',
  general:     'S&P 500 P/E heatmap and sector value chains with live constituents',
  sources:     'Reference table of every data source feeding this dashboard',
};

export default function Home() {
  const [section, setSection] = useState<Section>('indexes');

  return (
    <>
      <Navbar active={section} onSelect={setSection} />
      <main className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-3 sm:py-5 pb-20 sm:pb-5">
        <div className="mb-3 sm:mb-5">
          <h1 className="text-lg sm:text-xl font-bold text-white">{SECTION_LABELS[section]}</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5 hidden sm:block">{SECTION_DESCRIPTIONS[section]}</p>
        </div>

        {section === 'indexes'     && <IndexesSection />}
        {section === 'currencies'  && <CurrenciesSection />}
        {section === 'crypto'      && <CryptoCommoditiesSection />}
        {section === 'commodities' && <CommoditiesSection />}
        {section === 'sectors'     && <SectorsSection />}
        {section === 'macro'       && <MacroSection />}
        {section === 'stock'       && <StockSection />}
        {section === 'compare'     && <CompareSection />}
        {section === 'general'     && <GeneralSection />}
        {section === 'sources'     && <SourcesSection />}
      </main>

      <footer className="max-w-screen-2xl mx-auto px-4 py-6 mt-8 border-t border-border">
        <p className="text-xs text-gray-600">
          Data sourced from Yahoo Finance, CoinGecko, and ECB via Frankfurter.
          Refreshes every 60 seconds. Not financial advice.
        </p>
      </footer>
    </>
  );
}
