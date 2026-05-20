import { AssetConfig } from './types';

export type MacroUnit = '%' | 'K' | 'idx' | 'B$';
export type MacroCategory = 'Rates' | 'Employment' | 'Inflation' | 'Growth' | 'Real Estate' | 'Money' | 'Commodities' | 'Sentiment' | 'Crypto';

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
  | 'computed';    // computed server-side in the API route (Bitcoin halving, RSI)

export interface MacroSource {
  type: MacroSourceType;
  label: string;        // Human-readable provider name shown in Sources tab
  url: string;          // Deep-link to the indicator's page at the source
  symbol?: string;      // yahoo_price only
  numerator?: string;   // yahoo_ratio only: top symbol
  denominator?: string; // yahoo_ratio only: bottom symbol
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

export const CURRENCY_PAIRS = [
  { from: 'USD', to: 'EUR', symbol: 'USDEUR=X' },
  { from: 'EUR', to: 'USD', symbol: 'EURUSD=X' },
  { from: 'GBP', to: 'USD', symbol: 'GBPUSD=X' },
  { from: 'USD', to: 'JPY', symbol: 'USDJPY=X' },
  { from: 'USD', to: 'CHF', symbol: 'USDCHF=X' },
  { from: 'USD', to: 'CNY', symbol: 'USDCNY=X' },
  { from: 'USD', to: 'INR', symbol: 'USDINR=X' },
  { from: 'USD', to: 'CAD', symbol: 'USDCAD=X' },
  { from: 'EUR', to: 'GBP', symbol: 'EURGBP=X' },
  { from: 'EUR', to: 'JPY', symbol: 'EURJPY=X' },
];

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
