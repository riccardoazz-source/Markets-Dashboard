import { AssetConfig } from './types';

export type MacroUnit = '%' | 'K' | 'idx' | 'B$' | '$';
export type MacroCategory = 'Rates' | 'Employment' | 'Inflation' | 'Growth' | 'Real Estate' | 'Money' | 'Commodities' | 'Sentiment' | 'Crypto' | 'Debt' | 'Market Value' | 'Recessions';

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
  | 'multpl'       // multpl.com valuation tables (via reader proxy) — slug required
  | 'computed';    // computed server-side in the API route (Bitcoin halving, RSI, miner revenue)

export interface MacroSource {
  type: MacroSourceType;
  label: string;        // Human-readable provider name shown in Sources tab
  url: string;          // Deep-link to the indicator's page at the source
  symbol?: string;      // yahoo_price only
  numerator?: string;   // yahoo_ratio only: top symbol
  denominator?: string; // yahoo_ratio only: bottom symbol
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
  // 10Y-2Y spread — goes negative during yield-curve inversions (recession leading indicator)
  { id: 'T10Y2Y',   name: '10Y–2Y Spread',          category: 'Rates',       unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/T10Y2Y' } },
  // FOMC meeting dates — rendered as vertical reference lines (event overlay, not a data series)
  { id: 'FOMC_MEETINGS', name: 'FOMC Meeting Dates', category: 'Rates',      unit: 'idx',
    source: { type: 'computed', label: 'Federal Reserve',
              url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' } },
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
  { id: 'BTC_PRODUCTION_COST', name: 'BTC Production Cost',  category: 'Crypto', unit: '$',
    source: { type: 'computed', label: 'Computed: network hashrate × 25 J/TH × $0.05/kWh (blockchain.info)',
              url: 'https://en.macromicro.me/series/8194/bitcoin-production-total-cost' } },
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
  // Market Value — S&P 500 valuation ratios from multpl.com (fetched through a
  // reader proxy because multpl blocks datacenter IPs directly).
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
  { id: 'SP500_EYIELD',     name: 'S&P 500 Earnings Yield',    category: 'Market Value', unit: '%',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-earnings-yield',
              slug: 's-p-500-earnings-yield' } },
  { id: 'SP500_PSALES',     name: 'S&P 500 Price/Sales',       category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-price-to-sales',
              slug: 's-p-500-price-to-sales' } },
  { id: 'SP500_PBOOK',      name: 'S&P 500 Price/Book',        category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-price-to-book',
              slug: 's-p-500-price-to-book' } },
  // Recessions — official NBER / OECD recession indicators. Binary 0/1 monthly
  // series: 1 = economy in recession. Rendered as shaded bands, not lines, so
  // they can be overlaid on any chart in Compare.
  // Only USREC (NBER-based) is kept — it is the one recession series FRED still
  // actively maintains. The OECD-based country indicators were discontinued
  // around 2022 and would never reflect a new recession, so they are excluded.
  { id: 'USREC',        name: 'US Recessions',        category: 'Recessions', unit: 'idx',
    source: { type: 'fred',    label: 'FRED / NBER',
              url: 'https://fred.stlouisfed.org/series/USREC' } },
  // Sahm Rule: 3-month moving avg of unemployment minus its 12-month trough.
  // Readings ≥ 0.5% have historically coincided with the start of a recession.
  { id: 'SAHMREALTIME', name: 'Sahm Rule Indicator',  category: 'Recessions', unit: '%',
    source: { type: 'fred',    label: 'FRED / Claudia Sahm',
              url: 'https://fred.stlouisfed.org/series/SAHMREALTIME' } },
];

// Recession indicator series — handled specially everywhere (shaded bands
// instead of lines). RECESSION_META carries the band label + tint for each.
export const RECESSION_SERIES = ['USREC'];

export const RECESSION_META: Record<string, { label: string; color: string }> = {
  USREC: { label: 'US Recession', color: '#64748b' },
};

// FOMC meeting dates (statement release day) — used for vertical reference lines in Compare.
// Includes emergency inter-meeting actions; sorted ascending. Last update: 2026-05-22.
export const FOMC_MEETING_DATES: string[] = [
  // 2000
  '2000-02-02','2000-03-21','2000-05-16','2000-06-28','2000-08-22','2000-10-03','2000-11-15','2000-12-19',
  // 2001 (incl. Jan 3, Apr 18, Sep 17, Oct 2 emergency)
  '2001-01-03','2001-01-31','2001-03-20','2001-04-18','2001-05-15','2001-06-27','2001-08-21',
  '2001-09-17','2001-10-02','2001-11-06','2001-12-11',
  // 2002
  '2002-01-30','2002-03-19','2002-05-07','2002-06-26','2002-08-13','2002-09-24','2002-11-06','2002-12-10',
  // 2003
  '2003-01-29','2003-03-18','2003-05-06','2003-06-25','2003-08-12','2003-09-16','2003-10-28','2003-12-09',
  // 2004
  '2004-01-28','2004-03-16','2004-05-04','2004-06-30','2004-08-10','2004-09-21','2004-11-10','2004-12-14',
  // 2005
  '2005-02-02','2005-03-22','2005-05-03','2005-06-30','2005-08-09','2005-09-20','2005-11-01','2005-12-13',
  // 2006
  '2006-01-31','2006-03-28','2006-05-10','2006-06-29','2006-08-08','2006-09-20','2006-10-25','2006-12-12',
  // 2007
  '2007-01-31','2007-03-21','2007-05-09','2007-06-28','2007-08-07','2007-09-18','2007-10-31','2007-12-11',
  // 2008 (incl. Jan 22, Oct 8 emergency)
  '2008-01-22','2008-01-30','2008-03-18','2008-04-30','2008-06-25','2008-08-05',
  '2008-09-16','2008-10-08','2008-10-29','2008-12-16',
  // 2009
  '2009-01-28','2009-03-18','2009-04-29','2009-06-24','2009-08-12','2009-09-23','2009-11-04','2009-12-16',
  // 2010
  '2010-01-27','2010-03-16','2010-04-28','2010-06-23','2010-08-10','2010-09-21','2010-11-03','2010-12-14',
  // 2011
  '2011-01-26','2011-03-15','2011-04-27','2011-06-22','2011-08-09','2011-09-21','2011-11-02','2011-12-13',
  // 2012
  '2012-01-25','2012-03-13','2012-04-25','2012-06-20','2012-08-01','2012-09-13','2012-10-24','2012-12-12',
  // 2013
  '2013-01-30','2013-03-20','2013-05-01','2013-06-19','2013-07-31','2013-09-18','2013-10-30','2013-12-18',
  // 2014
  '2014-01-29','2014-03-19','2014-04-30','2014-06-18','2014-07-30','2014-09-17','2014-10-29','2014-12-17',
  // 2015
  '2015-01-28','2015-03-18','2015-04-29','2015-06-17','2015-07-29','2015-09-17','2015-10-28','2015-12-16',
  // 2016
  '2016-01-27','2016-03-16','2016-04-27','2016-06-15','2016-07-27','2016-09-21','2016-11-02','2016-12-14',
  // 2017
  '2017-02-01','2017-03-15','2017-05-03','2017-06-14','2017-07-26','2017-09-20','2017-11-01','2017-12-13',
  // 2018
  '2018-01-31','2018-03-21','2018-05-02','2018-06-13','2018-08-01','2018-09-26','2018-11-08','2018-12-19',
  // 2019
  '2019-01-30','2019-03-20','2019-05-01','2019-06-19','2019-07-31','2019-09-18','2019-10-30','2019-12-11',
  // 2020 (incl. Mar 3, Mar 15 emergency)
  '2020-01-29','2020-03-03','2020-03-15','2020-04-29','2020-06-10','2020-07-29','2020-09-16','2020-11-05','2020-12-16',
  // 2021
  '2021-01-27','2021-03-17','2021-04-28','2021-06-16','2021-07-28','2021-09-22','2021-11-03','2021-12-15',
  // 2022
  '2022-01-26','2022-03-16','2022-05-04','2022-06-15','2022-07-27','2022-09-21','2022-11-02','2022-12-14',
  // 2023
  '2023-02-01','2023-03-22','2023-05-03','2023-06-14','2023-07-26','2023-09-20','2023-11-01','2023-12-13',
  // 2024
  '2024-01-31','2024-03-20','2024-05-01','2024-06-12','2024-07-31','2024-09-18','2024-11-07','2024-12-18',
  // 2025
  '2025-01-29','2025-03-19','2025-05-07','2025-06-18','2025-07-30','2025-09-17','2025-10-29','2025-12-10',
  // 2026 — past meetings
  '2026-01-28','2026-03-18','2026-05-06',
  // 2026 — future projected meetings
  '2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09',
];

// Federal Reserve chair change events — rendered as red reference lines on the FOMC chart.
// Each entry is the date the new chair's term began (took office / oath of office),
// sourced from https://en.wikipedia.org/wiki/Chair_of_the_Federal_Reserve.
// Complete history since the Fed's founding in 1914.
export const FED_CHAIR_CHANGES: { date: string; name: string }[] = [
  { date: '1914-08-10', name: 'Hamlin' },        // Charles S. Hamlin
  { date: '1916-08-10', name: 'Harding' },       // W. P. G. Harding
  { date: '1923-05-01', name: 'Crissinger' },    // Daniel R. Crissinger
  { date: '1927-10-04', name: 'Young' },         // Roy A. Young
  { date: '1930-09-16', name: 'Meyer' },         // Eugene Meyer
  { date: '1933-05-19', name: 'Black' },         // Eugene R. Black
  { date: '1934-11-15', name: 'Eccles' },        // Marriner S. Eccles
  { date: '1948-04-15', name: 'McCabe' },        // Thomas B. McCabe
  { date: '1951-04-02', name: 'Martin' },        // William McChesney Martin Jr.
  { date: '1970-02-01', name: 'Burns' },         // Arthur F. Burns
  { date: '1978-03-08', name: 'Miller' },        // G. William Miller
  { date: '1979-08-06', name: 'Volcker' },       // Paul Volcker
  { date: '1987-08-11', name: 'Greenspan' },     // Alan Greenspan
  { date: '2006-02-01', name: 'Bernanke' },      // Ben Bernanke
  { date: '2014-02-03', name: 'Yellen' },        // Janet Yellen
  { date: '2018-02-05', name: 'Powell' },        // Jerome Powell
  { date: '2026-05-22', name: 'Warsh' },         // Kevin Warsh
];

// Bitcoin halving dates (exported so UI components can render them as reference lines).
export const BTC_HALVING_DATES: string[] = [
  '2012-11-28', // 1st: 50 → 25 BTC
  '2016-07-09', // 2nd: 25 → 12.5 BTC
  '2020-05-11', // 3rd: 12.5 → 6.25 BTC
  '2024-04-20', // 4th: 6.25 → 3.125 BTC
];

// Pure stock-market indices — Yahoo Finance native index symbols where they
// exist. MSCI World and MSCI EM IMI do not have reliable free price-index
// symbols on Yahoo Finance, so we use accumulating UCITS ETFs as proxies:
// they don't distribute dividends, so they behave like a price level in the UI
// (no DIV badge, no dividend distortion in returns).
export const INDEXES: AssetConfig[] = [
  { symbol: '^GSPC',     name: 'S&P 500',              category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^NDX',      name: 'NASDAQ 100',            category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^DJI',      name: 'Dow Jones',             category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^RUT',      name: 'Russell 2000',          category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50',         category: 'Europe',         region: 'EU',      type: 'index' },
  { symbol: '^STOXX',    name: 'STOXX Europe 600',      category: 'Europe',         region: 'EU',      type: 'index' },
  { symbol: '^GDAXI',    name: 'DAX',                   category: 'Germany',        region: 'EU',      type: 'index' },
  { symbol: '^FTSE',     name: 'FTSE 100',              category: 'UK',             region: 'EU',      type: 'index' },
  { symbol: '^FCHI',     name: 'CAC 40',                category: 'France',         region: 'EU',      type: 'index' },
  // Global / EM — MSCI price-return indices (USD, no dividends)
  { symbol: '^990100-USD-STRD', name: 'MSCI World',          category: 'Global',         region: 'Global',  type: 'index' },
  { symbol: 'EIMI.L',          name: 'MSCI Emerg. Markets', category: 'Emerging',        region: 'EM',      type: 'etf'   },
  { symbol: '^N225',     name: 'Nikkei 225',            category: 'Japan',          region: 'Asia',    type: 'index' },
  { symbol: '^HSI',      name: 'Hang Seng',             category: 'Hong Kong',      region: 'Asia',    type: 'index' },
  { symbol: '000300.SS', name: 'CSI 300',               category: 'China',          region: 'Asia',    type: 'index' },
  { symbol: '^BSESN',    name: 'BSE Sensex',            category: 'India',          region: 'Asia',    type: 'index' },
  { symbol: '^KS11',     name: 'KOSPI',                 category: 'Korea',          region: 'Asia',    type: 'index' },
  { symbol: '^AXJO',     name: 'ASX 200',               category: 'Australia',      region: 'Asia',    type: 'index' },
  { symbol: '^GSPTSE',   name: 'TSX Composite',         category: 'Canada',         region: 'America', type: 'index' },
  { symbol: '^BVSP',     name: 'Bovespa',               category: 'Brazil',         region: 'America', type: 'index' },
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
  { symbol: 'MAGS',  name: 'Magnificent Seven',       category: 'Tech',       type: 'sector' },
  { symbol: 'XLV',   name: 'Healthcare',              category: 'Health',     type: 'sector' },
  { symbol: 'XBI',   name: 'Biotech & Pharma',        category: 'Health',     type: 'sector' },
  { symbol: 'XLF',   name: 'Financials',              category: 'Finance',    type: 'sector' },
  { symbol: 'EXV1.DE',name: 'EU Banks (STOXX 600)',   category: 'Finance',    type: 'sector' },
  { symbol: 'BITQ',  name: 'Crypto & Digital Payments',category: 'Crypto',    type: 'sector' },
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
  { symbol: 'XLRE',  name: 'Real Estate (US)',        category: 'Real Estate',type: 'sector' },
  { symbol: 'IYR',   name: 'iShares US Real Estate',  category: 'Real Estate',type: 'sector' },
  { symbol: 'IPRP.AS',name: 'iShares EU Property Yield',category: 'Real Estate',type: 'sector' },
  { symbol: 'IUKP.L',name: 'iShares UK Property',     category: 'Real Estate',type: 'sector' },
  { symbol: 'BIZD',  name: 'BDC Income (VanEck)',     category: 'BDC',        type: 'sector' },
  { symbol: 'XLU',   name: 'Utilities',               category: 'Utilities',  type: 'sector' },
  // US Treasuries — USD-listed on NYSE (NAV in USD)
  { symbol: 'SHY',   name: 'US Treasury 1-3yr',       category: 'Bonds',      type: 'sector' },
  { symbol: 'IEF',   name: 'US Treasury 7-10yr',      category: 'Bonds',      type: 'sector' },
  { symbol: 'TLT',   name: 'US Treasury 20+yr',       category: 'Bonds',      type: 'sector' },
  // EU Government Bonds — EUR-listed on Euronext Amsterdam (NAV in EUR)
  { symbol: 'IBGS.AS',name: 'EU Govt Bond 1-3yr',     category: 'Bonds',      type: 'sector' },
  { symbol: 'IBGM.AS',name: 'EU Govt Bond 7-10yr',    category: 'Bonds',      type: 'sector' },
  { symbol: 'IBGL.AS',name: 'EU Govt Bond 15-30yr',   category: 'Bonds',      type: 'sector' },
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
