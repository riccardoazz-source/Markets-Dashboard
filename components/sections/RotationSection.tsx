'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RelativeRotationGraph, type RRGAssetData } from '@/components/charts/RelativeRotationGraph';

const GROUPS = {
  sectors: {
    label: 'US Sectors',
    benchmark: { symbol: '^GSPC', name: 'S&P 500' },
    assets: [
      { symbol: 'XLK',  name: 'Technology',    color: '#3b82f6' },
      { symbol: 'XLF',  name: 'Financials',    color: '#10b981' },
      { symbol: 'XLE',  name: 'Energy',         color: '#f59e0b' },
      { symbol: 'XLV',  name: 'Health Care',    color: '#6366f1' },
      { symbol: 'XLI',  name: 'Industrials',    color: '#8b5cf6' },
      { symbol: 'XLU',  name: 'Utilities',      color: '#ec4899' },
      { symbol: 'XLY',  name: 'Discretionary',  color: '#f97316' },
      { symbol: 'XLP',  name: 'Staples',        color: '#14b8a6' },
      { symbol: 'XLRE', name: 'Real Estate',    color: '#ef4444' },
      { symbol: 'XLB',  name: 'Materials',      color: '#84cc16' },
      { symbol: 'XLC',  name: 'Communication',  color: '#06b6d4' },
    ],
  },
  indexes: {
    label: 'Global Indexes',
    benchmark: { symbol: 'URTH', name: 'MSCI World' },
    assets: [
      { symbol: '^GSPC',     name: 'S&P 500',     color: '#3b82f6' },
      { symbol: '^NDX',      name: 'Nasdaq 100',   color: '#8b5cf6' },
      { symbol: '^STOXX50E', name: 'Euro Stoxx',   color: '#10b981' },
      { symbol: '^N225',     name: 'Nikkei 225',   color: '#ef4444' },
      { symbol: 'EEM',       name: 'Emer. Mkts',   color: '#f59e0b' },
      { symbol: '^FTSE',     name: 'FTSE 100',     color: '#ec4899' },
      { symbol: 'EWZ',       name: 'Brazil',       color: '#14b8a6' },
    ],
  },
  crypto: {
    label: 'Crypto vs BTC',
    benchmark: { symbol: 'BTC-USD', name: 'Bitcoin' },
    assets: [
      { symbol: 'ETH-USD', name: 'Ethereum', color: '#6366f1' },
      { symbol: 'SOL-USD', name: 'Solana',   color: '#8b5cf6' },
      { symbol: 'BNB-USD', name: 'BNB',      color: '#f59e0b' },
      { symbol: 'XRP-USD', name: 'XRP',      color: '#3b82f6' },
      { symbol: 'ADA-USD', name: 'Cardano',  color: '#10b981' },
      { symbol: 'AVAX-USD',name: 'Avalanche',color: '#ef4444' },
    ],
  },
} as const;

type GroupKey = keyof typeof GROUPS;

const TAIL_OPTIONS = [4, 8, 13] as const;
type TailWeeks = typeof TAIL_OPTIONS[number];

function sma(arr: number[], period: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    const slice = arr.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function toWeekly(daily: { date: string; close: number }[]): { date: string; close: number }[] {
  const map = new Map<string, { date: string; close: number }>();
  for (const pt of daily) {
    const d = new Date(pt.date);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const startOfWeek = new Date(jan4);
    startOfWeek.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
    const weekNum = Math.ceil((((d.getTime() - startOfWeek.getTime()) / 86400000) + 1) / 7);
    const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    map.set(key, pt);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function computeRRG(
  assetWeekly: { date: string; close: number }[],
  benchmarkWeekly: { date: string; close: number }[],
): { date: string; rsRatio: number; rsMomentum: number }[] {
  const benchMap = new Map(benchmarkWeekly.map(p => [p.date, p.close]));
  const aligned = assetWeekly
    .filter(p => benchMap.has(p.date) && (benchMap.get(p.date) ?? 0) > 0)
    .map(p => ({ date: p.date, rs: p.close / benchMap.get(p.date)! }));

  if (aligned.length < 15) return [];

  const rsValues = aligned.map(p => p.rs);
  const sma10 = sma(rsValues, 10);
  const rsRatioValues = rsValues.map((rs, i) => {
    const s = sma10[i];
    if (s === null || s === 0) return null;
    return 100 * (rs / s);
  });

  const validRatios = rsRatioValues.map(v => v ?? 0);
  const sma4 = sma(validRatios, 4);

  const result: { date: string; rsRatio: number; rsMomentum: number }[] = [];
  for (let i = 0; i < aligned.length; i++) {
    const rsRatio = rsRatioValues[i];
    const s4 = sma4[i];
    if (rsRatio === null || s4 === null || s4 === 0 || i < 13) continue;
    result.push({
      date: aligned[i].date,
      rsRatio,
      rsMomentum: 100 * (rsRatio / s4),
    });
  }
  return result;
}

const fetchPrices = async (symbol: string, signal: AbortSignal): Promise<{ date: string; close: number }[]> => {
  const res = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=2Y`, { signal });
  if (!res.ok) return [];
  return res.json() as Promise<{ date: string; close: number }[]>;
};

const QUADRANT_LEGEND = [
  { label: 'Leading',   desc: 'Strong RS, rising momentum',  color: '#16a34a' },
  { label: 'Weakening', desc: 'Strong RS, falling momentum', color: '#d97706' },
  { label: 'Lagging',   desc: 'Weak RS, falling momentum',   color: '#dc2626' },
  { label: 'Improving', desc: 'Weak RS, rising momentum',    color: '#1d4ed8' },
];

export function RotationSection() {
  const [group, setGroup] = useState<GroupKey>('sectors');
  const [tailWeeks, setTailWeeks] = useState<TailWeeks>(8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rrgData, setRrgData] = useState<RRGAssetData[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const run = async () => {
      setLoading(true);
      setError(false);

      const cfg = GROUPS[group];
      const allSymbols = [cfg.benchmark.symbol, ...cfg.assets.map(a => a.symbol)];

      try {
        const results = await Promise.all(allSymbols.map(sym => fetchPrices(sym, signal)));

        if (signal.aborted) return;

        const [benchmarkDaily, ...assetDailys] = results;
        const benchmarkWeekly = toWeekly(benchmarkDaily);

        const computed: RRGAssetData[] = [];
        for (let i = 0; i < cfg.assets.length; i++) {
          const asset = cfg.assets[i];
          const assetWeekly = toWeekly(assetDailys[i]);
          const positions = computeRRG(assetWeekly, benchmarkWeekly);
          if (positions.length > 0) {
            computed.push({ symbol: asset.symbol, name: asset.name, color: asset.color, positions });
          }
        }

        setRrgData(computed);
      } catch (err) {
        if (signal.aborted) return;
        console.error(err);
        setError(true);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [group]);

  const cfg = GROUPS[group];

  return (
    <div className="space-y-4">
      {/* Group tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          {(Object.keys(GROUPS) as GroupKey[]).map(key => (
            <button
              key={key}
              onClick={() => setGroup(key)}
              className={clsx(
                'px-3 py-1.5 text-xs font-semibold rounded-md transition-all',
                group === key ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'
              )}
            >
              {GROUPS[key].label}
            </button>
          ))}
        </div>

        {/* Tail length selector */}
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          {TAIL_OPTIONS.map(w => (
            <button
              key={w}
              onClick={() => setTailWeeks(w)}
              className={clsx(
                'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                tailWeeks === w ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'
              )}
            >
              {w}w
            </button>
          ))}
        </div>

        <span className="text-xs text-gray-500">
          vs <span className="text-gray-300 font-medium">{cfg.benchmark.name}</span>
        </span>
      </div>

      {/* Chart area */}
      <div className="rounded-xl border border-border bg-bg-card p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner size={32} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-sm text-gray-500">Failed to load data. Please try again.</p>
          </div>
        ) : rrgData.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-sm text-gray-500">No data available.</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl mx-auto">
            <RelativeRotationGraph assets={rrgData} tailWeeks={tailWeeks} height={500} />
          </div>
        )}
      </div>

      {/* Legend */}
      {!loading && !error && rrgData.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {QUADRANT_LEGEND.map(q => (
            <div key={q.label} className="rounded-lg border border-border bg-bg-card px-3 py-2 flex items-start gap-2">
              <span className="mt-0.5 shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: q.color }} />
              <div>
                <p className="text-xs font-semibold text-gray-200">{q.label}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{q.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
