import { AssetConfig } from './types';

export type MacroUnit = '%' | 'K' | 'idx' | 'B$';

export interface MacroIndicator {
  id: string;
  name: string;
  category: 'Rates' | 'Employment' | 'Inflation' | 'Growth';
  unit: MacroUnit;
}

export const MACRO_INDICATORS: MacroIndicator[] = [
  { id: 'DFF',          name: 'Fed Funds Rate',          category: 'Rates',      unit: '%'   },
  { id: 'DGS10',        name: 'US 10Y Yield',            category: 'Rates',      unit: '%'   },
  { id: 'DGS2',         name: 'US 2Y Yield',             category: 'Rates',      unit: '%'   },
  { id: 'T10Y2Y',       name: 'Yield Curve 10Y–2Y',      category: 'Rates',      unit: '%'   },
  { id: 'MORTGAGE30US', name: '30Y Mortgage Rate',       category: 'Rates',      unit: '%'   },
  { id: 'ECBDFR',       name: 'ECB Deposit Rate',        category: 'Rates',      unit: '%'   },
  { id: 'UNRATE',       name: 'US Unemployment',         category: 'Employment', unit: '%'   },
  { id: 'PAYEMS',       name: 'Nonfarm Payrolls',        category: 'Employment', unit: 'K'   },
  { id: 'ICSA',         name: 'Initial Jobless Claims',  category: 'Employment', unit: 'K'   },
  { id: 'CPIAUCSL',     name: 'CPI (All Items)',         category: 'Inflation',  unit: 'idx' },
  { id: 'CPILFESL',     name: 'Core CPI',                category: 'Inflation',  unit: 'idx' },
  { id: 'T10YIE',       name: '10Y Breakeven Inflation', category: 'Inflation',  unit: '%'   },
  { id: 'GDPC1',        name: 'Real GDP',                category: 'Growth',     unit: 'B$'  },
  { id: 'INDPRO',       name: 'Industrial Production',   category: 'Growth',     unit: 'idx' },
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
];
