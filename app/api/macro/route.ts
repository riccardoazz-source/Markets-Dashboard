import { NextRequest, NextResponse } from 'next/server';
import { MACRO_INDICATORS, FOMC_MEETING_DATES } from '@/lib/config';

// Source map: look up MacroSource by indicator id for dispatch in fetchMacroSeries.
const indicatorSourceMap = new Map(
  MACRO_INDICATORS.map(m => [m.id, m.source]),
);

// Edge runtime: near-zero cold start + same network that works for Yahoo Finance
// in /api/historical and /api/crypto. Node.js was tried to get different IPs for
// FRED, but FRED is blocked regardless — edge is strictly better here.
export const runtime = 'edge';
export const maxDuration = 25; // edge limit; gives DBnomics + fallbacks room to finish

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60_000;
const STALE = 6 * 60 * 60_000;

function getCached(key: string, ttl: number) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < ttl) return e.data;
  return null;
}

// Vercel edge cache + browser cache. s-maxage matches our in-memory TTL so
// most requests are served at the edge in <50ms instead of going through the
// full fan-out. stale-while-revalidate keeps the UI snappy during refreshes.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=21600',
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// FRED API key. The official API (api.stlouisfed.org) — unlike the public
// website — does NOT block cloud/Vercel IPs, so this is the reliable path.
// Prefer the FRED_API_KEY env var; the constant below is a fallback so the
// deployed app works without Vercel dashboard configuration.
// SECURITY NOTE: this key is committed to the repo. If the repo is public,
// prefer setting FRED_API_KEY as a Vercel environment variable instead and
// rotate this key at https://fredaccount.stlouisfed.org/apikeys
const FRED_API_KEY_FALLBACK = 'f3c277afe140cbee307e1b716840f5a9';
function getFredApiKey(): string {
  return process.env.FRED_API_KEY || FRED_API_KEY_FALLBACK;
}

// Discontinued / low-frequency series (quarterly, annual, event-based) whose most
// recent observation can be far older than the standard 18-month list-mode window.
// For these, fetch the full history so the card still shows the last available
// value, and charts show the complete series regardless of the timeframe picked.
const WIDE_WINDOW_SERIES = new Set([
  'DRCLACBS', 'DRALACBN', 'DRCRELEXFACBS', 'BOGZ1FA673065500Q', 'BTC_HALVING', 'BTC_PRODUCTION_COST',
  'GFDEGDQ188S', 'GFDEBTN', 'A939RC0A052NBEA',
  // Recession indicators — bands are only useful with full history.
  'USREC', 'SAHMREALTIME',
  // Rates — full history needed to see yield curve inversions, negative ECB rates, etc.
  'T10Y2Y', 'ECBDFR', 'FEDTARMD', 'FOMC_MEETINGS',
  // Market Value: Shiller history ends ~2023 and the multpl annual tables are
  // small. Always fetch full history so the card has a latest value (the
  // 18-month list-mode window would otherwise exclude all Shiller data).
  'SP500_PE', 'SHILLER_CAPE', 'SP500_EPS', 'SP500_EYIELD', 'SP500_PSALES', 'SP500_PBOOK',
]);

// ---------- FRED API (preferred when FRED_API_KEY is set) ----------
async function fetchFREDApi(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const apiKey = getFredApiKey();
  if (!apiKey) return [];
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'asc',
  });
  if (fromDate) params.set('observation_start', fromDate);
  const url = `https://api.stlouisfed.org/fred/series/observations?${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.error(`[fred-api] ${seriesId} HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as { observations?: { date: string; value: string }[] };
    const obs = json.observations ?? [];
    const points: { date: string; value: number }[] = [];
    for (const o of obs) {
      const num = parseFloat(o.value);
      if (!isNaN(num) && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
        points.push({ date: o.date, value: num });
      }
    }
    return points;
  } catch (e) {
    console.error(`[fred-api] ${seriesId} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- FRED public CSV (no key, sometimes blocked) ----------
async function fetchFREDCsv(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const params = new URLSearchParams({ id: seriesId });
  if (fromDate) params.set('cosd', fromDate);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/csv,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://fred.stlouisfed.org/',
      },
    });
    if (!res.ok) {
      console.error(`[fred-csv] ${seriesId} HTTP ${res.status}`);
      return [];
    }
    const csv = await res.text();
    if (!csv || csv.length < 10) {
      console.error(`[fred-csv] ${seriesId} empty/short response`);
      return [];
    }
    const lines = csv.trim().split('\n');
    const points: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(',');
      if (parts.length < 2) continue;
      const date = parts[0].trim();
      const num = parseFloat(parts[1].trim());
      if (!isNaN(num) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        points.push({ date, value: num });
      }
    }
    if (points.length === 0) {
      console.warn(`[fred-csv] ${seriesId} parsed zero points; head:`, csv.slice(0, 120));
    }
    return points;
  } catch (e) {
    console.error(`[fred-csv] ${seriesId} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- FRED legacy .txt endpoint (tab-separated, no key required) ----------
async function fetchFREDTxt(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const url = `https://fred.stlouisfed.org/data/${encodeURIComponent(seriesId)}.txt`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'text/plain,*/*' },
    });
    if (!res.ok) {
      console.error(`[fred-txt] ${seriesId} HTTP ${res.status}`);
      return [];
    }
    const txt = await res.text();
    const lines = txt.split('\n');
    const points: { date: string; value: number }[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const date = parts[0].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (fromDate && date < fromDate) continue;
      const num = parseFloat(parts[1].trim());
      if (!isNaN(num)) points.push({ date, value: num });
    }
    return points;
  } catch (e) {
    console.error(`[fred-txt] ${seriesId} fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- Combined FRED fetch with fallback chain ----------
async function fetchFRED(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  // 1. JSON API (FRED_API_KEY env var or hardcoded fallback — most reliable)
  if (getFredApiKey()) {
    const api = await fetchFREDApi(seriesId, fromDate, timeoutMs);
    if (api.length > 0) return api;
  }
  // 2. Public CSV endpoint
  const csv = await fetchFREDCsv(seriesId, fromDate, timeoutMs);
  if (csv.length > 0) return csv;
  // 3. Legacy .txt endpoint (tab-separated, different URL path)
  return fetchFREDTxt(seriesId, fromDate, timeoutMs);
}

// ---------- DBnomics (Banque de France public mirror of FRED) ----------
// No API key, no IP blocks observed from Vercel — covers FRED-only series
// like MORTGAGE30US, ICSA, T10YIE, GDPC1, INDPRO.
// Canonical path: /v22/series/{provider}/{dataset}/{series}
// For FRED, each series is its own dataset so both codes are the series id.
// Normalize DBnomics period strings to YYYY-MM-DD.
// FRED quarterly series come back as "2024-Q4", annual as "2024", monthly as
// "2024-12" — the old code only handled YYYY-MM-DD and YYYY-MM, silently
// dropping quarterly + annual rows (= GDP/GDPC1/INDPRO showing "No data").
function normalizeDbnomicsPeriod(p: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  if (/^\d{4}-\d{2}$/.test(p)) return `${p}-01`;
  const qm = p.match(/^(\d{4})-Q([1-4])$/);
  if (qm) {
    const monthNum = (parseInt(qm[2], 10) - 1) * 3 + 1; // Q1→1, Q2→4, Q3→7, Q4→10
    return `${qm[1]}-${String(monthNum).padStart(2, '0')}-01`;
  }
  const sm = p.match(/^(\d{4})-S([1-2])$/); // semestrial
  if (sm) {
    const monthNum = sm[2] === '1' ? 1 : 7;
    return `${sm[1]}-${String(monthNum).padStart(2, '0')}-01`;
  }
  if (/^\d{4}$/.test(p)) return `${p}-07-01`; // annual → mid-year proxy
  return null;
}

async function fetchDBnomicsFRED(
  seriesId: string,
  fromDate?: string,
  timeoutMs = 5_000,
): Promise<{ date: string; value: number }[]> {
  const enc = encodeURIComponent(seriesId);
  // Try canonical /{id}/{id} first, then dataset-only /{id} as fallback.
  const urls = [
    `https://api.db.nomics.world/v22/series/FRED/${enc}/${enc}?observations=1`,
    `https://api.db.nomics.world/v22/series/FRED/${enc}?observations=1`,
  ];
  for (const url of urls) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        next: { revalidate: 1800 },
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      });
      if (!res.ok) { console.warn(`[dbnomics] ${seriesId} HTTP ${res.status} (${url})`); continue; }
      const json = await res.json() as {
        series?: { docs?: Array<{ period?: string[]; value?: (number | string | null)[] }> };
      };
      const doc = json?.series?.docs?.[0];
      if (!doc?.period?.length) { console.warn(`[dbnomics] ${seriesId} empty doc`); continue; }
      const periods = doc.period!;
      const values  = doc.value ?? [];
      const out: { date: string; value: number }[] = [];
      for (let i = 0; i < periods.length; i++) {
        const p = periods[i];
        const v = values[i];
        if (typeof p !== 'string') continue;
        const dateStr = normalizeDbnomicsPeriod(p);
        if (!dateStr) continue;
        const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
        if (!isFinite(num)) continue;
        if (fromDate && dateStr < fromDate) continue;
        out.push({ date: dateStr, value: num });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      if (out.length > 0) {
        console.log(`[dbnomics] ${seriesId}: ${out.length} pts`);
        return out;
      }
    } catch (e) {
      console.error(`[dbnomics] ${seriesId}:`, (e as Error).message);
    } finally {
      clearTimeout(t);
    }
  }
  return [];
}

// ---------- Yahoo Finance yields (^TNX = 10Y, ^IRX = 13W T-Bill) ----------
const YAHOO_YIELD_MAP: Record<string, string> = {
  'DGS10': '^TNX',
  'DGS2':  '^IRX', // 13W T-Bill proxy — replaced by Treasury CSV when available
};

// Uses range-based queries directly, bypassing the period-based path in
// fetchYahooChart which can take >6s (two hosts × 8s) before failing over.
async function fetchYahooYield(
  yahooSym: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const daysAgo = fromDate
    ? (Date.now() - new Date(fromDate).getTime()) / 86_400_000
    : 180;
  const rangeParam = daysAgo > 3500 ? 'max' : daysAgo > 1500 ? '10y'
    : daysAgo > 800 ? '5y' : daysAgo > 300 ? '1y' : '6mo';
  const interval: '1d' | '1wk' | '1mo' = daysAgo > 1500 ? '1mo'
    : daysAgo > 300 ? '1wk' : '1d';

  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSym)}` +
      `?range=${rangeParam}&interval=${interval}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal, cache: 'no-store',
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
      });
      if (!res.ok) { console.warn(`[yahoo-yield] ${yahooSym} ${host} HTTP ${res.status}`); continue; }
      const json = await res.json() as { chart?: { result?: unknown[] } };
      const result = json?.chart?.result?.[0] as Record<string, unknown> | undefined;
      if (!result) { console.warn(`[yahoo-yield] ${yahooSym} ${host} no result`); continue; }
      const timestamps = (result.timestamp as number[]) ?? [];
      const closes = (
        (result.indicators as Record<string, unknown>)?.quote as Array<Record<string, unknown>>
      )?.[0]?.close as number[] ?? [];
      const pts: { date: string; value: number }[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c == null || !isFinite(c) || c <= 0) continue;
        pts.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), value: c });
      }
      pts.sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length > 0) {
        console.log(`[yahoo-yield] ${yahooSym} ${host}: ${pts.length} pts`);
        return pts;
      }
    } catch (e) {
      console.error(`[yahoo-yield] ${yahooSym} ${host}:`, (e as Error).message);
    } finally {
      clearTimeout(t);
    }
  }
  console.warn(`[yahoo-yield] ${yahooSym} all hosts failed`);
  return [];
}

// ---------- Generic Yahoo Finance historical price fetcher ----------
// Used by yahoo_price and yahoo_ratio source types in MACRO_INDICATORS.
// Wraps fetchYahooYield with an explicit fromDate filter so the returned
// series starts exactly at fromDate regardless of which range bucket was used.
async function fetchYahooHistorical(
  symbol: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const pts = await fetchYahooYield(symbol, fromDate);
  return fromDate ? pts.filter(p => p.date >= fromDate) : pts;
}

async function fetchYahooRatio(
  numerator: string,
  denominator: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const [numPts, denPts] = await Promise.all([
    fetchYahooHistorical(numerator, fromDate),
    fetchYahooHistorical(denominator, fromDate),
  ]);
  if (!numPts.length || !denPts.length) return [];
  const denMap = new Map(denPts.map(p => [p.date, p.value]));
  const result = numPts
    .filter(p => denMap.has(p.date) && denMap.get(p.date)! > 0)
    .map(p => ({ date: p.date, value: p.value / denMap.get(p.date)! }));
  result.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`[yahoo-ratio] ${numerator}/${denominator}: ${result.length} pts`);
  return result;
}

// ---------- Bitcoin halving schedule (BTC_HALVING) ----------
// Halvings are events, not a continuous metric. The series carries the current
// block reward as a continuous monthly value so the chart has a stable X axis;
// the UI draws vertical reference lines at the halving dates themselves.
function getBitcoinHalvings(fromDate?: string): { date: string; value: number }[] {
  const pts: { date: string; value: number }[] = [];
  const now = new Date();
  let y = 2012, m = 1;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-01`;
    pts.push({ date: dateStr, value: rewardAt(dateStr) });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return fromDate ? pts.filter(p => p.date >= fromDate) : pts;
}

// ---------- Bitcoin monthly RSI (BTC_RSI) ----------
// bitbo.io blocks server-side requests, and RSI(14) is a standard formula, so
// it is computed directly from Yahoo's monthly BTC-USD closes (Wilder smoothing).
function computeRSI(
  closes: { date: string; value: number }[],
  period = 14,
): { date: string; value: number }[] {
  if (closes.length < period + 1) return [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i].value - closes[i - 1].value;
    if (ch >= 0) avgGain += ch; else avgLoss -= ch;
  }
  avgGain /= period; avgLoss /= period;
  const rsi = () => avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  const out = [{ date: closes[period].date, value: rsi() }];
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i].value - closes[i - 1].value;
    avgGain = (avgGain * (period - 1) + (ch > 0 ? ch : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (ch < 0 ? -ch : 0)) / period;
    out.push({ date: closes[i].date, value: rsi() });
  }
  return out;
}

// ---------- Bitcoin production cost (electricity-based estimate) ----------
// Formula: hashrate × efficiency × electricity_price / monthly_btc_mined
// Assumptions: 25 J/TH efficiency (industry average), $0.05/kWh electricity.
// Data source: blockchain.info hashrate chart (EH/s).
async function fetchBitcoinProductionCost(
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  const url = 'https://api.blockchain.info/charts/hash-rate?format=json&timespan=all&sampled=true&metadata=false&cors=true';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.blockchain.com' },
    });
    if (!res.ok) { console.error(`[btc-cost] blockchain.info HTTP ${res.status}`); return []; }
    const json = await res.json() as { values?: { x: number; y: number }[] };
    const raw = json?.values ?? [];
    if (!raw.length) { console.warn('[btc-cost] no hashrate data'); return []; }

    const J_PER_TH = 25;         // assumed miner efficiency (J/TH)
    const USD_PER_KWH = 0.05;    // industrial electricity rate ($/kWh)
    const HOURS_PER_MONTH = 24 * 30;

    const out: { date: string; value: number }[] = [];
    for (const pt of raw) {
      const date = new Date(pt.x * 1000).toISOString().slice(0, 10);
      if (fromDate && date < fromDate) continue;
      const hashEH = pt.y;  // EH/s
      if (!isFinite(hashEH) || hashEH <= 0) continue;
      const reward = rewardAt(date);
      // Power (W) = hashEH * 1e6 TH/s * J_PER_TH
      const powerW = hashEH * 1e6 * J_PER_TH;
      // Monthly energy (kWh)
      const monthlyKWh = powerW * HOURS_PER_MONTH / 1000;
      // Monthly cost ($)
      const monthlyCost = monthlyKWh * USD_PER_KWH;
      // Monthly BTC mined
      const monthlyBTC = 144 * 30 * reward;
      const costPerBTC = monthlyCost / monthlyBTC;
      out.push({ date, value: Math.round(costPerBTC) });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[btc-cost] ${out.length} pts`);
    return out;
  } catch (e) {
    console.error('[btc-cost] failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function fetchBitcoinMonthlyRSI(
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  // Pass a very old date so fetchYahooYield selects range=max, interval=1mo —
  // RSI's 14-month lookback needs the full monthly history regardless of fromDate.
  const monthly = await fetchYahooYield('BTC-USD', '2010-01-01');
  if (monthly.length < 20) { console.warn('[btc-rsi] insufficient BTC history'); return []; }
  const rsi = computeRSI(monthly, 14);
  const out = fromDate ? rsi.filter(p => p.date >= fromDate) : rsi;
  console.log(`[btc-rsi] ${out.length} pts`);
  return out;
}

// ---------- Bitcoin miner revenue (computed from halving schedule + BTC price) ----------
// Halvings: rewards drop by 50% every ~210,000 blocks (~4 years).
// ~144 blocks/day (one every 10 minutes on average).
const HALVING_SCHEDULE: { date: string; reward: number }[] = [
  { date: '2009-01-03', reward: 50    },
  { date: '2012-11-28', reward: 25    },
  { date: '2016-07-09', reward: 12.5  },
  { date: '2020-05-11', reward: 6.25  },
  { date: '2024-04-20', reward: 3.125 },
];

function rewardAt(dateStr: string): number {
  let reward = HALVING_SCHEDULE[0].reward;
  for (const h of HALVING_SCHEDULE) {
    if (dateStr >= h.date) reward = h.reward;
  }
  return reward;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getBitcoinMinedMonthly(fromDate?: string): { date: string; value: number }[] {
  const start = fromDate ? new Date(fromDate) : new Date('2009-01-01');
  const now   = new Date();
  const pts: { date: string; value: number }[] = [];
  let y = start.getFullYear();
  let m = start.getMonth() + 1;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-01`;
    const reward  = rewardAt(dateStr);
    const days    = daysInMonth(y, m);
    pts.push({ date: dateStr, value: reward * 144 * days });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return pts;
}

async function getBitcoinMinerRevenue(
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  // Fetch monthly BTC-USD prices to get average price per month.
  // Pass '2009-01-01' so fetchYahooYield selects range=max, interval=1mo.
  const monthly = await fetchYahooYield('BTC-USD', '2009-01-01');
  if (monthly.length < 5) { console.warn('[btc-miner] insufficient BTC history'); return []; }

  // Build month → price map (YYYY-MM prefix)
  const priceMap = new Map<string, number>();
  for (const p of monthly) {
    const mon = p.date.slice(0, 7); // YYYY-MM
    priceMap.set(mon, p.value);
  }

  const mined = getBitcoinMinedMonthly(fromDate);
  const revenue = mined
    .map(p => {
      const mon   = p.date.slice(0, 7);
      const price = priceMap.get(mon);
      if (!price) return null;
      return { date: p.date, value: (p.value * price) / 1e9 }; // USD → billions
    })
    .filter((p): p is { date: string; value: number } => p !== null);

  console.log(`[btc-miner] revenue: ${revenue.length} monthly pts`);
  return revenue;
}

// ---------- multpl.com valuation tables ----------
// multpl.com blocks datacenter IPs (Vercel) on direct requests, so each
// "by-month" table is fetched through the free r.jina.ai reader proxy, which
// returns the page as plain text. Rows look like "Nov 1, 2025  28.86".
const MULTPL_MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseMultplText(
  text: string,
  fromDate?: string,
): { date: string; value: number }[] {
  // "Mon D, YYYY" followed (after spaces / table pipes / $) by a number.
  const re = /([A-Z][a-z]{2,})\s+(\d{1,2}),\s*(\d{4})[^\d\n-]{0,8}(-?[\d,]+\.?\d*)/g;
  const seen = new Set<string>();
  const pts: { date: string; value: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const mon = MULTPL_MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mon) continue;
    const date = `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
    if (seen.has(date)) continue;
    const value = parseFloat(m[4].replace(/,/g, ''));
    if (!isFinite(value)) continue;
    if (fromDate && date < fromDate) continue;
    seen.add(date);
    pts.push({ date, value });
  }
  pts.sort((a, b) => a.date.localeCompare(b.date));
  return pts;
}

async function fetchMultplOnce(
  pagePath: string,
  fromDate: string | undefined,
  timeoutMs: number,
): Promise<{ date: string; value: number }[]> {
  const url = `https://r.jina.ai/https://www.multpl.com/${pagePath}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Accept': 'text/plain',
      'X-Return-Format': 'text',
      'X-Timeout': '15',
    };
    if (process.env.JINA_API_KEY) headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 21600 },
      headers,
    });
    if (!res.ok) { console.warn(`[multpl] ${pagePath} proxy HTTP ${res.status}`); return []; }
    return parseMultplText(await res.text(), fromDate);
  } catch (e) {
    console.error(`[multpl] ${pagePath} failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function fetchMultpl(
  slug: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  // Annual table only (~150 rows). It is small enough for the proxy to render
  // quickly and keeps the whole request well under the 25s edge limit.
  // The previous monthly→annual sequence could take 20s per indicator, which
  // timed out the entire request (all 6 Market Value cards → blank). Valuation
  // ratios move slowly, so annual granularity is adequate; dense monthly
  // history for the Shiller-sourced metrics comes from the Shiller CSV instead.
  const yearly = await fetchMultplOnce(`${slug}/table/by-year`, fromDate, 9_000);
  console.log(`[multpl] ${slug}: ${yearly.length} pts (annual)`);
  return yearly;
}

// ---------- Robert Shiller / Yale S&P 500 data (PE, CAPE, EPS, Earnings Yield) ----------
// Shiller publishes monthly S&P 500 price, earnings (annual EPS), and CAPE (PE10)
// back to 1871. The datahub.io GitHub mirror is raw CSV — no API key, no IP blocks.
// Date format in the CSV: "YYYY.MM"  (e.g. "2024.12")
// Earnings column = annual trailing EPS for the S&P 500 composite.
// PE10 column     = Shiller CAPE (10-year cyclically adjusted P/E).
interface ShillerSeries {
  pe:   { date: string; value: number }[];
  cape: { date: string; value: number }[];
  eps:  { date: string; value: number }[];
  ey:   { date: string; value: number }[];
}

function parseShillerCSV(csv: string, fromDate?: string): ShillerSeries {
  const pe: ShillerSeries['pe'] = [];
  const cape: ShillerSeries['cape'] = [];
  const eps: ShillerSeries['eps'] = [];
  const ey: ShillerSeries['ey'] = [];

  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { pe, cape, eps, ey };

  const hdrs = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const dateIdx     = hdrs.indexOf('date');
  const sp500Idx    = hdrs.indexOf('sp500');
  const earningsIdx = hdrs.indexOf('earnings');
  const pe10Idx     = hdrs.findIndex(h => h === 'pe10' || h === 'cape');

  if (dateIdx === -1 || sp500Idx === -1) {
    console.warn('[shiller] unexpected CSV headers:', lines[0].slice(0, 120));
    return { pe, cape, eps, ey };
  }

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim().replace(/"/g, ''));
    if (parts.length <= Math.max(dateIdx, sp500Idx)) continue;

    const rawDate = parts[dateIdx];
    if (!rawDate) continue;

    // "YYYY.MM" → "YYYY-MM-01"
    let dateStr = '';
    if (/^\d{4}\.\d{1,2}$/.test(rawDate)) {
      const [y, m] = rawDate.split('.');
      dateStr = `${y}-${m.padStart(2, '0')}-01`;
    } else if (/^\d{4}-\d{2}$/.test(rawDate)) {
      dateStr = `${rawDate}-01`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      dateStr = rawDate;
    } else {
      continue;
    }

    if (fromDate && dateStr < fromDate) continue;

    const sp500    = parseFloat(parts[sp500Idx]);
    const earnings = earningsIdx !== -1 ? parseFloat(parts[earningsIdx]) : NaN;
    const pe10Val  = pe10Idx !== -1 ? parseFloat(parts[pe10Idx]) : NaN;

    if (!isFinite(sp500) || sp500 <= 0) continue;

    // Trailing P/E = price / annual EPS
    if (isFinite(earnings) && earnings > 0) {
      const trailPE = sp500 / earnings;
      if (isFinite(trailPE) && trailPE > 2 && trailPE < 500) {
        pe.push({ date: dateStr, value: parseFloat(trailPE.toFixed(2)) });
        eps.push({ date: dateStr, value: parseFloat(earnings.toFixed(2)) });
        const eyVal = (earnings / sp500) * 100;
        if (isFinite(eyVal)) ey.push({ date: dateStr, value: parseFloat(eyVal.toFixed(3)) });
      }
    }

    if (isFinite(pe10Val) && pe10Val > 0) {
      cape.push({ date: dateStr, value: parseFloat(pe10Val.toFixed(2)) });
    }
  }

  return { pe, cape, eps, ey };
}

async function fetchShillerCSV(fromDate?: string, timeoutMs = 8_000): Promise<ShillerSeries> {
  const empty: ShillerSeries = { pe: [], cape: [], eps: [], ey: [] };
  // The datahub.io GitHub repo mirrors Shiller's IE dataset as CSV.
  const url = 'https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 3600 }, // hourly — data is monthly but we want it fresh
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,text/plain,*/*' },
    });
    if (!res.ok) { console.warn(`[shiller] CSV HTTP ${res.status}`); return empty; }
    const result = parseShillerCSV(await res.text(), fromDate);
    console.log(`[shiller] PE=${result.pe.length} CAPE=${result.cape.length} EPS=${result.eps.length} EY=${result.ey.length}`);
    return result;
  } catch (e) {
    console.error('[shiller] fetch failed:', (e as Error).message);
    return empty;
  } finally {
    clearTimeout(t);
  }
}

// ---------- NY Fed EFFR (Effective Federal Funds Rate, no key) ----------
// recentOnly=true → last/10.json (~500 B); false → all/data.json (full history, ~2 MB).
async function fetchNYFedEffr(
  fromDate?: string,
  timeoutMs = 5_000,
  recentOnly = false,
): Promise<{ date: string; value: number }[]> {
  // For list mode we only need 2 points; last/10 is ~500 B vs all/data ~2 MB.
  const url = recentOnly
    ? 'https://markets.newyorkfed.org/api/rates/effr/last/10.json'
    : 'https://markets.newyorkfed.org/api/rates/effr/all/data.json';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 1800 }, // edge data cache — survives cold starts unlike in-memory Map
      headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' },
    });
    if (!res.ok) { console.error(`[nyfed] effr HTTP ${res.status}`); return []; }
    const json = await res.json() as { refRates?: { effectiveDate: string; percentRate: number }[] };
    const rates = json?.refRates ?? [];
    const pts: { date: string; value: number }[] = [];
    for (const r of rates) {
      const date = r.effectiveDate;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!isFinite(r.percentRate)) continue;
      if (fromDate && date < fromDate) continue;
      pts.push({ date, value: r.percentRate });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[nyfed] effr loaded ${pts.length} points (recentOnly=${recentOnly})`);
    return pts;
  } catch (e) {
    console.error('[nyfed] effr failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- US Treasury Daily Yield Curve (free, no key) ----------
// Provides DGS2 ("2 Yr") and DGS10 ("10 Yr") from the nominal yield curve.
const TREASURY_COL: Record<string, string> = {
  'DGS2':   '2 Yr',
  'DGS10':  '10 Yr',
};

// Real yield curve — used to fetch DFII10 (10Y TIPS real yield).
// T10YIE = DGS10 (nominal) − DFII10 (real) = implied 10Y inflation breakeven.
const TREASURY_REAL_COL: Record<string, string> = {
  'DFII10': '10 Yr',
};

function buildTreasuryUrl(year?: number, real = false): string {
  const base = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates';
  const type = real ? 'daily_treasury_real_yield_curve' : 'daily_treasury_yield_curve';
  const suffix = `?type=${type}&download=true`;
  if (year) return `${base}/daily-treasury-rates.csv/${year}/all${suffix}`;
  return `${base}/daily-treasury-rates.csv/all/all${suffix}&field_tdr_date_value=all`;
}

function parseTreasuryCsv(csv: string, col: string, fromDate?: string) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const colIdx = headers.indexOf(col);
  if (colIdx === -1) return [];
  const pts: { date: string; value: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length <= colIdx) continue;
    const raw = parts[0].trim().replace(/"/g, ''); // MM/DD/YYYY
    const segs = raw.split('/');
    if (segs.length !== 3) continue;
    const date = `${segs[2]}-${segs[0].padStart(2, '0')}-${segs[1].padStart(2, '0')}`;
    if (fromDate && date < fromDate) continue;
    const val = parseFloat(parts[colIdx].trim().replace(/"/g, ''));
    if (isFinite(val)) pts.push({ date, value: val });
  }
  pts.sort((a, b) => a.date.localeCompare(b.date));
  return pts;
}

async function fetchUSTreasury(
  fredId: string,
  fromDate?: string,
  timeoutMs = 5_000,
  recentOnly = false,
): Promise<{ date: string; value: number }[]> {
  const col = TREASURY_COL[fredId];
  if (!col) return [];

  const tryUrl = async (url: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        next: { revalidate: 1800 },
        headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*', 'Referer': 'https://home.treasury.gov/' },
      });
      if (!res.ok) { console.error(`[treasury] HTTP ${res.status} for ${url}`); return null; }
      return await res.text();
    } catch (e) {
      console.error(`[treasury] ${fredId} failed:`, (e as Error).message);
      return null;
    } finally { clearTimeout(t); }
  };

  if (recentOnly) {
    // For list mode: only need latest + prev — fetch current year CSV (~80 rows vs 20k)
    const now = new Date();
    for (const yr of [now.getFullYear(), now.getFullYear() - 1]) {
      const csv = await tryUrl(buildTreasuryUrl(yr));
      if (!csv || csv.length < 50) continue;
      const pts = parseTreasuryCsv(csv, col, fromDate);
      if (pts.length > 0) {
        console.log(`[treasury] ${fredId} loaded ${pts.length} pts from ${yr}`);
        return pts;
      }
    }
    return [];
  }

  // History mode: fetch full dataset
  const csv = await tryUrl(buildTreasuryUrl());
  if (!csv || csv.length < 50) return [];
  const pts = parseTreasuryCsv(csv, col, fromDate);
  console.log(`[treasury] ${fredId} loaded ${pts.length} points`);
  return pts;
}

// Fetch one column from the Treasury TIPS / real yield-curve CSV.
async function fetchUSTreasuryReal(
  fredId: string,   // e.g. 'DFII10'
  fromDate?: string,
  timeoutMs = 5_000,
): Promise<{ date: string; value: number }[]> {
  const col = TREASURY_REAL_COL[fredId];
  if (!col) return [];
  const tryUrl = async (url: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal, next: { revalidate: 1800 },
        headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*', 'Referer': 'https://home.treasury.gov/' },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; } finally { clearTimeout(t); }
  };
  // For list mode / recent: try current year, then prior year
  const now = new Date();
  for (const yr of [now.getFullYear(), now.getFullYear() - 1]) {
    const csv = await tryUrl(buildTreasuryUrl(yr, true));
    if (!csv || csv.length < 50) continue;
    const pts = parseTreasuryCsv(csv, col, fromDate);
    if (pts.length) return pts;
  }
  // Fall back to full history
  const csv = await tryUrl(buildTreasuryUrl(undefined, true));
  if (!csv || csv.length < 50) return [];
  return parseTreasuryCsv(csv, col, fromDate);
}

// ---------- World Bank API (GDP fallback, annual) ----------
// indicator = NY.GDP.MKTP.KD (constant 2015 USD, ≈ Real GDP / GDPC1)
//           = NY.GDP.MKTP.CD (current USD,        ≈ Nominal GDP / GDP)
async function fetchWorldBankGDP(
  indicator: 'NY.GDP.MKTP.KD' | 'NY.GDP.MKTP.CD',
  fromDate?: string,
  timeoutMs = 5_000,
): Promise<{ date: string; value: number }[]> {
  const url = `https://api.worldbank.org/v2/country/US/indicator/${indicator}` +
    '?format=json&mrv=60&per_page=60';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, next: { revalidate: 86400 }, // daily — annual data
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    if (!res.ok) { console.warn(`[worldbank] ${indicator} HTTP ${res.status}`); return []; }
    const json = await res.json() as [unknown, Array<{ date?: string; value?: number | null }>];
    const rows = Array.isArray(json) ? json[1] : [];
    const pts: { date: string; value: number }[] = [];
    // Annual data is anchored at mid-year. Don't apply fromDate filter — if
    // the caller asks for "last 6 months" we'd drop the most recent annual
    // observation (it's mid-year of the prior fiscal year). Caller should
    // accept that annual data is sparse.
    for (const r of rows) {
      if (!r.date || r.value == null || !isFinite(r.value)) continue;
      const dateStr = `${r.date}-07-01`;
      pts.push({ date: dateStr, value: r.value / 1e9 }); // USD → billions
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[worldbank] ${indicator}: ${pts.length} annual pts`);
    return pts;
  } catch (e) {
    console.error(`[worldbank] ${indicator} failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- OECD MEI (Main Economic Indicators) — fallback for INDPRO ----------
// stats.oecd.org returns SDMX-JSON 1.0; observations keyed as "s0:s1:...:t"
// where t is the time-period index into structure.dimensions.observation[0].values
async function fetchOECDIndPro(
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  // PRMNTO01 = total industry output, IDX2015 = index base 2015=100, M = monthly
  const url =
    'https://stats.oecd.org/SDMX-JSON/data/MEI_BTE6/USA.PRMNTO01.IDX2015.M/all' +
    '?format=json';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 3600 },
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    if (!res.ok) { console.warn(`[oecd] INDPRO HTTP ${res.status}`); return []; }
    const json = await res.json() as {
      dataSets?: Array<{ observations?: Record<string, [number, ...unknown[]]> }>;
      structure?: { dimensions?: { observation?: Array<{ id: string; values: Array<{ id: string }> }> } };
    };
    const obs = json?.dataSets?.[0]?.observations ?? {};
    const timeDim = (json?.structure?.dimensions?.observation ?? [])
      .find(d => d.id === 'TIME_PERIOD');
    if (!timeDim?.values?.length) { console.warn('[oecd] INDPRO no TIME_PERIOD dim'); return []; }
    const periods = timeDim.values; // [{id: "2000-01"}, ...]
    const pts: { date: string; value: number }[] = [];
    for (const [key, vals] of Object.entries(obs)) {
      const tIdx = parseInt(key.split(':').at(-1) ?? '-1', 10);
      if (tIdx < 0 || tIdx >= periods.length) continue;
      const rawPeriod = periods[tIdx].id; // e.g. "2024-01"
      const dateStr = /^\d{4}-\d{2}$/.test(rawPeriod) ? `${rawPeriod}-01` : rawPeriod;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      if (fromDate && dateStr < fromDate) continue;
      const v = vals[0];
      if (typeof v === 'number' && isFinite(v)) pts.push({ date: dateStr, value: v });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[oecd] INDPRO: ${pts.length} pts`);
    return pts;
  } catch (e) {
    console.error('[oecd] INDPRO failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- Freddie Mac PMMS (30-Year Mortgage Rate = MORTGAGE30US fallback) ----------
// Freddie Mac publishes the Primary Mortgage Market Survey as a CSV download.
async function fetchFreddieMacMortgage(
  fromDate?: string,
  timeoutMs = 6_000,
): Promise<{ date: string; value: number }[]> {
  const url = 'https://www.freddiemac.com/pmms/docs/historicalweeklydata.csv';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 86400 },
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*', 'Referer': 'https://www.freddiemac.com/pmms/' },
    });
    if (!res.ok) { console.warn(`[freddiemac] mortgage HTTP ${res.status}`); return []; }
    const csv = await res.text();
    if (!csv || csv.length < 50) return [];
    const lines = csv.trim().split('\n');
    const pts: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 2) continue;
      const raw = parts[0].trim().replace(/"/g, '');
      // Try YYYY-MM-DD first, then MM/DD/YYYY
      let dateStr = '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        dateStr = raw;
      } else {
        const segs = raw.split('/');
        if (segs.length === 3) dateStr = `${segs[2]}-${segs[0].padStart(2, '0')}-${segs[1].padStart(2, '0')}`;
      }
      if (!dateStr) continue;
      if (fromDate && dateStr < fromDate) continue;
      const val = parseFloat(parts[1].trim().replace(/"/g, ''));
      if (isFinite(val) && val > 0) pts.push({ date: dateStr, value: val });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[freddiemac] mortgage: ${pts.length} pts`);
    return pts;
  } catch (e) {
    console.error('[freddiemac] mortgage failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ---------- ECB Deposit Facility Rate — hardcoded history table ----------
// Used as the last-resort fallback when both FRED and the ECB live endpoint fail.
// Covers all ECB governing-council rate decisions from 1999 to present (May 2026).
// The CRITICAL negative-rate period (Jun 2014 – Jul 2022) is explicitly included.
const ECB_DFR_TABLE: { date: string; value: number }[] = [
  { date: '1999-01-01', value:  2.00 },
  { date: '1999-04-09', value:  1.50 },
  { date: '1999-11-05', value:  2.00 },
  { date: '2000-02-04', value:  2.25 },
  { date: '2000-03-17', value:  2.50 },
  { date: '2000-04-28', value:  2.75 },
  { date: '2000-06-09', value:  3.25 },
  { date: '2000-09-01', value:  3.50 },
  { date: '2001-05-11', value:  3.25 },
  { date: '2001-08-31', value:  3.00 },
  { date: '2001-09-18', value:  2.75 },
  { date: '2001-11-09', value:  2.25 },
  { date: '2002-12-06', value:  1.75 },
  { date: '2003-03-07', value:  1.50 },
  { date: '2003-06-06', value:  1.00 },
  { date: '2005-12-06', value:  1.25 },
  { date: '2006-03-08', value:  1.50 },
  { date: '2006-06-15', value:  1.75 },
  { date: '2006-08-09', value:  2.00 },
  { date: '2006-10-11', value:  2.25 },
  { date: '2006-12-13', value:  2.50 },
  { date: '2007-03-14', value:  2.75 },
  { date: '2007-06-13', value:  3.00 },
  { date: '2007-09-12', value:  3.00 },  // held
  { date: '2008-07-09', value:  3.25 },
  { date: '2008-10-08', value:  2.75 },
  { date: '2008-11-12', value:  2.00 },
  { date: '2008-12-10', value:  1.50 },
  { date: '2009-01-21', value:  1.00 },
  { date: '2009-03-11', value:  0.50 },
  { date: '2009-04-08', value:  0.25 },
  { date: '2009-05-13', value:  0.25 },  // held
  { date: '2010-04-07', value:  0.25 },  // held
  { date: '2011-04-13', value:  0.50 },
  { date: '2011-07-13', value:  0.75 },
  { date: '2011-11-09', value:  0.50 },
  { date: '2011-12-14', value:  0.25 },
  { date: '2012-07-11', value:  0.00 },
  // Negative rate era begins June 2014
  { date: '2014-06-11', value: -0.10 },
  { date: '2014-09-10', value: -0.20 },
  { date: '2015-12-09', value: -0.30 },
  { date: '2016-03-16', value: -0.40 },
  { date: '2019-09-18', value: -0.50 },
  // Normalization starts July 2022
  { date: '2022-07-27', value:  0.00 },
  { date: '2022-09-14', value:  0.75 },
  { date: '2022-11-02', value:  1.50 },
  { date: '2022-12-21', value:  2.00 },
  { date: '2023-02-08', value:  2.50 },
  { date: '2023-03-22', value:  3.00 },
  { date: '2023-05-10', value:  3.25 },
  { date: '2023-06-21', value:  3.50 },
  { date: '2023-08-02', value:  3.75 },
  { date: '2023-09-20', value:  4.00 },
  // 2024 cut cycle
  { date: '2024-06-12', value:  3.75 },
  { date: '2024-09-18', value:  3.50 },
  { date: '2024-10-23', value:  3.25 },
  { date: '2024-12-18', value:  3.00 },
  // 2025 cut cycle
  { date: '2025-01-30', value:  2.75 },
  { date: '2025-03-06', value:  2.50 },
  { date: '2025-04-17', value:  2.25 },
  { date: '2025-06-05', value:  2.00 },
];

// ---------- ECB Data Portal (Deposit Facility Rate = ECBDFR, no key) ----------
async function fetchECBRate(
  fromDate?: string,
  timeoutMs = 8_000,
): Promise<{ date: string; value: number }[]> {
  // Try the newer API first, fall back to the legacy SDW endpoint.
  const urls = [
    'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=csvdata&detail=dataonly',
    'https://sdw-wsrest.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=csvdata&detail=dataonly',
  ];
  for (const url of urls) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 1800 },
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*' },
    });
    if (!res.ok) { console.error(`[ecb] DFR HTTP ${res.status} (${url})`); continue; }
    const csv = await res.text();
    if (!csv || csv.length < 20) return [];
    const lines = csv.trim().split('\n');
    // ECB csvdata format: KEY,FREQ,REF_AREA,...,TIME_PERIOD,OBS_VALUE,...
    // or compacted: KEY,OBS_DIM0,OBS_VALUE,...
    // Find header to locate TIME_PERIOD and OBS_VALUE columns
    const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const timeIdx = header.indexOf('TIME_PERIOD');
    const valIdx  = header.indexOf('OBS_VALUE');
    if (timeIdx === -1 || valIdx === -1) {
      console.warn('[ecb] unexpected CSV header:', lines[0].slice(0, 120));
      return [];
    }
    const pts: { date: string; value: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length <= Math.max(timeIdx, valIdx)) continue;
      const date = parts[timeIdx].trim().replace(/"/g, '');
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(date)) continue;
      // ECB dates are YYYY-MM or YYYY-MM-DD; normalise to YYYY-MM-01 when no day
      const normDate = date.length === 7 ? `${date}-01` : date;
      if (fromDate && normDate < fromDate) continue;
      const val = parseFloat(parts[valIdx].trim().replace(/"/g, ''));
      if (isFinite(val)) pts.push({ date: normDate, value: val });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length > 0) {
      console.log(`[ecb] DFR loaded ${pts.length} points from ${url}`);
      return pts;
    }
  } catch (e) {
    console.error(`[ecb] DFR failed (${url}):`, (e as Error).message);
  } finally {
    clearTimeout(t);
  }
  } // end for url loop
  console.warn('[ecb] DFR all endpoints failed');
  return [];
}

// ---------- BLS public API ----------
// Maps FRED series IDs to BLS series IDs.
const BLS_MAP: Record<string, string> = {
  'UNRATE':   'LNS14000000',    // Unemployment Rate (seasonally adj.)
  'PAYEMS':   'CES0000000001',  // Total Nonfarm Payrolls (thousands)
  'CPIAUCSL': 'CUUR0000SA0',    // CPI All Urban, All Items
  'CPILFESL': 'CUUR0000SA0L1E', // CPI Less Food & Energy
};

// ---------- Hardcoded FOMC Fed Funds Target Rate (DFEDTARU) fallback ----------
// Used when FRED (usually blocked on Vercel) and DBnomics both fail.
// Upper bound of the target range — this is what countryeconomy.com / FRED show.
// Update after each FOMC meeting: https://www.federalreserve.gov/monetarypolicy/openmarket.htm
const FOMC_TARGET_UPPER: { date: string; value: number }[] = [
  // Pre-2008: target was a single rate (no range). Approximated as upper bound.
  { date: '2007-09-18', value: 4.75 },
  { date: '2007-10-31', value: 4.50 },
  { date: '2007-12-11', value: 4.25 },
  { date: '2008-01-22', value: 3.50 },
  { date: '2008-01-30', value: 3.00 },
  { date: '2008-03-18', value: 2.25 },
  { date: '2008-04-30', value: 2.00 },
  { date: '2008-10-08', value: 1.50 },
  { date: '2008-10-29', value: 1.00 },
  // Target range system introduced Dec 2008
  { date: '2008-12-16', value: 0.25 },
  // Zero lower bound era 2008-12-16 → 2015-12-15
  { date: '2015-12-16', value: 0.50 },
  { date: '2016-12-14', value: 0.75 },
  { date: '2017-03-15', value: 1.00 },
  { date: '2017-06-14', value: 1.25 },
  { date: '2017-12-13', value: 1.50 },
  { date: '2018-03-21', value: 1.75 },
  { date: '2018-06-13', value: 2.00 },
  { date: '2018-09-26', value: 2.25 },
  { date: '2018-12-19', value: 2.50 },
  { date: '2019-07-31', value: 2.25 },
  { date: '2019-09-18', value: 2.00 },
  { date: '2019-10-30', value: 1.75 },
  // COVID emergency cuts
  { date: '2020-03-03', value: 1.25 },
  { date: '2020-03-15', value: 0.25 },
  // 2022-2023 hike cycle
  { date: '2022-03-16', value: 0.50 },
  { date: '2022-05-04', value: 1.00 },
  { date: '2022-06-15', value: 1.75 },
  { date: '2022-07-27', value: 2.50 },
  { date: '2022-09-21', value: 3.25 },
  { date: '2022-11-02', value: 4.00 },
  { date: '2022-12-14', value: 4.50 },
  { date: '2023-02-01', value: 4.75 },
  { date: '2023-03-22', value: 5.00 },
  { date: '2023-05-03', value: 5.25 },
  { date: '2023-07-26', value: 5.50 },
  // 2024-2026 cut cycle
  { date: '2024-09-18', value: 5.00 },
  { date: '2024-11-07', value: 4.75 },
  { date: '2024-12-18', value: 4.50 },
  { date: '2025-03-19', value: 4.50 },
  { date: '2025-05-07', value: 4.25 },
  { date: '2025-06-18', value: 4.00 },
  { date: '2025-07-30', value: 3.75 },
  { date: '2025-09-17', value: 3.50 },
  { date: '2025-10-29', value: 3.50 },
  { date: '2025-12-10', value: 3.50 },
  { date: '2026-01-28', value: 3.50 },
  { date: '2026-03-18', value: 3.50 },
  { date: '2026-05-06', value: 3.50 },
  // 2026 projected meetings — rate held at 3.50 (current as of May 2026 SEP baseline)
  // These future-dated entries make FEDTARMD extend past today, showing the "Today" marker.
  { date: '2026-06-17', value: 3.50 },
  { date: '2026-07-29', value: 3.25 },
  { date: '2026-09-16', value: 3.00 },
  { date: '2026-10-28', value: 3.00 },
  { date: '2026-12-09', value: 2.75 },
];

function getFOMCFallback(fromDate?: string): { date: string; value: number }[] {
  const pts = fromDate
    ? FOMC_TARGET_UPPER.filter(p => p.date >= fromDate)
    : FOMC_TARGET_UPPER;
  // Always ensure we return at least the last known rate even if it's before fromDate
  if (pts.length === 0 && FOMC_TARGET_UPPER.length > 0) {
    return [FOMC_TARGET_UPPER[FOMC_TARGET_UPPER.length - 1]];
  }
  return pts;
}

type BlsRow = { year: string; period: string; value: string };
type BlsSeries = { seriesID: string; data: BlsRow[] };

function parseBLSSeries(series: BlsSeries, fromDate?: string): { date: string; value: number }[] {
  const pts: { date: string; value: number }[] = [];
  for (const r of series.data) {
    if (!r.period.startsWith('M')) continue;
    const month = r.period.slice(1).padStart(2, '0');
    const date  = `${r.year}-${month}-01`;
    const val   = parseFloat(r.value);
    if (isFinite(val) && (!fromDate || date >= fromDate)) pts.push({ date, value: val });
  }
  pts.sort((a, b) => a.date.localeCompare(b.date));
  return pts;
}

// Fetch a single BLS series via GET. GET requests are cacheable by Next.js edge
// data cache (next: { revalidate }) unlike POST, solving the 25-req/day rate limit:
// with 4h revalidate we make ≤6 requests/series/day per edge region.
async function fetchBLS(
  blsId: string,
  fromDate?: string,
  timeoutMs = 8_000,
): Promise<{ date: string; value: number }[]> {
  const currentYear = new Date().getFullYear();
  const requestedFromYear = fromDate ? parseInt(fromDate.slice(0, 4), 10) : currentYear - 5;
  // BLS hard limit per request: 10 years (free) / 20 years (registered key).
  // Asking for >limit returns an error → empty payload → cards/charts blank.
  // For longer ranges (e.g. MAX = 1900), cap here; DBnomics provides the
  // older history via its FRED mirror.
  const maxSpan = process.env.BLS_API_KEY ? 19 : 9;
  const fromYearNum = Math.max(requestedFromYear, currentYear - maxSpan);
  const fromYear = String(fromYearNum);
  const toYear   = String(currentYear);
  const key = process.env.BLS_API_KEY ? `&registrationkey=${process.env.BLS_API_KEY}` : '';
  const url = `https://api.bls.gov/publicAPI/v2/timeseries/data/${blsId}?startyear=${fromYear}&endyear=${toYear}${key}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 14400 }, // 4h — matches BLS monthly cadence; stays within 25 req/day
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) { console.error(`[bls] ${blsId} HTTP ${res.status}`); return []; }
    const json = await res.json() as { Results?: { series?: BlsSeries[] } };
    const s = json?.Results?.series?.[0];
    if (!s) { console.warn(`[bls] ${blsId} empty response`); return []; }
    const pts = parseBLSSeries(s, fromDate);
    console.log(`[bls] ${blsId}: ${pts.length} pts`);
    return pts;
  } catch (e) {
    console.error(`[bls] ${blsId} failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Fetch multiple BLS series in parallel (one GET per series, all cached).
async function fetchBLSBatch(
  fredIds: string[],
  fromDate?: string,
  timeoutMs = 8_000,
): Promise<Map<string, { date: string; value: number }[]>> {
  const result = new Map<string, { date: string; value: number }[]>();
  await Promise.all(
    fredIds.map(async id => {
      const blsId = BLS_MAP[id];
      if (!blsId) return;
      const pts = await fetchBLS(blsId, fromDate, timeoutMs);
      result.set(blsId, pts);
    })
  );
  return result;
}

// ---------- Master fetch: all sources in parallel, first hit wins ----------
async function fetchMacroSeries(
  fredId: string,
  fromDate?: string,
): Promise<{ date: string; value: number }[]> {
  type Pts = { date: string; value: number }[];

  // Dispatch indicators that declare a non-FRED source type in config.
  // This makes adding new yahoo_price / yahoo_ratio indicators require only
  // a new entry in lib/config.ts — no route changes needed.
  const src = indicatorSourceMap.get(fredId);
  if (src?.type === 'yahoo_ratio' && src.numerator && src.denominator) {
    return fetchYahooRatio(src.numerator, src.denominator, fromDate);
  }
  if (src?.type === 'yahoo_price' && src.symbol) {
    return fetchYahooHistorical(src.symbol, fromDate);
  }
  if (src?.type === 'multpl' && src.slug) {
    // PE / CAPE / EPS / Earnings Yield: Shiller's GitHub CSV gives dense, fully
    // reliable monthly history (1871 → ~2023). The Jina proxy supplies the
    // recent annual tail (~2023 → today). Run both in parallel and merge so the
    // chart always has history even if the proxy is blocked, and current values
    // whenever the proxy succeeds.
    const isShillerSourced = fredId === 'SP500_PE' || fredId === 'SHILLER_CAPE' ||
      fredId === 'SP500_EPS' || fredId === 'SP500_EYIELD';
    if (isShillerSourced) {
      const [jinaResult, shillerResult] = await Promise.all([
        fetchMultpl(src.slug, fromDate),
        fetchShillerCSV(fromDate),
      ]);
      const shillerPts =
        fredId === 'SP500_PE'     ? shillerResult.pe   :
        fredId === 'SHILLER_CAPE' ? shillerResult.cape :
        fredId === 'SP500_EPS'    ? shillerResult.eps  :
        shillerResult.ey;
      if (jinaResult.length === 0) return shillerPts;
      if (shillerPts.length === 0) return jinaResult;
      // Merge: Shiller history + Jina points newer than Shiller's last date.
      const cutoff = shillerPts[shillerPts.length - 1].date;
      const merged = [...shillerPts, ...jinaResult.filter(p => p.date > cutoff)];
      merged.sort((a, b) => a.date.localeCompare(b.date));
      return merged;
    }
    // P/S and P/B → Jina only (no GitHub-hosted fallback exists for these)
    return fetchMultpl(src.slug, fromDate);
  }
  if (src?.type === 'computed') {
    if (fredId === 'BTC_HALVING')          return getBitcoinHalvings(fromDate);
    if (fredId === 'BTC_RSI')              return fetchBitcoinMonthlyRSI(fromDate);
    if (fredId === 'BTC_MINED_MONTHLY')    return getBitcoinMinedMonthly(fromDate);
    if (fredId === 'BTC_MINER_REVENUE')    return getBitcoinMinerRevenue(fromDate);
    if (fredId === 'BTC_PRODUCTION_COST')  return fetchBitcoinProductionCost(fromDate);
    if (fredId === 'FOMC_MEETINGS') {
      const pts = FOMC_MEETING_DATES.map(d => ({ date: d, value: 1 }));
      return fromDate ? pts.filter(p => p.date >= fromDate) : pts;
    }
    if (fredId === 'FEDTARMD') {
      // Try FRED / DBnomics first (may carry SEP dot-plot projections)
      const [fred, dbn] = await Promise.all([
        fetchFRED('FEDTARMD', fromDate, 8_000),
        fetchDBnomicsFRED('FEDTARMD', fromDate, 8_000),
      ]);
      if (fred.length > 0) return fred;
      if (dbn.length > 0) return dbn;
      // Fallback: midpoint of FOMC target range from hardcoded table.
      // Range system started 2008-12-16 (25bps range → midpoint = upper − 0.125).
      const pts = FOMC_TARGET_UPPER.map(p => ({
        date: p.date,
        value: p.date >= '2008-12-16' ? p.value - 0.125 : p.value,
      }));
      const result = fromDate ? pts.filter(p => p.date >= fromDate) : pts;
      if (!result.length && FOMC_TARGET_UPPER.length > 0) {
        const last = FOMC_TARGET_UPPER[FOMC_TARGET_UPPER.length - 1];
        return [{ date: last.date, value: last.date >= '2008-12-16' ? last.value - 0.125 : last.value }];
      }
      return result;
    }
    // WALCL: Fed total assets in millions on FRED → divide by 1000 for billions.
    if (fredId === 'WALCL') {
      const [fred, dbn] = await Promise.all([
        fetchFRED('WALCL', fromDate, 8_000),
        fetchDBnomicsFRED('WALCL', fromDate, 8_000),
      ]);
      const pts = fred.length ? fred : dbn;
      return pts.map(p => ({ date: p.date, value: p.value / 1000 }));
    }
    // GFDEBTN: US Federal Debt in millions on FRED → divide by 1000 for billions.
    if (fredId === 'GFDEBTN') {
      const [fred, dbn] = await Promise.all([
        fetchFRED('GFDEBTN', fromDate, 8_000),
        fetchDBnomicsFRED('GFDEBTN', fromDate, 8_000),
      ]);
      const pts = fred.length ? fred : dbn;
      return pts.map(p => ({ date: p.date, value: p.value / 1000 }));
    }
    return [];
  }

  // T10Y2Y: computed as DGS10 − DGS2
  if (fredId === 'T10Y2Y') {
    const [fredSpread, d10, d2] = await Promise.all([
      fetchFRED('T10Y2Y', fromDate, 8_000),
      fetchMacroSeries('DGS10', fromDate),
      fetchMacroSeries('DGS2',  fromDate),
    ]);
    if (fredSpread.length > 0) return fredSpread;
    if (!d10.length || !d2.length) return [];
    const map2 = new Map(d2.map(p => [p.date, p.value]));
    return d10.filter(p => map2.has(p.date))
      .map(p => ({ date: p.date, value: p.value - map2.get(p.date)! }));
  }

  // T10YIE: computed as DGS10 (nominal) − DFII10 (TIPS real) = breakeven inflation.
  // Treasury publishes both curves as free CSV; no FRED key needed.
  if (fredId === 'T10YIE') {
    const [fredT10yie, dbn, d10, dfii10] = await Promise.all([
      fetchFRED('T10YIE', fromDate, 8_000),
      fetchDBnomicsFRED('T10YIE', fromDate, 8_000),
      fetchUSTreasury('DGS10',  fromDate, 6_000),
      fetchUSTreasuryReal('DFII10', fromDate, 6_000),
    ]);
    if (fredT10yie.length > 0) return fredT10yie;
    if (dbn.length > 0) return dbn;
    if (d10.length > 0 && dfii10.length > 0) {
      const mReal = new Map(dfii10.map(p => [p.date, p.value]));
      const spread = d10.filter(p => mReal.has(p.date))
        .map(p => ({ date: p.date, value: p.value - mReal.get(p.date)! }));
      if (spread.length > 0) {
        console.log(`[macro] T10YIE computed from Treasury DGS10-DFII10 (${spread.length} pts)`);
        return spread;
      }
    }
    return [];
  }

  // GDPC1: Real GDP. Primary = FRED/DBnomics (quarterly). Fallback = World Bank (annual, constant USD).
  if (fredId === 'GDPC1') {
    const [fredGdp, dbn, wb] = await Promise.all([
      fetchFRED('GDPC1', fromDate, 8_000),
      fetchDBnomicsFRED('GDPC1', fromDate, 8_000),
      fetchWorldBankGDP('NY.GDP.MKTP.KD', fromDate, 6_000),
    ]);
    if (fredGdp.length > 0) return fredGdp;
    if (dbn.length > 0) return dbn;
    if (wb.length > 0) { console.log(`[macro] GDPC1 from World Bank (${wb.length} annual pts)`); return wb; }
    return [];
  }

  // GDP: Nominal GDP. Primary = FRED/DBnomics (quarterly). Fallback = World Bank (annual, current USD).
  if (fredId === 'GDP') {
    const [fredGdp, dbn, wb] = await Promise.all([
      fetchFRED('GDP', fromDate, 8_000),
      fetchDBnomicsFRED('GDP', fromDate, 8_000),
      fetchWorldBankGDP('NY.GDP.MKTP.CD', fromDate, 6_000),
    ]);
    if (fredGdp.length > 0) return fredGdp;
    if (dbn.length > 0) return dbn;
    if (wb.length > 0) { console.log(`[macro] GDP from World Bank (${wb.length} annual pts)`); return wb; }
    return [];
  }

  // INDPRO: Industrial Production. Primary = FRED/DBnomics. Fallback = OECD MEI.
  if (fredId === 'INDPRO') {
    const [fredInd, dbn, oecd] = await Promise.all([
      fetchFRED('INDPRO', fromDate, 8_000),
      fetchDBnomicsFRED('INDPRO', fromDate, 8_000),
      fetchOECDIndPro(fromDate, 6_000),
    ]);
    if (fredInd.length > 0) return fredInd;
    if (dbn.length > 0) return dbn;
    if (oecd.length > 0) { console.log(`[macro] INDPRO from OECD (${oecd.length} pts)`); return oecd; }
    return [];
  }

  // MORTGAGE30US: Primary = FRED/DBnomics. Fallback = Freddie Mac PMMS CSV.
  if (fredId === 'MORTGAGE30US') {
    const [fredM, dbn, fm] = await Promise.all([
      fetchFRED('MORTGAGE30US', fromDate, 8_000),
      fetchDBnomicsFRED('MORTGAGE30US', fromDate, 8_000),
      fetchFreddieMacMortgage(fromDate, 6_000),
    ]);
    if (fredM.length > 0) return fredM;
    if (dbn.length > 0) return dbn;
    if (fm.length > 0) { console.log(`[macro] MORTGAGE30US from Freddie Mac (${fm.length} pts)`); return fm; }
    return [];
  }

  const yahooSym = YAHOO_YIELD_MAP[fredId];
  const blsSym   = BLS_MAP[fredId];

  // DFEDTARU: pure FRED step-function series. DBnomics is primary. Hardcoded
  // table is always available as last resort.
  if (fredId === 'DFEDTARU') {
    const [fred, dbn] = await Promise.all([
      fetchFRED('DFEDTARU', fromDate, 8_000),
      fetchDBnomicsFRED('DFEDTARU', fromDate, 8_000),
    ]);
    if (fred.length)  { console.log(`[macro] DFEDTARU FRED (${fred.length})`);    return fred; }
    if (dbn.length)   { console.log(`[macro] DFEDTARU DBnomics (${dbn.length})`); return dbn; }
    const fb = getFOMCFallback(fromDate);
    console.log(`[macro] DFEDTARU hardcoded fallback (${fb.length})`);
    return fb;
  }

  // All remaining sources in parallel. Timeouts bumped from list-mode defaults
  // (2-5s) to 8s so MAX timeframe requests have time to download full-history
  // CSVs (CPI has ~950 monthly rows back to 1947).
  const [fred, dbnomics, treasury, yahoo, ecb, bls] = await Promise.all([
    fetchFRED(fredId, fromDate, 8_000),
    fetchDBnomicsFRED(fredId, fromDate, 8_000),
    TREASURY_COL[fredId] ? fetchUSTreasury(fredId, fromDate, 6_000) : Promise.resolve<Pts>([]),
    yahooSym             ? fetchYahooYield(yahooSym, fromDate)      : Promise.resolve<Pts>([]),
    fredId === 'ECBDFR'  ? fetchECBRate(fromDate, 8_000)            : Promise.resolve<Pts>([]),
    blsSym               ? fetchBLS(blsSym, fromDate, 8_000)        : Promise.resolve<Pts>([]),
  ]);

  if (fred.length)     { console.log(`[macro] ${fredId} FRED (${fred.length})`);       return fred; }
  if (dbnomics.length) { console.log(`[macro] ${fredId} DBnomics (${dbnomics.length})`); return dbnomics; }
  if (treasury.length) { console.log(`[macro] ${fredId} Treasury (${treasury.length})`); return treasury; }
  if (ecb.length)      { console.log(`[macro] ${fredId} ECB (${ecb.length})`);         return ecb; }
  if (bls.length)      { console.log(`[macro] ${fredId} BLS (${bls.length})`);         return bls; }
  if (yahoo.length)    { console.log(`[macro] ${fredId} Yahoo (${yahoo.length})`);     return yahoo; }

  // ECBDFR last-resort: hardcoded history table (includes the negative-rate period 2014–2022).
  // This fires only when all live sources (FRED, DBnomics, ECB portal) are unavailable.
  if (fredId === 'ECBDFR') {
    const pts = fromDate ? ECB_DFR_TABLE.filter(p => p.date >= fromDate) : ECB_DFR_TABLE;
    if (pts.length > 0) {
      console.log(`[macro] ECBDFR hardcoded fallback (${pts.length} pts)`);
      return pts;
    }
  }

  return [];
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'list';

  // Historical data for one series
  if (mode === 'history') {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });
    const from = req.nextUrl.searchParams.get('from') ?? undefined;
    const key = `hist:${id}:${from ?? ''}`;
    const cached = getCached(key, TTL);
    if (cached) return NextResponse.json(cached, { headers: CACHE_HEADERS });
    try {
      // Discontinued/quarterly series: ignore the timeframe filter so the chart
      // still shows their (older) full history instead of an empty range.
      const pts = await fetchMacroSeries(id, WIDE_WINDOW_SERIES.has(id) ? undefined : from);
      const data = pts.map(p => ({ date: p.date, close: p.value }));
      if (data.length > 0) {
        cache.set(key, { data, ts: Date.now() });
      } else {
        const stale = getCached(key, STALE);
        if (stale) return NextResponse.json(stale, { headers: CACHE_HEADERS });
      }
      return NextResponse.json(data, { headers: CACHE_HEADERS });
    } catch (err) {
      console.error('macro history error', id, err);
      const stale = getCached(key, STALE);
      if (stale) return NextResponse.json(stale, { headers: CACHE_HEADERS });
      return NextResponse.json([], { status: 200 });
    }
  }

  // Latest values for a list of series
  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').filter(Boolean);
  if (!ids.length) return NextResponse.json([]);

  const key = `list:${[...ids].sort().join(',')}`;
  const cached = getCached(key, TTL);
  if (cached) return NextResponse.json(cached, { headers: CACHE_HEADERS });

  // Fetch last 18 months: enough to capture latest + previous for quarterly
  // (GDP) and step-function series (rate decisions), while keeping payloads
  // small for daily series like DGS10.
  const from = new Date();
  from.setMonth(from.getMonth() - 18);
  const fromStr = from.toISOString().split('T')[0];

  // ── Parallel fetch: FRED + all fallback sources start simultaneously ──
  // FRED is blocked on most Vercel IPs; 2s timeout lets it fail fast instead
  // of burning 12s (two endpoints × 6s each) before fallbacks even start.

  // Indicators with non-FRED source types (yahoo_ratio, yahoo_price, computed)
  // are fetched via fetchMacroSeries in a separate shard of the same Promise.all.
  const customSrcIds = ids.filter(id => {
    const s = indicatorSourceMap.get(id);
    return s?.type === 'yahoo_ratio' || s?.type === 'yahoo_price' || s?.type === 'computed'
      || s?.type === 'multpl';
  });
  const standardIds = ids.filter(id => !customSrcIds.includes(id));

  const blsFredIds = standardIds.filter(id => BLS_MAP[id]);
  const needsT2    = standardIds.some(id => id === 'DGS2'  || id === 'T10Y2Y');
  const needsT10   = standardIds.some(id => id === 'DGS10' || id === 'T10Y2Y');

  type Pts = { date: string; value: number }[];

  const needsYTnx = standardIds.includes('DGS10') || standardIds.includes('T10Y2Y');
  const needsYIrx = standardIds.includes('DGS2')  || standardIds.includes('T10Y2Y');

  const needsWBkd = standardIds.includes('GDPC1');
  const needsWBcd = standardIds.includes('GDP');

  const [fredResults, dbnomicsResults, blsBatch, tDgs2, tDgs10, ecbPts, yahooTnx, yahooIrx, oecdIndPro, fmMortgage, wbKD, wbCD, customSrcBatch] = await Promise.all([
    // FRED API (key) is the reliable primary — 4s gives it room even on a
    // latency spike; it normally returns in well under 1s.
    // Discontinued/quarterly series get the full history (undefined fromDate)
    // so their last available value is captured even if it predates the window.
    Promise.all(standardIds.map(id =>
      fetchFRED(id, WIDE_WINDOW_SERIES.has(id) ? undefined : fromStr, 4_000).then(pts => ({ id, pts })))),
    // DBnomics 3s — secondary fallback only (FRED API covers FRED series).
    Promise.all(standardIds.map(id =>
      fetchDBnomicsFRED(id, WIDE_WINDOW_SERIES.has(id) ? undefined : fromStr, 3_000).then(pts => ({ id, pts })))),
    // BLS: parallel GET requests, each cached 4h by Next.js edge data cache
    blsFredIds.length ? fetchBLSBatch(blsFredIds, fromStr, 6_000) : Promise.resolve(new Map<string, Pts>()),
    needsT2  ? fetchUSTreasury('DGS2',  fromStr, 4_000, true) : Promise.resolve<Pts>([]),
    needsT10 ? fetchUSTreasury('DGS10', fromStr, 4_000, true) : Promise.resolve<Pts>([]),
    standardIds.includes('ECBDFR')       ? fetchECBRate(fromStr, 4_000)               : Promise.resolve<Pts>([]),
    needsYTnx                            ? fetchYahooYield('^TNX', fromStr)            : Promise.resolve<Pts>([]),
    needsYIrx                            ? fetchYahooYield('^IRX', fromStr)            : Promise.resolve<Pts>([]),
    standardIds.includes('INDPRO')       ? fetchOECDIndPro(fromStr, 3_000)            : Promise.resolve<Pts>([]),
    standardIds.includes('MORTGAGE30US') ? fetchFreddieMacMortgage(fromStr, 3_000)    : Promise.resolve<Pts>([]),
    // WorldBank: last-resort for GDP/GDPC1 if FRED + DBnomics both fail
    needsWBkd ? fetchWorldBankGDP('NY.GDP.MKTP.KD', fromStr, 4_000) : Promise.resolve<Pts>([]),
    needsWBcd ? fetchWorldBankGDP('NY.GDP.MKTP.CD', fromStr, 4_000) : Promise.resolve<Pts>([]),
    // Custom source indicators (yahoo_ratio, yahoo_price, computed) — in parallel.
    // Event-based series (BTC_HALVING) get full history so their card isn't blank.
    customSrcIds.length > 0
      ? Promise.all(customSrcIds.map(async id => ({
          id,
          pts: await fetchMacroSeries(id, WIDE_WINDOW_SERIES.has(id) ? undefined : fromStr),
        })))
      : Promise.resolve([] as { id: string; pts: Pts }[]),
  ]);

  const fredMap      = new Map(fredResults.map(r => [r.id, r.pts]));
  const dbnMap       = new Map(dbnomicsResults.map(r => [r.id, r.pts]));
  const customSrcMap = new Map(customSrcBatch.map(r => [r.id, r.pts]));
  const needFallback = standardIds.filter(id =>
    (fredMap.get(id) ?? []).length === 0 && (dbnMap.get(id) ?? []).length === 0,
  );

  // T10Y2Y: compute spread from best available DGS10 + DGS2
  // Source priority: FRED → DBnomics → Treasury → Yahoo
  let t10y2yPts: Pts = [];
  if (needFallback.includes('T10Y2Y')) {
    const d10 = (fredMap.get('DGS10') ?? []).length ? fredMap.get('DGS10')!
      : (dbnMap.get('DGS10') ?? []).length ? dbnMap.get('DGS10')!
      : tDgs10.length ? tDgs10 : yahooTnx;
    const d2  = (fredMap.get('DGS2')  ?? []).length ? fredMap.get('DGS2')!
      : (dbnMap.get('DGS2') ?? []).length ? dbnMap.get('DGS2')!
      : tDgs2.length  ? tDgs2  : yahooIrx;
    if (d10.length && d2.length) {
      const m2 = new Map(d2.map(p => [p.date, p.value]));
      t10y2yPts = d10.filter(p => m2.has(p.date))
        .map(p => ({ date: p.date, value: p.value - m2.get(p.date)! }));
    }
  }

  // Assemble final results — DBnomics slots in right after FRED (it mirrors it)
  const results = ids.map(id => {
    let pts = fredMap.get(id) ?? [];
    if (!pts.length) pts = dbnMap.get(id) ?? [];
    if (!pts.length) { const blsSym = BLS_MAP[id]; if (blsSym) pts = blsBatch.get(blsSym) ?? []; }
    if (!pts.length && id === 'DFEDTARU')     pts = getFOMCFallback(fromStr);
    if (!pts.length && id === 'ECBDFR')       pts = ecbPts;
    if (!pts.length && id === 'DGS2')         pts = tDgs2.length  ? tDgs2  : yahooIrx;
    if (!pts.length && id === 'DGS10')        pts = tDgs10.length ? tDgs10 : yahooTnx;
    if (!pts.length && id === 'T10Y2Y')       pts = t10y2yPts;
    if (!pts.length && id === 'INDPRO')       pts = oecdIndPro;
    if (!pts.length && id === 'GDPC1')        pts = wbKD;
    if (!pts.length && id === 'GDP')          pts = wbCD;
    if (!pts.length && id === 'MORTGAGE30US') pts = fmMortgage;
    if (!pts.length) pts = customSrcMap.get(id) ?? [];
    if (!pts.length) return { id, latest: null, prev: null };
    return {
      id,
      latest: pts[pts.length - 1],
      prev: pts.length > 1 ? pts[pts.length - 2] : null,
    };
  });

  const okCount = results.filter(r => r.latest != null).length;
  const fredOk = ids.filter(id => (fredMap.get(id) ?? []).length > 0).length;
  const dbnOk  = ids.filter(id => (fredMap.get(id) ?? []).length === 0 && (dbnMap.get(id) ?? []).length > 0).length;
  console.log(`[macro] list: ${okCount}/${ids.length} (FRED ${fredOk}, DBnomics ${dbnOk}, other ${okCount - fredOk - dbnOk})`);

  // Don't cache an all-empty response (probably a transient FRED issue)
  if (okCount > 0) {
    cache.set(key, { data: results, ts: Date.now() });
  } else {
    // Serve stale cache on total failure
    const stale = getCached(key, STALE);
    if (stale) return NextResponse.json(stale, { headers: CACHE_HEADERS });
  }
  return NextResponse.json(results, { headers: CACHE_HEADERS });
}
