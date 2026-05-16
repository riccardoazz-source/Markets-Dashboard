import type { YahooEarnings, YahooEarningsPoint, YahooFinancialQuarter } from './yahoo';

interface FmpIncomeStatement {
  date: string;
  symbol: string;
  reportedCurrency?: string;
  period: string;
  calendarYear?: string;
  revenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  eps?: number;
  epsdiluted?: number;
}

const BASE = 'https://financialmodelingprep.com/api/v3';

async function fetchIncomeStatement(
  symbol: string,
  period: 'quarter' | 'annual',
  key: string,
  timeoutMs = 8_000,
): Promise<FmpIncomeStatement[] | null> {
  const limit = period === 'quarter' ? 40 : 20;
  const url = `${BASE}/income-statement/${encodeURIComponent(symbol)}`
    + `?period=${period}&limit=${limit}&apikey=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) {
      console.warn(`[fmp] ${symbol} ${period}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    // FMP returns { "Error Message": "..." } as a non-array object on errors; if first entry has it, bail.
    const first = data[0] as Record<string, unknown>;
    if (typeof first['Error Message'] === 'string') {
      console.warn(`[fmp] ${symbol} ${period}: ${first['Error Message']}`);
      return null;
    }
    return data as FmpIncomeStatement[];
  } catch (e) {
    console.warn(`[fmp] ${symbol} ${period} failed:`, (e as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchFmpEarnings(symbol: string): Promise<YahooEarnings | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;

  const [quarterly, annual] = await Promise.all([
    fetchIncomeStatement(symbol, 'quarter', key),
    fetchIncomeStatement(symbol, 'annual', key),
  ]);
  if (!quarterly && !annual) return null;

  const epsMap = new Map<string, YahooEarningsPoint>();
  const financialsMap = new Map<string, YahooFinancialQuarter>();
  let currency = 'USD';
  const today = new Date().toISOString().slice(0, 10);

  // Quarterly first — most granular, most recent
  for (const q of quarterly ?? []) {
    if (!q.date || q.date > today) continue;
    if (q.reportedCurrency) currency = q.reportedCurrency;
    financialsMap.set(q.date, {
      date: q.date,
      isAnnual: false,
      revenue: q.revenue,
      costOfRevenue: q.costOfRevenue,
      grossProfit: q.grossProfit,
      operatingIncome: q.operatingIncome,
      netIncome: q.netIncome,
    });
    const eps = typeof q.epsdiluted === 'number' ? q.epsdiluted : q.eps;
    if (typeof eps === 'number' && isFinite(eps)) {
      const periodLabel = q.period && q.calendarYear ? `${q.period} ${q.calendarYear}` : q.date;
      epsMap.set(q.date, { date: q.date, period: periodLabel, eps });
    }
  }

  // Annual — fills earlier years where quarterly isn't available on the free tier
  for (const a of annual ?? []) {
    if (!a.date || a.date > today) continue;
    if (a.reportedCurrency) currency = a.reportedCurrency;
    if (!financialsMap.has(a.date)) {
      financialsMap.set(a.date, {
        date: a.date,
        revenue: a.revenue,
        costOfRevenue: a.costOfRevenue,
        grossProfit: a.grossProfit,
        operatingIncome: a.operatingIncome,
        netIncome: a.netIncome,
        isAnnual: true,
      });
    }
    const eps = typeof a.epsdiluted === 'number' ? a.epsdiluted : a.eps;
    if (typeof eps === 'number' && isFinite(eps) && !epsMap.has(a.date)) {
      epsMap.set(a.date, {
        date: a.date,
        period: `FY ${a.calendarYear ?? a.date.slice(0, 4)}`,
        eps,
      });
    }
  }

  const epsOut = Array.from(epsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const financialsOut = Array.from(financialsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (!epsOut.length && !financialsOut.length) return null;

  console.log(`[fmp] ${symbol}: ${epsOut.length} EPS / ${financialsOut.length} financial entries`);
  return { quarterly: epsOut, financials: financialsOut, currency };
}
