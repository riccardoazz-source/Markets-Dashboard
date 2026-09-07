// ─────────────────────────────────────────────────────────────────────────────
// Yahoo symbol → TradingView symbol.
//
// The two vendors name the same instrument differently, and TradingView will not
// resolve Yahoo's syntax: '^GSPC' opens nothing, 'GC=F' opens nothing, 'BTC-USD'
// opens nothing. Worse, a WRONG guess opens a real chart of the wrong instrument —
// 'SI' is a listed company, not silver — so a link that silently lands somewhere
// else is more damaging than a link that does not appear at all.
//
// Hence: exact tables for everything whose mapping is not derivable, rules only
// where the transformation is mechanical, and null when neither applies, in which
// case the caller shows no button rather than a misleading one.
//
// One thing a table cannot fix: TradingView's EMBED refuses exchanges that require an
// entitlement — KRX, SGX and the like — and, rather than saying so, draws its default
// instrument. The symbol is right, the frame is another origin, and the page cannot
// tell. The panel therefore always offers "Full site", which does serve them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indices. TVC: is TradingView's own index feed and needs no exchange entitlement.
 *
 * These are CANDIDATES, not answers: /api/tv-symbol checks each one against
 * TradingView's symbol search and replaces it when it does not exist, because their
 * embed draws its default instrument for an unknown symbol instead of failing.
 */
const INDEX_MAP: Record<string, string> = {
  '^GSPC': 'TVC:SPX',
  '^NDX': 'TVC:NDX',
  '^IXIC': 'TVC:IXIC',
  '^DJI': 'TVC:DJI',
  '^RUT': 'TVC:RUT',
  '^STOXX50E': 'TVC:SX5E',
  '^STOXX': 'TVC:SXXP',
  '^GDAXI': 'TVC:DAX',
  '^FTSE': 'TVC:UKX',
  '^FCHI': 'TVC:CAC40',
  '^N225': 'TVC:NI225',
  '^HSI': 'TVC:HSI',
  '^STI': 'TVC:STI',
  '^BSESN': 'BSE:SENSEX',
  // TVC has no KOSPI: the embed answered a request for it by quietly drawing Apple,
  // which is why every symbol is now checked against TradingView's search before use.
  '^KS11': 'KRX:KOSPI',
  '^AXJO': 'ASX:XJO',
  '^GSPTSE': 'TSX:TSX',
  '^BVSP': 'BMFBOVESPA:IBOV',
  '^VIX': 'TVC:VIX',
  '^TNX': 'TVC:TNX',
  '000300.SS': 'SSE:000300',
  // MSCI World has no free TradingView index; the iShares tracker is the closest
  // thing that is actually the same exposure, and it is labelled as such below.
  '^990100-USD-STRD': 'AMEX:URTH',
};

/**
 * Continuous futures. '1!' is TradingView's front-month continuous contract, which
 * is what Yahoo's '=F' series is. Metals and energy also exist as spot feeds
 * (TVC:GOLD, TVC:USOIL) but those are a different series from the one charted here,
 * so the futures are the honest match.
 */
const FUTURES_MAP: Record<string, string> = {
  'GC=F': 'COMEX:GC1!',
  'SI=F': 'COMEX:SI1!',
  'PL=F': 'NYMEX:PL1!',
  'PA=F': 'NYMEX:PA1!',
  'HG=F': 'COMEX:HG1!',
  'CL=F': 'NYMEX:CL1!',
  'BZ=F': 'NYMEX:BZ1!',
  'NG=F': 'NYMEX:NG1!',
  'ZW=F': 'CBOT:ZW1!',
  'ZC=F': 'CBOT:ZC1!',
  'ZS=F': 'CBOT:ZS1!',
  'KC=F': 'ICEUS:KC1!',
  'SB=F': 'ICEUS:SB1!',
  'CC=F': 'ICEUS:CC1!',
  'DX=F': 'ICEUS:DX1!',
};

/** Tickers whose exchange TradingView cannot infer from the symbol alone. */
const EXCHANGE_MAP: Record<string, string> = {
  'EIMI.L': 'LSE:EIMI',
  'IUKP.L': 'LSE:IUKP',
  'IWDA.L': 'LSE:IWDA',
  'VWRL.L': 'LSE:VWRL',
  'EXV1.DE': 'XETR:EXV1',
  'SXRV.DE': 'XETR:SXRV',
  'IPRP.AS': 'EURONEXT:IPRP',
  'IBGS.AS': 'EURONEXT:IBGS',
  'IBGM.AS': 'EURONEXT:IBGM',
  'IBGL.AS': 'EURONEXT:IBGL',
};

/**
 * Yahoo's venue suffix → TradingView's exchange prefix.
 *
 * This used to hold three entries, "the three European markets this app actually holds".
 * That premise was true of the CONFIG and false of the app: the Stocks tab takes any
 * ticker the user types, and a watchlist full of Munich lines (1EL.MU, 4OQ.MU) got no
 * TradingView button at all — an unmapped suffix returns null, and a null candidate
 * renders nothing, with no hint that a venue table was the reason.
 *
 * Being conservative was the wrong instinct here, because of where the caution already
 * sits: /api/tv-symbol verifies every candidate against TradingView's own search and can
 * swap in a better one, so a slightly wrong prefix gets CORRECTED, while a missing entry
 * removes the feature. A candidate that might be improved beats no candidate.
 *
 * These are published venue codes, not inferences. Anything still unlisted stays unmapped.
 */
const SUFFIX_EXCHANGE: Record<string, string> = {
  // Europe
  L:  'LSE',        // London
  DE: 'XETR',       // Xetra
  F:  'FWB',        // Frankfurt
  MU: 'MUN',        // Munich
  BE: 'BER',        // Berlin
  AS: 'EURONEXT',   // Amsterdam
  PA: 'EURONEXT',   // Paris
  BR: 'EURONEXT',   // Brussels
  LS: 'EURONEXT',   // Lisbon
  IR: 'EURONEXT',   // Dublin
  MI: 'MIL',        // Milan
  MC: 'BME',        // Madrid
  SW: 'SIX',        // Zurich
  VI: 'VIE',        // Vienna
  ST: 'OMXSTO',     // Stockholm
  CO: 'OMXCOP',     // Copenhagen
  HE: 'OMXHEX',     // Helsinki
  OL: 'OSL',        // Oslo
  WA: 'GPW',        // Warsaw
  AT: 'ATHEX',      // Athens
  // Americas
  TO: 'TSX',        // Toronto
  V:  'TSXV',       // TSX Venture
  MX: 'BMV',        // Mexico
  SA: 'BMFBOVESPA', // São Paulo
  // Asia-Pacific
  HK: 'HKEX',
  T:  'TSE',        // Tokyo
  SS: 'SSE',        // Shanghai
  SZ: 'SZSE',       // Shenzhen
  TW: 'TWSE',       // Taiwan
  KS: 'KRX',        // Korea
  SI: 'SGX',        // Singapore
  AX: 'ASX',        // Australia
  NZ: 'NZX',
  NS: 'NSE',        // India — National
  BO: 'BSE',        // India — Bombay
  TA: 'TASE',       // Tel Aviv
  JO: 'JSE',        // Johannesburg
};

/**
 * The TradingView symbol for one of ours, or null when there is no safe mapping.
 *
 * `group` only helps disambiguate; the tables win when they have an entry, because
 * a table entry is knowledge and a rule is a guess.
 */
export function tradingViewSymbol(symbol: string, group?: string): string | null {
  const s = (symbol ?? '').trim();
  if (!s) return null;

  if (INDEX_MAP[s]) return INDEX_MAP[s];
  if (FUTURES_MAP[s]) return FUTURES_MAP[s];
  if (EXCHANGE_MAP[s]) return EXCHANGE_MAP[s];

  // Crypto: 'BTC-USD' → 'CRYPTO:BTCUSD', TradingView's own cross-exchange index,
  // which is the right counterpart to a Yahoo crypto quote (also an aggregate).
  const crypto = /^([A-Z0-9]{2,10})-USD$/.exec(s);
  if (crypto) return `CRYPTO:${crypto[1]}USD`;

  // FX: 'EURUSD=X' → 'FX_IDC:EURUSD'. Yahoo also writes a pair against the dollar as
  // 'JPY=X', which means USD/JPY.
  //
  // FX_IDC and not FX. The FX feed is a broker's book: it carries the majors and only
  // in the market's own direction, so USD/GBP, USD/AUD and USD/NZD — which this app
  // charts that way round — are simply absent from it, as are USD/INR, USD/BRL and the
  // renminbi crosses. FX_IDC is an indicative rate feed that carries every pair in
  // either direction, which is also what Yahoo's own rates are, so the two series
  // actually correspond.
  const fxPair = /^([A-Z]{6})=X$/.exec(s);
  if (fxPair) return `FX_IDC:${fxPair[1]}`;
  const fxSingle = /^([A-Z]{3})=X$/.exec(s);
  if (fxSingle) return `FX_IDC:USD${fxSingle[1]}`;

  const listing = /^([A-Z0-9]{1,8})\.([A-Z]{1,3})$/.exec(s);
  if (listing && SUFFIX_EXCHANGE[listing[2]]) return `${SUFFIX_EXCHANGE[listing[2]]}:${listing[1]}`;

  // Anything left with Yahoo punctuation is a market we have no table and no rule
  // for — another foreign venue, a fund class, a rate series. No link.
  if (/[\^=]/.test(s) || s.includes('.')) return null;

  // Plain US tickers (stocks, sector ETFs): TradingView resolves them to the primary
  // listing without an exchange prefix, which is what we want — it also keeps the
  // link working for any stock the user adds to a watchlist later.
  if (/^[A-Z][A-Z.\-]{0,6}$/.test(s)) return s;

  return null;
}

/** Chart URL for a symbol, or null when it cannot be mapped safely. */
export function tradingViewUrl(symbol: string, group?: string): string | null {
  const tv = tradingViewSymbol(symbol, group);
  return tv ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}` : null;
}

/**
 * True when the mapping is a stand-in rather than the same series — the caller says
 * so on the button, because opening a different instrument without warning is the
 * one failure this module exists to prevent.
 */
export function tradingViewIsProxy(symbol: string): boolean {
  return symbol === '^990100-USD-STRD';
}
