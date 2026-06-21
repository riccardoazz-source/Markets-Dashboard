'use client';

import { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { INDEXES, COMMODITIES, CRYPTO_IDS, SECTORS, CRYPTO_YAHOO_SYMBOLS } from '@/lib/config';
import { QuoteData, CryptoData } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RotationChart, ChartAsset } from '@/components/charts/RotationChart';

interface RotationItem {
  symbol: string;
  name: string;
  subCategory: string;
  group: 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors';
  price: number | null;
  currency: string;
  dayPct: number | null;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  fiveYPct: number | null;
}

interface RollingReturn {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
}

type SortKey = 'day' | '1m' | '3m' | '6m' | '1y' | '5y';
type GroupFilter = 'all' | 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors';
type ChartTimeframe = '1M' | '3M' | '6M' | '1Y';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'day', label: 'Day'  },
  { value: '1m',  label: '1M'   },
  { value: '3m',  label: '3M'   },
  { value: '6m',  label: '6M'   },
  { value: '1y',  label: '1Y'   },
  { value: '5y',  label: '5Y'   },
];

const GROUP_FILTERS: { value: GroupFilter; label: string }[] = [
  { value: 'all',         label: 'All'         },
  { value: 'Indexes',     label: 'Indexes'     },
  { value: 'Crypto',      label: 'Crypto'      },
  { value: 'Commodities', label: 'Commodities' },
  { value: 'Sectors',     label: 'Sectors'     },
];

const CHART_TF_OPTIONS: ChartTimeframe[] = ['1M', '3M', '6M', '1Y'];

const GROUP_COLORS: Record<RotationItem['group'], string> = {
  Indexes:     '#3b82f6',
  Crypto:      '#f97316',
  Commodities: '#f59e0b',
  Sectors:     '#8b5cf6',
};

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#a855f7',
];

function getPct(item: RotationItem, key: SortKey): number | null {
  switch (key) {
    case 'day': return item.dayPct;
    case '1m':  return item.r1m;
    case '3m':  return item.r3m;
    case '6m':  return item.r6m;
    case '1y':  return item.r1y;
    case '5y':  return item.fiveYPct;
  }
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function pctColor(v: number | null): string {
  if (v == null) return 'text-gray-500';
  if (v > 0) return 'text-green-400';
  if (v < 0) return 'text-red-400';
  return 'text-gray-500';
}

// Compares last month's pace vs the 3-month average monthly pace.
// Positive = accelerating (more money flowing in recently than average pace).
function accelArrow(r1m: number | null, r3m: number | null): { arrow: string; color: string } | null {
  if (r1m == null || r3m == null) return null;
  const diff = r1m - r3m / 3;
  if (diff > 5)  return { arrow: '↑↑', color: 'text-green-300' };
  if (diff > 1)  return { arrow: '↑',  color: 'text-green-500' };
  if (diff < -5) return { arrow: '↓↓', color: 'text-red-300'   };
  if (diff < -1) return { arrow: '↓',  color: 'text-red-500'   };
  return           { arrow: '→',  color: 'text-gray-500'  };
}

export function RotationSection() {
  const [items, setItems] = useState<RotationItem[]>([]);
  const [rollingLoading, setRollingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('3m');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('3M');
  const userHasToggled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setRollingLoading(true);
      setError(false);
      try {
        const indexSymbols = INDEXES.map(i => i.symbol);
        const commSymbols  = COMMODITIES.map(c => c.symbol);

        // Phase 1: quotes (fast — Day% + 5Y from the existing API)
        const [quotesRes, cryptoRes, sectorsRes] = await Promise.all([
          fetch(`/api/quotes?symbols=${[...indexSymbols, ...commSymbols].join(',')}`),
          fetch('/api/crypto?mode=markets'),
          fetch('/api/sectors'),
        ]);

        const quotes: QuoteData[]  = await quotesRes.json();
        const cryptos: CryptoData[] = await cryptoRes.json();
        const sectors = await sectorsRes.json() as Array<{
          symbol: string; name: string; category: string;
          price: number | null; currency: string;
          changePercent: number | null; fiveYearReturn: number | null;
        }>;

        if (cancelled) return;

        const quoteMap = new Map<string, QuoteData>(quotes.map(q => [q.symbol, q]));

        const indexItems: RotationItem[] = INDEXES.map(idx => {
          const q = quoteMap.get(idx.symbol);
          return {
            symbol: idx.symbol, name: idx.name, subCategory: idx.category, group: 'Indexes',
            price: q?.price ?? null, currency: q?.currency ?? 'USD',
            dayPct: q?.changePercent ?? null,
            r1m: null, r3m: null, r6m: null, r1y: null,
            fiveYPct: q?.fiveYearChangePercent ?? null,
          };
        });

        const commItems: RotationItem[] = COMMODITIES.map(c => {
          const q = quoteMap.get(c.symbol);
          return {
            symbol: c.symbol, name: c.name, subCategory: c.category, group: 'Commodities',
            price: q?.price ?? null, currency: q?.currency ?? 'USD',
            dayPct: q?.changePercent ?? null,
            r1m: null, r3m: null, r6m: null, r1y: null,
            fiveYPct: q?.fiveYearChangePercent ?? null,
          };
        });

        const cryptoMap = new Map<string, CryptoData>(
          cryptos.map(c => [c.symbol.toUpperCase(), c])
        );
        const cryptoItems: RotationItem[] = CRYPTO_IDS.map(entry => {
          const c = cryptoMap.get(entry.symbol.toUpperCase());
          const yahooSym = CRYPTO_YAHOO_SYMBOLS[entry.id] ?? `${entry.symbol}-USD`;
          return {
            symbol: yahooSym, name: entry.name, subCategory: 'Crypto', group: 'Crypto',
            price: c?.price ?? null, currency: 'USD',
            dayPct: c?.change24hPercent ?? null,
            r1m: null, r3m: null, r6m: null, r1y: null,
            fiveYPct: c?.fiveYearChangePercent ?? null,
          };
        });

        const sectorItems: RotationItem[] = sectors.map(s => ({
          symbol: s.symbol, name: s.name, subCategory: s.category, group: 'Sectors' as const,
          price: s.price, currency: s.currency ?? 'USD',
          dayPct: s.changePercent,
          r1m: null, r3m: null, r6m: null, r1y: null,
          fiveYPct: s.fiveYearReturn,
        }));

        const allItems = [...indexItems, ...commItems, ...cryptoItems, ...sectorItems];
        setItems(allItems);
        setLoading(false);

        // Phase 2: rolling returns (server computes 1Y history for all 71 assets)
        const rollingRes = await fetch('/api/rotation-returns');
        const rollingData: RollingReturn[] = await rollingRes.json();
        if (cancelled) return;

        const rollingMap = new Map<string, RollingReturn>(rollingData.map(r => [r.symbol, r]));

        const enriched = allItems.map(item => {
          const r = rollingMap.get(item.symbol);
          return r ? { ...item, r1m: r.r1m, r3m: r.r3m, r6m: r.r6m, r1y: r.r1y } : item;
        });

        setItems(enriched);

        if (!userHasToggled.current) {
          const sorted = [...enriched].sort((a, b) =>
            (getPct(b, '3m') ?? -Infinity) - (getPct(a, '3m') ?? -Infinity)
          );
          setSelectedSymbols(new Set(sorted.slice(0, 5).map(i => i.symbol)));
        }

        setRollingLoading(false);
      } catch (err) {
        if (!cancelled) { console.error(err); setError(true); setLoading(false); setRollingLoading(false); }
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  const filteredItems = groupFilter === 'all'
    ? items
    : items.filter(i => i.group === groupFilter);

  const sortedItems = [...filteredItems].sort((a, b) =>
    (getPct(b, sortBy) ?? -Infinity) - (getPct(a, sortBy) ?? -Infinity)
  );

  const toggleSymbol = (symbol: string) => {
    userHasToggled.current = true;
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else if (next.size < 10) next.add(symbol);
      return next;
    });
  };

  const colorMap = new Map<string, string>();
  let colorIdx = 0;
  for (const sym of selectedSymbols) {
    colorMap.set(sym, CHART_COLORS[colorIdx % CHART_COLORS.length]);
    colorIdx++;
  }

  const chartAssets: ChartAsset[] = Array.from(selectedSymbols)
    .map(sym => {
      const item = items.find(i => i.symbol === sym);
      return item ? { symbol: sym, name: item.name, color: colorMap.get(sym) ?? '#3b82f6' } : null;
    })
    .filter((a): a is ChartAsset => a !== null);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={clsx(
                'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                sortBy === opt.value
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-border'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          {GROUP_FILTERS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setGroupFilter(opt.value)}
              className={clsx(
                'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                groupFilter === opt.value
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-border'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Rolling returns loading badge */}
      {!loading && rollingLoading && (
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <LoadingSpinner size={12} />
          <span>Computing rolling returns…</span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <LoadingSpinner size={32} />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-sm text-gray-500">Failed to load data. Please try again.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-8 px-3 py-2 text-left text-[10px] font-medium text-gray-600">#</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-600">Asset</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden md:table-cell', sortBy === 'day' ? 'text-accent' : 'text-gray-600')}>Day</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium', sortBy === '1m' ? 'text-accent' : 'text-gray-600')}>1M</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium', sortBy === '3m' ? 'text-accent' : 'text-gray-600')}>3M</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden sm:table-cell', sortBy === '6m' ? 'text-accent' : 'text-gray-600')}>6M</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden sm:table-cell', sortBy === '1y' ? 'text-accent' : 'text-gray-600')}>1Y</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden lg:table-cell', sortBy === '5y' ? 'text-accent' : 'text-gray-600')}>5Y</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedItems.map((item, idx) => {
                  const isSelected = selectedSymbols.has(item.symbol);
                  const dotColor   = GROUP_COLORS[item.group];
                  const rowColor   = colorMap.get(item.symbol);
                  const accel      = accelArrow(item.r1m, item.r3m);
                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => toggleSymbol(item.symbol)}
                      className={clsx(
                        'cursor-pointer transition-colors hover:bg-border/30',
                        isSelected && 'bg-accent/10'
                      )}
                    >
                      <td className="px-3 py-2 text-[11px] text-gray-600 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="shrink-0 w-2 h-2 rounded-full"
                            style={{ background: isSelected && rowColor ? rowColor : dotColor, opacity: isSelected ? 1 : 0.4 }}
                          />
                          <span className="truncate text-xs font-medium text-gray-200">{item.name}</span>
                          <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-border text-gray-500 leading-none hidden sm:inline">
                            {item.subCategory}
                          </span>
                          {accel && !rollingLoading && (
                            <span className={clsx('shrink-0 text-[10px] font-bold leading-none', accel.color)}>
                              {accel.arrow}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums hidden md:table-cell', sortBy === 'day' ? `font-bold ${pctColor(item.dayPct)}` : pctColor(item.dayPct))}>
                        {fmtPct(item.dayPct)}
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums', sortBy === '1m' ? `font-bold ${pctColor(item.r1m)}` : pctColor(item.r1m))}>
                        {rollingLoading ? <span className="text-gray-700">…</span> : fmtPct(item.r1m)}
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums', sortBy === '3m' ? `font-bold ${pctColor(item.r3m)}` : pctColor(item.r3m))}>
                        {rollingLoading ? <span className="text-gray-700">…</span> : fmtPct(item.r3m)}
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums hidden sm:table-cell', sortBy === '6m' ? `font-bold ${pctColor(item.r6m)}` : pctColor(item.r6m))}>
                        {rollingLoading ? <span className="text-gray-700">…</span> : fmtPct(item.r6m)}
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums hidden sm:table-cell', sortBy === '1y' ? `font-bold ${pctColor(item.r1y)}` : pctColor(item.r1y))}>
                        {rollingLoading ? <span className="text-gray-700">…</span> : fmtPct(item.r1y)}
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums hidden lg:table-cell', sortBy === '5y' ? `font-bold ${pctColor(item.fiveYPct)}` : pctColor(item.fiveYPct))}>
                        {fmtPct(item.fiveYPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-gray-400 font-medium">
            {selectedSymbols.size === 0
              ? 'Click rows to add assets to chart'
              : `${selectedSymbols.size} asset${selectedSymbols.size !== 1 ? 's' : ''} — normalized % return`}
          </p>
          <div className="flex gap-1 bg-bg-input rounded-lg p-1">
            {CHART_TF_OPTIONS.map(tf => (
              <button
                key={tf}
                onClick={() => setChartTimeframe(tf)}
                className={clsx(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                  chartTimeframe === tf
                    ? 'bg-accent text-white'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-border'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <RotationChart assets={chartAssets} timeframe={chartTimeframe} />
      </div>
    </div>
  );
}
