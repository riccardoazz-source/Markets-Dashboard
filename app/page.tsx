'use client';

import { useState } from 'react';
import { Navbar, Section } from '@/components/Navbar';
import { IndexesSection } from '@/components/sections/IndexesSection';
import { CurrenciesSection } from '@/components/sections/CurrenciesSection';
import { CryptoCommoditiesSection } from '@/components/sections/CryptoCommoditiesSection';
import { SectorsSection } from '@/components/sections/SectorsSection';
import { CompareSection } from '@/components/sections/CompareSection';

const SECTION_LABELS: Record<Section, string> = {
  indexes:    'Global Market Indexes',
  currencies: 'Currency Exchange Rates',
  crypto:     'Crypto & Commodities',
  sectors:    'Sector Heat Rankings',
  compare:    'Asset Comparison',
};

const SECTION_DESCRIPTIONS: Record<Section, string> = {
  indexes:    'Live prices, PE ratios and performance for major global indexes and ETFs',
  currencies: 'Real-time currency conversion rates with historical charts and period averages',
  crypto:     'Live cryptocurrency and commodity prices with CAGR and return analysis',
  sectors:    'US sector ETF performance ranked by return — click any sector for details',
  compare:    'Normalized performance comparison across any combination of assets',
};

export default function Home() {
  const [section, setSection] = useState<Section>('indexes');

  return (
    <>
      <Navbar active={section} onSelect={setSection} />
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-white">{SECTION_LABELS[section]}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{SECTION_DESCRIPTIONS[section]}</p>
        </div>

        {section === 'indexes'    && <IndexesSection />}
        {section === 'currencies' && <CurrenciesSection />}
        {section === 'crypto'     && <CryptoCommoditiesSection />}
        {section === 'sectors'    && <SectorsSection />}
        {section === 'compare'    && <CompareSection />}
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
