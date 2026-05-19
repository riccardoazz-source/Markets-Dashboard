'use client';

import { ExternalLink } from 'lucide-react';
import { MACRO_INDICATORS } from '@/lib/config';

interface SourceRow {
  feature: string;
  provider: string;
  endpoint: string;
  apiRoute: string;
  refresh: string;
  notes?: string;
  homepage: string;
}

const SOURCES: SourceRow[] = [
  {
    feature: 'Indexes & ETF quotes (live + 52W)',
    provider: 'Yahoo Finance',
    endpoint: 'query2.finance.yahoo.com/v8/finance/chart  ·  query1.finance.yahoo.com/v7/finance/quote',
    apiRoute: '/api/quotes',
    refresh: '60 s (client) · 60 s server cache, 30 m stale',
    notes: 'Per-symbol v8 chart used as primary; v7 batch with crumb auth as fallback.',
    homepage: 'https://finance.yahoo.com',
  },
  {
    feature: 'Historical prices (indexes / commodities / sectors)',
    provider: 'Yahoo Finance + Stooq fallback',
    endpoint: 'query{1,2}.finance.yahoo.com/v8/finance/chart  ·  stooq.com/q/d/l',
    apiRoute: '/api/historical',
    refresh: '5 m server cache',
    notes: 'Stooq is queried automatically when Yahoo returns no points (e.g. some futures).',
    homepage: 'https://stooq.com',
  },
  {
    feature: 'Single stock (price, dividends, CAGR, IRR)',
    provider: 'Yahoo Finance',
    endpoint: 'query{1,2}.finance.yahoo.com/v8/finance/chart?events=div,split  ·  v1/finance/search',
    apiRoute: '/api/stock',
    refresh: '5 m server cache',
    notes: 'Search supports ticker, ISIN and company name. Dividends are taken from chart events.',
    homepage: 'https://finance.yahoo.com',
  },
  {
    feature: 'Cryptocurrency quotes & history',
    provider: 'CoinGecko (primary), Yahoo Finance fallback',
    endpoint: 'api.coingecko.com/api/v3  ·  query2.finance.yahoo.com/v8/finance/chart',
    apiRoute: '/api/crypto',
    refresh: '60 s client · server cache TTL inside route',
    notes: 'Yahoo is used when CoinGecko rate-limits.',
    homepage: 'https://www.coingecko.com',
  },
  {
    feature: 'FX rates (live + history)',
    provider: 'Frankfurter (ECB) — pair quoted via Yahoo',
    endpoint: 'api.frankfurter.app  ·  query2.finance.yahoo.com/v8/finance/chart',
    apiRoute: '/api/currencies',
    refresh: '60 s client',
    notes: 'Frankfurter publishes ECB reference rates. Yahoo provides intraday levels.',
    homepage: 'https://www.frankfurter.app',
  },
  {
    feature: 'Sector ETF performance ranking',
    provider: 'Yahoo Finance',
    endpoint: 'query{1,2}.finance.yahoo.com/v8/finance/chart',
    apiRoute: '/api/sectors',
    refresh: '60 s client · 60 s server cache',
    homepage: 'https://finance.yahoo.com',
  },
  {
    feature: 'Macro indicators (rates, CPI, GDP, jobs)',
    provider: 'FRED – Federal Reserve Bank of St. Louis',
    endpoint: 'api.stlouisfed.org/fred/series/observations  ·  fred.stlouisfed.org/graph/fredgraph.csv',
    apiRoute: '/api/macro',
    refresh: '30 m server cache, 6 h stale',
    notes: 'JSON API used when FRED_API_KEY env var is set; otherwise the public CSV endpoint. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html.',
    homepage: 'https://fred.stlouisfed.org',
  },
];

const FORMULAS: { label: string; body: string }[] = [
  { label: 'Total return (with dividends)',
    body: 'Each cash dividend on its ex-date scales the subsequent series by (1 + dividend / close_on_ex_date). Equivalent to reinvesting the dividend in the same security.' },
  { label: 'CAGR',
    body: 'CAGR = (P_end / P_start)^(1 / years) − 1, computed on the visible window. CAGR + Div uses the total-return series above.' },
  { label: 'IRR (Internal Rate of Return)',
    body: 'Solves NPV = 0 over dated cashflows: −P_start at t0, +dividend on each ex-date, +P_end at the last point. Newton–Raphson with bisection fallback. Returned annualized.' },
  { label: 'Correlation matrix',
    body: 'Pearson correlation of daily log-returns of the raw price series, on the union of dates with forward-fill. Range −1…+1.' },
];

export function SourcesSection() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Feature</th>
                <th className="text-left px-3 py-2 font-semibold">Provider</th>
                <th className="text-left px-3 py-2 font-semibold">Endpoint</th>
                <th className="text-left px-3 py-2 font-semibold">Local route</th>
                <th className="text-left px-3 py-2 font-semibold">Refresh</th>
                <th className="text-left px-3 py-2 font-semibold">Docs</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s, idx) => (
                <tr key={s.apiRoute + idx}
                  className="border-t border-border align-top hover:bg-bg-hover/30 transition-colors">
                  <td className="px-3 py-2 text-gray-100 font-medium min-w-[180px]">{s.feature}</td>
                  <td className="px-3 py-2 text-gray-300 min-w-[140px]">{s.provider}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-400 break-all min-w-[220px]">{s.endpoint}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-accent">{s.apiRoute}</td>
                  <td className="px-3 py-2 text-gray-400">{s.refresh}</td>
                  <td className="px-3 py-2">
                    <a href={s.homepage} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline">
                      open <ExternalLink size={10} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Macro indicator sources — auto-generated from lib/config.ts */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 py-3 bg-bg-input border-b border-border">
          <h3 className="text-sm font-semibold text-gray-100">Macro Indicators</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Each indicator&rsquo;s primary source. Add new indicators in{' '}
            <code className="font-mono text-accent">lib/config.ts</code> — no API code changes needed.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Indicator</th>
                <th className="text-left px-3 py-2 font-semibold">Category</th>
                <th className="text-left px-3 py-2 font-semibold">Provider</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold">Link</th>
              </tr>
            </thead>
            <tbody>
              {MACRO_INDICATORS.map(ind => (
                <tr key={ind.id}
                  className="border-t border-border align-top hover:bg-bg-hover/30 transition-colors">
                  <td className="px-3 py-2 text-gray-100 font-medium">{ind.name}</td>
                  <td className="px-3 py-2 text-gray-400">{ind.category}</td>
                  <td className="px-3 py-2 text-gray-300">{ind.source.label}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-400">{ind.source.type}</td>
                  <td className="px-3 py-2">
                    <a href={ind.source.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline">
                      open <ExternalLink size={10} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {SOURCES.some(s => s.notes) && (
        <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-100">Notes per source</h3>
          <ul className="space-y-1.5 text-xs text-gray-300 list-disc pl-5">
            {SOURCES.filter(s => s.notes).map((s, i) => (
              <li key={i}>
                <span className="text-gray-100 font-medium">{s.provider}</span>
                <span className="text-gray-500"> ({s.apiRoute})</span>
                {' — '}{s.notes}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-100">Calculation conventions</h3>
        <ul className="space-y-2 text-xs text-gray-300">
          {FORMULAS.map((f, i) => (
            <li key={i}>
              <p className="text-gray-100 font-medium">{f.label}</p>
              <p className="text-gray-400 mt-0.5">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-100">Troubleshooting</h3>
        <ul className="space-y-1.5 text-xs text-gray-300 list-disc pl-5">
          <li>
            <span className="text-gray-100 font-medium">Macro tab is empty:</span>{' '}
            FRED is occasionally rate-limited from cloud egress IPs. Set
            <code className="font-mono text-accent mx-1">FRED_API_KEY</code> in the
            environment to switch to the JSON API
            (<a className="text-accent hover:underline"
                href="https://fred.stlouisfed.org/docs/api/api_key.html"
                target="_blank" rel="noopener noreferrer">free key</a>).
          </li>
          <li>
            <span className="text-gray-100 font-medium">A Yahoo symbol returns no data:</span>{' '}
            the Stooq fallback automatically kicks in for indexes/commodities. For ETFs/stocks,
            confirm the symbol on the provider page linked above.
          </li>
          <li>
            <span className="text-gray-100 font-medium">CoinGecko 429:</span>{' '}
            crypto charts auto-fall-back to Yahoo (<code className="font-mono">BTC-USD</code> etc.).
          </li>
          <li>
            <span className="text-gray-100 font-medium">ISIN search returns nothing:</span>{' '}
            Yahoo&rsquo;s search supports most US/EU ISINs; if not found, try the local ticker
            (e.g. <code className="font-mono">ENI.MI</code> for ENI on Borsa Italiana).
          </li>
        </ul>
      </div>

      <p className="text-[10px] text-gray-700">
        All data is fetched from public endpoints with conservative caching. None of the
        figures here are guaranteed; verify against the source before making decisions.
        Not financial advice.
      </p>
    </div>
  );
}
