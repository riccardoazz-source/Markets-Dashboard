import { AssetConfig } from './types';

export type MacroUnit = '%' | 'K' | 'idx' | 'B$';
export type MacroCategory = 'Rates' | 'Employment' | 'Inflation' | 'Growth' | 'Real Estate' | 'Money' | 'Commodities' | 'Sentiment' | 'Crypto' | 'Debt' | 'Market Value';

// ---------- Source metadata ----------
// Each MacroIndicator declares its primary data source.
// The API route dispatches fetches based on `source.type`; adding a new
// indicator that uses an existing type requires only a new entry here, no
// changes to the route code.
export type MacroSourceType =
  | 'fred'         // FRED / DBnomics mirror (series id == indicator id unless overridden)
  | 'ecb'          // ECB Data Portal (ECBDFR deposit facility rate)
  | 'bls'          // Bureau of Labor Statistics
  | 'treasury'     // US Treasury yield-curve CSV
  | 'fomc'         // Federal Reserve FOMC rate decisions (hardcoded table + FRED fallback)
  | 'yahoo_price'  // Yahoo Finance price series — symbol required
  | 'yahoo_ratio'  // Yahoo Finance: price(numerator) / price(denominator)
  | 'multpl'       // multpl.com valuation tables — slug required
  | 'gurufocus'    // Gurufocus economic indicators — indicatorId required
  | 'computed';    // computed server-side in the API route (Bitcoin halving, RSI, miner revenue)

export interface MacroSource {
  type: MacroSourceType;
  label: string;        // Human-readable provider name shown in Sources tab
  url: string;          // Deep-link to the indicator's page at the source
  symbol?: string;      // yahoo_price only
  numerator?: string;   // yahoo_ratio only: top symbol
  denominator?: string; // yahoo_ratio only: bottom symbol
  indicatorId?: number; // gurufocus only
  slug?: string;        // multpl only: path slug at multpl.com
}

export interface MacroIndicator {
  id: string;
  name: string;
  category: MacroCategory;
  unit: MacroUnit;
  source: MacroSource;
}

export const MACRO_INDICATORS: MacroIndicator[] = [
  // Rates
  { id: 'DFEDTARU', name: 'USA Interest Rate',     category: 'Rates',       unit: '%',
    source: { type: 'fomc',    label: 'Federal Reserve',
              url: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm' } },
  { id: 'FEDFUNDS', name: 'Effective Fed Funds Rate', category: 'Rates',     unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/FEDFUNDS' } },
  { id: 'ECBDFR',   name: 'EU Interest Rate',      category: 'Rates',       unit: '%',
    source: { type: 'ecb',     label: 'ECB Data Portal',
              url: 'https://data.ecb.europa.eu/data/datasets/FM/FM.B.U2.EUR.4F.KR.DFR.LEV' } },
  { id: 'DGS10',    name: 'US 10Y Yield',          category: 'Rates',       unit: '%',
    source: { type: 'treasury',label: 'US Treasury',
              url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' } },
  { id: 'DGS2',     name: 'US 2Y Yield',           category: 'Rates',       unit: '%',
    source: { type: 'treasury',label: 'US Treasury',
              url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' } },
  // Inflation
  { id: 'CPIAUCSL', name: 'CPI (All Items)',        category: 'Inflation',   unit: 'idx',
    source: { type: 'bls',     label: 'BLS',
              url: 'https://www.bls.gov/cpi/' } },
  { id: 'CPILFESL', name: 'Core CPI',               category: 'Inflation',   unit: 'idx',
    source: { type: 'bls',     label: 'BLS',
              url: 'https://www.bls.gov/cpi/' } },
  // Growth
  { id: 'GDP',      name: 'Nominal GDP',            category: 'Growth',      unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GDP' } },
  { id: 'GDPC1',    name: 'Real GDP',               category: 'Growth',      unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GDPC1' } },
  { id: 'INDPRO',   name: 'Industrial Production',  category: 'Growth',      unit: 'idx',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/INDPRO' } },
  // Employment
  { id: 'UNRATE',   name: 'US Unemployment',        category: 'Employment',  unit: '%',
    source: { type: 'bls',     label: 'BLS',
              url: 'https://www.bls.gov/cps/' } },
  { id: 'PAYEMS',   name: 'Nonfarm Payrolls',       category: 'Employment',  unit: 'K',
    source: { type: 'bls',     label: 'BLS CES',
              url: 'https://www.bls.gov/ces/' } },
  // Real Estate
  { id: 'HOUST',    name: 'Housing Starts',         category: 'Real Estate', unit: 'K',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/HOUST' } },
  { id: 'MORTGAGE30US', name: '30Y Mortgage Rate',  category: 'Real Estate', unit: '%',
    source: { type: 'fred',    label: 'FRED / Freddie Mac',
              url: 'https://fred.stlouisfed.org/series/MORTGAGE30US' } },
  // Money
  { id: 'M2SL',     name: 'M2 Money Stock',         category: 'Money',       unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/M2SL' } },
  // WALCL is reported in millions on FRED; the computed handler divides by 1000 → billions.
  { id: 'WALCL',    name: 'Fed Balance Sheet',       category: 'Money',       unit: 'B$',
    source: { type: 'computed', label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/WALCL' } },
  // Bank credit quality — quarterly FRED series
  { id: 'DRCLACBS', name: 'Consumer Loan Delinquency', category: 'Money',    unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/DRCLACBS' } },
  { id: 'DRALACBN', name: 'All Loans Delinquency',  category: 'Money',       unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/DRALACBN' } },
  { id: 'DRCRELEXFACBS', name: 'CRE Loan Delinquency', category: 'Money',    unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/DRCRELEXFACBS' } },
  // Discontinued quarterly Z.1 Financial Accounts series — latest point may be old.
  // Full FRED title: "Issuers of Asset-Backed Securities; Commercial Mortgages,
  // Including REIT Securitized Commercial Mortgages; Asset, Transactions".
  { id: 'BOGZ1FA673065500Q', name: 'ABS Issuers: Commercial Mortgages', category: 'Money', unit: 'idx',
    source: { type: 'fred',    label: 'FRED (discontinued)',
              url: 'https://fred.stlouisfed.org/series/BOGZ1FA673065500Q' } },
  // Commodities — computed from Yahoo Finance prices; no FRED key needed
  { id: 'GOLD_SILVER', name: 'Gold/Silver Ratio',   category: 'Commodities', unit: 'idx',
    source: { type: 'yahoo_ratio', label: 'Yahoo Finance',
              url: 'https://finance.yahoo.com/commodities',
              numerator: 'GC=F', denominator: 'SI=F' } },
  // Sentiment — CBOE Volatility Index via Yahoo Finance
  { id: 'VIX',      name: 'VIX Volatility Index',    category: 'Sentiment',   unit: 'idx',
    source: { type: 'yahoo_price', label: 'Yahoo Finance',
              url: 'https://finance.yahoo.com/quote/%5EVIX',
              symbol: '^VIX' } },
  // Crypto — computed server-side; bitbo.io charts are the visual reference
  { id: 'BTC_HALVING', name: 'Bitcoin Halvings',      category: 'Crypto',      unit: 'idx',
    source: { type: 'computed', label: 'Bitcoin halving schedule',
              url: 'https://charts.bitbo.io/halving-progress/' } },
  { id: 'BTC_RSI',  name: 'Bitcoin Monthly RSI',     category: 'Crypto',      unit: 'idx',
    source: { type: 'computed', label: 'Computed from BTC-USD (Yahoo)',
              url: 'https://charts.bitbo.io/monthly-rsi/' } },
  { id: 'BTC_MINER_REVENUE', name: 'Miner Monthly Revenue', category: 'Crypto', unit: 'B$',
    source: { type: 'computed', label: 'Computed from halving schedule + BTC-USD (Yahoo)',
              url: 'https://charts.bitbo.io/miner-monthly-revenue/' } },
  { id: 'BTC_MINED_MONTHLY', name: 'Monthly BTC Mined',     category: 'Crypto', unit: 'idx',
    source: { type: 'computed', label: 'Computed from halving schedule',
              url: 'https://charts.bitbo.io/miner-monthly-revenue/' } },
  // Debt — US federal debt and sustainability metrics
  { id: 'GFDEGDQ188S', name: 'Debt / GDP Ratio',     category: 'Debt',        unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GFDEGDQ188S' } },
  { id: 'GFDEBTN',     name: 'US Federal Debt',       category: 'Debt',        unit: 'B$',
    source: { type: 'computed', label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GFDEBTN' } },
  // Growth addition
  { id: 'A939RC0A052NBEA', name: 'Household Net Worth', category: 'Growth',    unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/A939RC0A052NBEA' } },
  // Market Value — valuation ratios. multpl.com is reliably scrapable;
  // Gurufocus is Cloudflare-protected so its series are best-effort.
  { id: 'SP500_PE',         name: 'S&P 500 P/E Ratio',        category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-pe-ratio',
              slug: 's-p-500-pe-ratio' } },
  { id: 'SHILLER_CAPE',     name: 'S&P 500 Shiller CAPE',      category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/shiller-pe',
              slug: 'shiller-pe' } },
  { id: 'SP500_EPS',        name: 'S&P 500 EPS (TTM)',         category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-earnings',
              slug: 's-p-500-earnings' } },
  { id: 'SP500_PSALES',     name: 'S&P 500 Price/Sales',       category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-price-to-sales',
              slug: 's-p-500-price-to-sales' } },
  { id: 'SP500_PBOOK',      name: 'S&P 500 Price/Book',        category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-price-to-book',
              slug: 's-p-500-price-to-book' } },
  { id: 'SP500_EYIELD',     name: 'S&P 500 Earnings Yield',    category: 'Market Value', unit: '%',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-earnings-yield',
              slug: 's-p-500-earnings-yield' } },
  { id: 'BUFFETT_IND',      name: 'Buffett Indicator',         category: 'Market Value', unit: '%',
    source: { type: 'gurufocus', label: 'Gurufocus',
              url: 'https://www.gurufocus.com/economic_indicators/60/buffett-indicator',
              indicatorId: 60 } },
  { id: 'NDX100_PE',        name: 'NASDAQ 100 P/E Ratio',      category: 'Market Value', unit: 'idx',
    source: { type: 'gurufocus', label: 'Gurufocus',
              url: 'https://www.gurufocus.com/economic_indicators/6778/nasdaq-100-pe-ratio',
              indicatorId: 6778 } },
];

// Bitcoin halving dates (exported so UI components can render them as reference lines).
export const BTC_HALVING_DATES: string[] = [
  '2012-11-28', // 1st: 50 → 25 BTC
  '2016-07-09', // 2nd: 25 → 12.5 BTC
  '2020-05-11', // 3rd: 12.5 → 6.25 BTC
  '2024-04-20', // 4th: 6.25 → 3.125 BTC
];

export const INDEXES: AssetConfig[] = [
  { symbol: '^GSPC',     name: 'S&P 500',              category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^NDX',      name: 'NASDAQ 100',            category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^DJI',      name: 'Dow Jones',             category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^RUT',      name: 'Russell 2000',          category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50',         category: 'Europe',         region: 'EU',      type: 'index' },
  { symbol: '^GDAXI',    name: 'DAX',                   category: 'Germany',        region: 'EU',      type: 'index' },
  { symbol: '^FTSE',     name: 'FTSE 100',              category: 'UK',             region: 'EU',      type: 'index' },
  { symbol: '^FCHI',     name: 'CAC 40',                category: 'France',         region: 'EU',      type: 'index' },
  { symbol: 'URTH',      name: 'MSCI World',            category: 'Global',         region: 'Global',  type: 'etf'   },
  { symbol: 'ACWI',      name: 'MSCI ACWI',             category: 'Global',         region: 'Global',  type: 'etf'   },
  { symbol: 'EEM',       name: 'MSCI Emerg. Markets',   category: 'Emerging',       region: 'EM',      type: 'etf'   },
  { symbol: '^N225',     name: 'Nikkei 225',            category: 'Japan',          region: 'Asia',    type: 'index' },
  { symbol: 'FXI',       name: 'China Large-Cap',       category: 'China',          region: 'Asia',    type: 'etf'   },
  { symbol: 'INDA',      name: 'MSCI India',            category: 'India',          region: 'Asia',    type: 'etf'   },
];

export const COMMODITIES: AssetConfig[] = [
  { symbol: 'GC=F',  name: 'Gold',         category: 'Metals',  type: 'commodity' },
  { symbol: 'SI=F',  name: 'Silver',       category: 'Metals',  type: 'commodity' },
  { symbol: 'PL=F',  name: 'Platinum',     category: 'Metals',  type: 'commodity' },
  { symbol: 'CL=F',  name: 'WTI Crude',    category: 'Energy',  type: 'commodity' },
  { symbol: 'BZ=F',  name: 'Brent Crude',  category: 'Energy',  type: 'commodity' },
  { symbol: 'NG=F',  name: 'Natural Gas',  category: 'Energy',  type: 'commodity' },
  { symbol: 'HG=F',  name: 'Copper',       category: 'Metals',  type: 'commodity' },
  { symbol: 'ZW=F',  name: 'Wheat',        category: 'Agri',    type: 'commodity' },
  { symbol: 'ZC=F',  name: 'Corn',         category: 'Agri',    type: 'commodity' },
];

export const CRYPTO_IDS = [
  { id: 'bitcoin',          symbol: 'BTC', name: 'Bitcoin'   },
  { id: 'ethereum',         symbol: 'ETH', name: 'Ethereum'  },
  { id: 'solana',           symbol: 'SOL', name: 'Solana'    },
  { id: 'binancecoin',      symbol: 'BNB', name: 'BNB'       },
  { id: 'ripple',           symbol: 'XRP', name: 'XRP'       },
  { id: 'cardano',          symbol: 'ADA', name: 'Cardano'   },
  { id: 'avalanche-2',      symbol: 'AVAX',name: 'Avalanche' },
  { id: 'chainlink',        symbol: 'LINK',name: 'Chainlink' },
];

export const CRYPTO_YAHOO_SYMBOLS: Record<string, string> = {
  bitcoin:     'BTC-USD',
  ethereum:    'ETH-USD',
  solana:      'SOL-USD',
  binancecoin: 'BNB-USD',
  ripple:      'XRP-USD',
  cardano:     'ADA-USD',
  'avalanche-2':'AVAX-USD',
  chainlink:   'LINK-USD',
};

export const SECTORS: AssetConfig[] = [
  { symbol: 'XLK',   name: 'Technology',             category: 'Tech',       type: 'sector' },
  { symbol: 'SOXX',  name: 'Semiconductors',          category: 'Tech',       type: 'sector' },
  { symbol: 'AIQ',   name: 'AI & Machine Learning',   category: 'Tech',       type: 'sector' },
  { symbol: 'WCLD',  name: 'Cloud Computing',         category: 'Tech',       type: 'sector' },
  { symbol: 'CIBR',  name: 'Cybersecurity',           category: 'Tech',       type: 'sector' },
  { symbol: 'XLV',   name: 'Healthcare',              category: 'Health',     type: 'sector' },
  { symbol: 'XBI',   name: 'Biotech & Pharma',        category: 'Health',     type: 'sector' },
  { symbol: 'XLF',   name: 'Financials',              category: 'Finance',    type: 'sector' },
  { symbol: 'XLY',   name: 'Consumer Discr.',         category: 'Consumer',   type: 'sector' },
  { symbol: 'XLP',   name: 'Consumer Staples',        category: 'Consumer',   type: 'sector' },
  { symbol: 'XLE',   name: 'Energy & Utilities',      category: 'Energy',     type: 'sector' },
  { symbol: 'NLR',   name: 'Nuclear & Uranium',       category: 'Energy',     type: 'sector' },
  { symbol: 'ICLN',  name: 'Clean Energy',            category: 'Energy',     type: 'sector' },
  { symbol: 'XLI',   name: 'Industrials',             category: 'Industrial', type: 'sector' },
  { symbol: 'ITA',   name: 'Defense & Aerospace',     category: 'Industrial', type: 'sector' },
  { symbol: 'BOTZ',  name: 'Robotics & Automation',   category: 'Industrial', type: 'sector' },
  { symbol: 'DRIV',  name: 'Electric Vehicles',       category: 'EV',         type: 'sector' },
  { symbol: 'XLB',   name: 'Materials',               category: 'Materials',  type: 'sector' },
  { symbol: 'XLRE',  name: 'Real Estate',             category: 'Real Estate',type: 'sector' },
  { symbol: 'XLU',   name: 'Utilities',               category: 'Utilities',  type: 'sector' },
];

// Currency metadata — flag emoji + ISO-3166 country code + full name, keyed by
// ISO currency code. `cc` is used to load a real flag image (emoji flags don't
// render on Windows).
export const CURRENCY_META: Record<string, { name: string; flag: string; cc: string }> = {
  USD: { name: 'US Dollar',          flag: '🇺🇸', cc: 'us' },
  EUR: { name: 'Euro',               flag: '🇪🇺', cc: 'eu' },
  GBP: { name: 'British Pound',      flag: '🇬🇧', cc: 'gb' },
  JPY: { name: 'Japanese Yen',       flag: '🇯🇵', cc: 'jp' },
  CHF: { name: 'Swiss Franc',        flag: '🇨🇭', cc: 'ch' },
  AUD: { name: 'Australian Dollar',  flag: '🇦🇺', cc: 'au' },
  CAD: { name: 'Canadian Dollar',    flag: '🇨🇦', cc: 'ca' },
  NZD: { name: 'New Zealand Dollar', flag: '🇳🇿', cc: 'nz' },
  CNY: { name: 'Chinese Yuan',       flag: '🇨🇳', cc: 'cn' },
  INR: { name: 'Indian Rupee',       flag: '🇮🇳', cc: 'in' },
  MXN: { name: 'Mexican Peso',       flag: '🇲🇽', cc: 'mx' },
  BRL: { name: 'Brazilian Real',     flag: '🇧🇷', cc: 'br' },
  SEK: { name: 'Swedish Krona',      flag: '🇸🇪', cc: 'se' },
};

// Each group is shown as one card with BOTH directions (base→quote and the
// inverse quote→base). Only USD- and EUR-based pairs are tracked — the base
// currency is always USD or EUR so it leads in the card layout.
export const CURRENCY_GROUPS: { base: string; quote: string }[] = [
  { base: 'EUR', quote: 'USD' },
  { base: 'USD', quote: 'GBP' },
  { base: 'USD', quote: 'JPY' },
  { base: 'USD', quote: 'CHF' },
  { base: 'USD', quote: 'CNY' },
  { base: 'USD', quote: 'CAD' },
  { base: 'USD', quote: 'AUD' },
  { base: 'USD', quote: 'NZD' },
  { base: 'USD', quote: 'MXN' },
  { base: 'USD', quote: 'INR' },
  { base: 'USD', quote: 'BRL' },
  { base: 'USD', quote: 'SEK' },
  { base: 'EUR', quote: 'GBP' },
  { base: 'EUR', quote: 'JPY' },
  { base: 'EUR', quote: 'CHF' },
  { base: 'EUR', quote: 'CNY' },
  { base: 'EUR', quote: 'CAD' },
  { base: 'EUR', quote: 'AUD' },
  { base: 'EUR', quote: 'NZD' },
  { base: 'EUR', quote: 'MXN' },
  { base: 'EUR', quote: 'INR' },
  { base: 'EUR', quote: 'BRL' },
  { base: 'EUR', quote: 'SEK' },
];

// Flat list of every pair direction (used by the Compare section and note
// validation). Derived from CURRENCY_GROUPS so both directions always exist.
export const CURRENCY_PAIRS = CURRENCY_GROUPS.flatMap(g => [
  { from: g.base,  to: g.quote, symbol: `${g.base}${g.quote}=X` },
  { from: g.quote, to: g.base,  symbol: `${g.quote}${g.base}=X` },
]);

export const ALL_COMPARABLE_ASSETS = [
  ...INDEXES.map(a => ({ ...a, group: 'Indexes' })),
  ...COMMODITIES.map(a => ({ ...a, group: 'Commodities' })),
  ...CRYPTO_IDS.map(a => ({ symbol: `${a.symbol}-USD`, name: a.name, category: 'Crypto', type: 'crypto' as const, group: 'Crypto' })),
  ...SECTORS.map(a => ({ ...a, group: 'Sectors' })),
  ...MACRO_INDICATORS.map(m => ({ symbol: m.id, name: m.name, category: m.category, type: 'macro' as const, group: 'Macro' })),
  ...CURRENCY_PAIRS.map(c => ({
    symbol: c.symbol,
    name: `${c.from}/${c.to}`,
    category: 'FX',
    type: 'currency' as const,
    group: 'FX',
  })),
];
