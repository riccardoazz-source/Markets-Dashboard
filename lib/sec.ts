import type { YahooEarnings, YahooEarningsPoint, YahooFinancialQuarter } from './yahoo';

// SEC requires a descriptive User-Agent. Override via SEC_USER_AGENT env var on Vercel.
const SEC_UA = process.env.SEC_USER_AGENT ?? 'Markets Dashboard contact@markets-dashboard.app';
const TICKER_MAP_TTL = 24 * 60 * 60_000;
const FACTS_TIMEOUT = 12_000;

let tickerMapCache: Map<string, number> | null = null;
let tickerMapTs = 0;
let tickerMapPromise: Promise<Map<string, number> | null> | null = null;

async function loadTickerMap(): Promise<Map<string, number> | null> {
  if (tickerMapCache && Date.now() - tickerMapTs < TICKER_MAP_TTL) return tickerMapCache;
  if (tickerMapPromise) return tickerMapPromise;

  tickerMapPromise = (async () => {
    try {
      const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        console.warn('[sec] ticker map HTTP', res.status);
        return null;
      }
      const data = await res.json() as Record<string, { cik_str: number; ticker: string; title: string }>;
      const map = new Map<string, number>();
      for (const k of Object.keys(data)) {
        const e = data[k];
        if (e?.ticker && e?.cik_str) map.set(e.ticker.toUpperCase(), e.cik_str);
      }
      tickerMapCache = map;
      tickerMapTs = Date.now();
      return map;
    } catch (e) {
      console.warn('[sec] ticker map failed:', (e as Error).message);
      return null;
    } finally {
      tickerMapPromise = null;
    }
  })();

  return tickerMapPromise;
}

async function tickerToCik(ticker: string): Promise<string | null> {
  // Non-US ticker formats (BMW.DE, ENI.MI, BARC.L, ...) — SEC only covers US filers.
  if (ticker.includes('.') || ticker.includes('-')) return null;
  const map = await loadTickerMap();
  if (!map) return null;
  const cik = map.get(ticker.toUpperCase());
  if (!cik) return null;
  return cik.toString().padStart(10, '0');
}

interface XbrlFact {
  end: string;
  start?: string;
  val: number;
  form: string;
  fp?: string;
  fy?: number;
  filed?: string;
}

interface XbrlConcept {
  units: Record<string, XbrlFact[]>;
}

interface CompanyFacts {
  facts: { 'us-gaap'?: Record<string, XbrlConcept> };
}

function pickConcept(facts: CompanyFacts, tags: string[]): XbrlConcept | null {
  const gaap = facts.facts?.['us-gaap'];
  if (!gaap) return null;
  for (const tag of tags) {
    if (gaap[tag]) return gaap[tag];
  }
  return null;
}

function pickUnit(concept: XbrlConcept | null, preferUnits: string[]): XbrlFact[] {
  if (!concept) return [];
  for (const u of preferUnits) {
    if (concept.units?.[u]?.length) return concept.units[u];
  }
  return [];
}

// Classify a fact by its duration. SEC reports both ~90-day quarterly facts and
// ~365-day annual cumulative facts for the same end date — separating by duration
// is the only reliable way to distinguish quarter vs full year.
function isQuarterly(f: XbrlFact): boolean {
  if (!f.start) return false;
  const days = (new Date(f.end).getTime() - new Date(f.start).getTime()) / 86_400_000;
  return days >= 70 && days <= 100;
}

function isAnnual(f: XbrlFact): boolean {
  if (!f.start) return false;
  const days = (new Date(f.end).getTime() - new Date(f.start).getTime()) / 86_400_000;
  return days >= 350 && days <= 380;
}

// The same period often appears multiple times across filings (restatements);
// keep the most recently filed version.
function dedupeByEnd(facts: XbrlFact[]): Map<string, XbrlFact> {
  const map = new Map<string, XbrlFact>();
  for (const f of facts) {
    const existing = map.get(f.end);
    if (!existing) { map.set(f.end, f); continue; }
    const a = f.filed ?? '';
    const b = existing.filed ?? '';
    if (a > b) map.set(f.end, f);
  }
  return map;
}

export async function fetchSecEarnings(symbol: string): Promise<YahooEarnings | null> {
  const cik = await tickerToCik(symbol);
  if (!cik) return null;

  let data: CompanyFacts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FACTS_TIMEOUT);
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[sec] ${symbol} (CIK ${cik}): HTTP ${res.status}`);
      return null;
    }
    data = await res.json() as CompanyFacts;
  } catch (e) {
    console.warn(`[sec] ${symbol} fetch failed:`, (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }

  // Companies use different GAAP tags depending on industry / accounting era (ASC 606 changed revenue tagging in 2018).
  const revenueFacts = pickUnit(pickConcept(data, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
  ]), ['USD']);
  const cogsFacts = pickUnit(pickConcept(data, [
    'CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold',
  ]), ['USD']);
  const gpFacts = pickUnit(pickConcept(data, ['GrossProfit']), ['USD']);
  const opIncomeFacts = pickUnit(pickConcept(data, ['OperatingIncomeLoss']), ['USD']);
  const niFacts = pickUnit(pickConcept(data, ['NetIncomeLoss']), ['USD']);
  const epsFacts = pickUnit(pickConcept(data, [
    'EarningsPerShareDiluted', 'EarningsPerShareBasic',
  ]), ['USD/shares']);

  const today = new Date().toISOString().slice(0, 10);

  function buildEntries(annual: boolean): Map<string, YahooFinancialQuarter> {
    const filter = annual ? isAnnual : isQuarterly;
    const out = new Map<string, YahooFinancialQuarter>();

    function mergeField<K extends keyof YahooFinancialQuarter>(facts: XbrlFact[], field: K) {
      const dedup = dedupeByEnd(facts.filter(filter));
      for (const [date, f] of dedup) {
        if (date > today) continue;
        const e = out.get(date) ?? { date, isAnnual: annual };
        (e as unknown as Record<string, unknown>)[field] = f.val;
        out.set(date, e);
      }
    }

    mergeField(revenueFacts, 'revenue');
    mergeField(cogsFacts, 'costOfRevenue');
    mergeField(gpFacts, 'grossProfit');
    mergeField(opIncomeFacts, 'operatingIncome');
    mergeField(niFacts, 'netIncome');
    return out;
  }

  const quarterlyEntries = buildEntries(false);
  const annualEntries = buildEntries(true);

  // Prefer ANNUAL when both exist at the same year-end (e.g. ACN files standalone
  // Q4 + 10-K; annual gives the user the "full-year" reference at year-end).
  // Quarterly fills the other three quarter-ends. The annual entry carries
  // isAnnual: true (set by buildEntries) so the chart can color it differently.
  const finMap = new Map<string, YahooFinancialQuarter>();
  for (const [date, e] of quarterlyEntries) finMap.set(date, e);
  for (const [date, e] of annualEntries) finMap.set(date, e);

  const epsMap = new Map<string, YahooEarningsPoint>();
  // Annual first — fills year-ends where no separate Q4 quarterly is filed.
  for (const [date, f] of dedupeByEnd(epsFacts.filter(isAnnual))) {
    if (date > today) continue;
    epsMap.set(date, { date, period: `FY ${date.slice(0, 4)}`, eps: f.val });
  }
  // Quarterly OVERRIDES annual at fiscal year-end. TTM = sum of the last 4
  // *quarterly* EPS, so the Q4 quarterly value must be preserved (not the FY total).
  // For NVDA in May 2026 the wrong order made TTM skip Q4 FY26 → P/E ~56x instead of ~46x.
  for (const [date, f] of dedupeByEnd(epsFacts.filter(isQuarterly))) {
    if (date > today) continue;
    epsMap.set(date, { date, period: date, eps: f.val });
  }

  const quarterly = Array.from(epsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const financials = Array.from(finMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  if (!quarterly.length && !financials.length) {
    console.warn(`[sec] ${symbol}: empty result (CIK ${cik})`);
    return null;
  }
  const wRev = financials.filter(f => f.revenue != null).length;
  console.log(`[sec] ${symbol}: ${quarterly.length} EPS / ${financials.length} fin (${wRev} w/ revenue)`);
  return { quarterly, financials, currency: 'USD' };
}
