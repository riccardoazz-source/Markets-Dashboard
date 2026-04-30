export interface QuoteData {
  symbol: string;
  name: string;
  price: number;
  previousClose?: number;
  change: number;
  changePercent: number;
  currency: string;
  trailingPE?: number | null;
  forwardPE?: number | null;
  marketCap?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  fiftyTwoWeekChangePercent?: number | null;
  volume?: number | null;
}

export interface HistoricalPoint {
  date: string;
  close: number;
}

export interface CurrencyRate {
  pair: string;
  from: string;
  to: string;
  rate: number;
  change?: number;
  changePercent?: number;
}

export interface CurrencyHistoricalPoint {
  date: string;
  rate: number;
}

export interface CryptoData {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change24hPercent: number;
  change7dPercent?: number;
  change1yPercent?: number | null;
  marketCap: number;
  volume24h: number;
  image?: string;
}

export interface SectorData {
  symbol: string;
  name: string;
  category: string;
  price: number;
  changePercent: number;
  ytdReturn?: number;
  oneMonthReturn?: number;
  threeMonthReturn?: number;
  oneYearReturn?: number;
  rank?: number;
}

export interface AssetConfig {
  symbol: string;
  name: string;
  category: string;
  region?: string;
  type: 'index' | 'etf' | 'crypto' | 'commodity' | 'currency' | 'sector' | 'macro';
}

export type Timeframe = '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y' | '10Y' | 'MAX';

export interface CAGRData {
  timeframe: Timeframe;
  return: number;
  cagr: number;
  startDate: string;
  endDate: string;
  startPrice: number;
  endPrice: number;
}

export interface CompareAsset {
  symbol: string;
  name: string;
  type: string;
  color: string;
  /** Series displayed on the chart (may be normalized) — price-only */
  data: HistoricalPoint[];
  /** Normalized (or absolute) total-return series for the chart second line */
  trData?: HistoricalPoint[];
  /** Raw price series (always absolute, in original units), used for stats */
  rawData?: HistoricalPoint[];
  /** Total-return series (price + reinvested dividends, absolute units) */
  totalReturnData?: HistoricalPoint[];
  cagr?: number;
  totalReturn?: number;
  /** CAGR including reinvested dividends */
  cagrWithDiv?: number;
  /** IRR (annualized) treating dividends as cash distributions */
  irr?: number;
  dividends?: { date: string; amount: number }[];
}
