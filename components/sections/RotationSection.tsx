'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RelativeRotationGraph, type RRGAssetData } from '@/components/charts/RelativeRotationGraph';

const BENCHMARK = { symbol: '^GSPC', name: 'S&P 500' };

const ASSET_GROUPS = [
  {
    key: 'sectors',
    label: 'US Sectors',
    assets: [
      { symbol: 'XLK',  name: 'Tech',     color: '#3b82f6' },
      { symbol: 'XLF',  name: 'Finance',  color: '#10b981' },
      { symbol: 'XLE',  name: 'Energy',   color: '#f59e0b' },
      { symbol: 'XLV',  name: 'Health',   color: '#a855f7' },
      { symbol: 'XLI',  name: 'Indust.',  color: '#8b5cf6' },
      { symbol: 'XLU',  name: 'Utils.',   color: '#ec4899' },
      { symbol: 'XLY',  name: 'Discret.', color: '#f97316' },
      { symbol: 'XLP',  name: 'Staples',  color: '#14b8a6' },
      { symbol: 'XLRE', name: 'Real Est.',color: '#ef4444' },
      { symbol: 'XLB',  name: 'Matls.',   color: '#84cc16' },
      { symbol: 'XLC',  name: 'Telecom',  color: '#06b6d4' },
    ],
  },
  {
    key: 'indexes',
    label: 'Global Indexes',
    assets: [
      { symbol: '^NDX',      name: 'Nasdaq',    color: '#818cf8' },
      { symbol: '^RUT',      name: 'Russell',   color: '#4ade80' },
      { symbol: '^STOXX50E', name: 'EuroStoxx', color: '#34d399' },
      { symbol: '^N225',     name: 'Nikkei',    color: '#fb7185' },
      { symbol: 'EEM',       name: 'Em.Mkts',   color: '#fbbf24' },
      { symbol: '^FTSE',     name: 'FTSE',      color: '#f472b6' },
      { symbol: 'EWZ',       name: 'Brazil',    color: '#38bdf8' },
    ],
  },
  {
    key: 'crypto',
    label: 'Crypto',
    assets: [
      { symbol: 'BTC-USD',  name: 'BTC',  color: '#fb923c' },
      { symbol: 'ETH-USD',  name: 'ETH',  color: '#7c3aed' },
      { symbol: 'SOL-USD',  name: 'SOL',  color: '#c084fc' },
      { symbol: 'BNB-USD',  name: 'BNB',  color: '#ca8a04' },
      { symbol: 'XRP-USD',  name: 'XRP',  color: '#60a5fa' },
      { symbol: 'ADA-USD',  name: 'ADA',  color: '#2dd4bf' },
    ],
  },
] as const;

type GroupKey = typeof ASSET_GROUPS[number]['key'];
type AssetEntry = { symbol: string; name: string; color: string; group: GroupKey };

const ALL_ASSETS: AssetEntry[] = ASSET_GROUPS.flatMap(g =>
  g.assets.map(a => ({ ...a, group: g.key }))
);
const ALL_SYMBOLS = ALL_ASSETS.map(a => a.symbol);

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

const QUADRANT_LEGEND = [
  { label: 'Leading',   desc: 'Strong RS, rising momentum',  color: '#16a34a' },
  { label: 'Weakening', desc: 'Strong RS, falling momentum', color: '#d97706' },
  { label: 'Lagging',   desc: 'Weak RS, falling momentum',   color: '#dc2626' },
  { label: 'Improving', desc: 'Weak RS, rising momentum',    color: '#1d4ed8' },
];

export function RotationSection() {
  const [tailWeeks, setTailWeeks] = useState<TailWeeks>(8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [allRrgData, setAllRrgData] = useState<Map<string, RRGAssetData>>(new Map());
  const [activeSymbols, setActiveSymbols] = useState<Set<string>>(new Set(ALL_SYMBOLS));

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const run = async () => {
      setLoading(true);
      setError(false);
      try {
        const fetchOne = (sym: string) =>
          fetch(`/api/historical?symbol=${encodeURIComponent(sym)}&timeframe=2Y`, { signal })
            .then(r => r.ok ? (r.json() as Promise<{ date: string; close: number }[]>) : Promise.resolve([]));

        const [benchmarkDaily, ...assetDailys] = await Promise.all(
          [BENCHMARK.symbol, ...ALL_SYMBOLS].map(fetchOne)
        );

        if (signal.aborted) return;

        const benchmarkWeekly = toWeekly(benchmarkDaily);
        const map = new Map<string, RRGAssetData>();

        for (let i = 0; i < ALL_ASSETS.length; i++) {
          const asset = ALL_ASSETS[i];
          const weekly = toWeekly(assetDailys[i]);
          const positions = computeRRG(weekly, benchmarkWeekly);
          if (positions.length > 0) {
            map.set(asset.symbol, {
              symbol: asset.symbol,
              name: asset.name,
              color: asset.color,
              positions,
            });
          }
        }

        setAllRrgData(map);
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
  }, []);

  const toggleGroup = (groupKey: GroupKey) => {
    const group = ASSET_GROUPS.find(g => g.key === groupKey)!;
    const groupSymbols = group.assets.map(a => a.symbol);
    const allActive = groupSymbols.every(s => activeSymbols.has(s));
    setActiveSymbols(prev => {
      const next = new Set(prev);
      if (allActive) groupSymbols.forEach(s => next.delete(s));
      else groupSymbols.forEach(s => next.add(s));
      return next;
    });
  };

  const toggleAsset = (symbol: string) => {
    setActiveSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const visibleAssets = [...allRrgData.values()].filter(a => activeSymbols.has(a.symbol));

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Tail length */}
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
          vs <span className="text-gray-300 font-medium">{BENCHMARK.name}</span>
        </span>
      </div>

      {/* Group + asset toggles */}
      <div className="space-y-2">
        {ASSET_GROUPS.map(group => {
          const groupSymbols = group.assets.map(a => a.symbol);
          const activeCount = groupSymbols.filter(s => activeSymbols.has(s)).length;
          const allOn = activeCount === groupSymbols.length;
          const someOn = activeCount > 0 && !allOn;

          return (
            <div key={group.key} className="flex items-center gap-2 flex-wrap">
              {/* Group toggle button */}
              <button
                onClick={() => toggleGroup(group.key as GroupKey)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-semibold rounded-md border transition-all shrink-0',
                  allOn
                    ? 'border-gray-500 bg-gray-700 text-gray-200'
                    : someOn
                    ? 'border-gray-600 bg-gray-800 text-gray-400'
                    : 'border-gray-700 bg-transparent text-gray-600'
                )}
              >
                {group.label}
              </button>

              {/* Individual asset pills */}
              <div className="flex gap-1 flex-wrap">
                {group.assets.map(asset => {
                  const isActive = activeSymbols.has(asset.symbol);
                  const hasData = allRrgData.has(asset.symbol);
                  return (
                    <button
                      key={asset.symbol}
                      onClick={() => toggleAsset(asset.symbol)}
                      disabled={loading || !hasData}
                      className={clsx(
                        'px-2 py-0.5 text-[11px] font-semibold rounded-full border transition-all',
                        isActive
                          ? 'text-gray-900'
                          : 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-500',
                        (!loading && !hasData) && 'opacity-30 cursor-not-allowed'
                      )}
                      style={isActive ? { background: asset.color, borderColor: asset.color } : {}}
                    >
                      {asset.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
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
        ) : visibleAssets.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-sm text-gray-500">Select at least one asset above.</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl mx-auto">
            <RelativeRotationGraph assets={visibleAssets} tailWeeks={tailWeeks} height={520} />
          </div>
        )}
      </div>

      {/* Quadrant legend */}
      {!loading && !error && (
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
