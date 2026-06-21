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
  mtdPct: number | null;
  ytdPct: number | null;
  fiveYPct: number | null;
}

type SortKey = 'day' | 'mtd' | 'ytd' | '5y';
type GroupFilter = 'all' | 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors';
type ChartTimeframe = '1M' | '3M' | '6M' | '1Y';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'day',  label: 'Day' },
  { value: 'mtd',  label: 'MTD' },
  { value: 'ytd',  label: 'YTD' },
  { value: '5y',   label: '5Y' },
];

const GROUP_FILTERS: { value: GroupFilter; label: string }[] = [
  { value: 'all',          label: 'All' },
  { value: 'Indexes',      label: 'Indexes' },
  { value: 'Crypto',       label: 'Crypto' },
  { value: 'Commodities',  label: 'Commodities' },
  { value: 'Sectors',      label: 'Sectors' },
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
    case 'day':  return item.dayPct;
    case 'mtd':  return item.mtdPct;
    case 'ytd':  return item.ytdPct;
    case '5y':   return item.fiveYPct;
  }
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pctColor(v: number | null): string {
  if (v == null) return 'text-gray-500';
  if (v > 0) return 'text-green-400';
  if (v < 0) return 'text-red-400';
  return 'text-gray-500';
}

export function RotationSection() {
  const [items, setItems] = useState<RotationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('ytd');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('3M');
  const userHasToggled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(false);
      try {
        const indexSymbols = INDEXES.map(i => i.symbol);
        const commSymbols = COMMODITIES.map(c => c.symbol);

        const [quotesRes, cryptoRes, sectorsRes] = await Promise.all([
          fetch(`/api/quotes?symbols=${[...indexSymbols, ...commSymbols].join(',')}`),
          fetch('/api/crypto?mode=markets'),
          fetch('/api/sectors'),
        ]);

        const quotes: QuoteData[] = await quotesRes.json();
        const cryptos: CryptoData[] = await cryptoRes.json();
        const sectors = await sectorsRes.json() as Array<{
          symbol: string;
          name: string;
          category: string;
          price: number | null;
          currency: string;
          changePercent: number | null;
          mtdReturn: number | null;
          ytdReturn: number | null;
          fiveYearReturn: number | null;
        }>;

        if (cancelled) return;

        const quoteMap = new Map<string, QuoteData>(quotes.map(q => [q.symbol, q]));

        const indexItems: RotationItem[] = INDEXES.map(idx => {
          const q = quoteMap.get(idx.symbol);
          return {
            symbol: idx.symbol,
            name: idx.name,
            subCategory: idx.category,
            group: 'Indexes',
            price: q?.price ?? null,
            currency: q?.currency ?? 'USD',
            dayPct: q?.changePercent ?? null,
            mtdPct: q?.mtdChangePercent ?? null,
            ytdPct: q?.ytdChangePercent ?? null,
            fiveYPct: q?.fiveYearChangePercent ?? null,
          };
        });

        const commItems: RotationItem[] = COMMODITIES.map(c => {
          const q = quoteMap.get(c.symbol);
          return {
            symbol: c.symbol,
            name: c.name,
            subCategory: c.category,
            group: 'Commodities',
            price: q?.price ?? null,
            currency: q?.currency ?? 'USD',
            dayPct: q?.changePercent ?? null,
            mtdPct: q?.mtdChangePercent ?? null,
            ytdPct: q?.ytdChangePercent ?? null,
            fiveYPct: q?.fiveYearChangePercent ?? null,
          };
        });

        const cryptoSymbolMap = new Map<string, CryptoData>(
          cryptos.map(c => [c.symbol.toUpperCase(), c])
        );

        const cryptoItems: RotationItem[] = CRYPTO_IDS.map(entry => {
          const c = cryptoSymbolMap.get(entry.symbol.toUpperCase());
          const yahooSymbol = CRYPTO_YAHOO_SYMBOLS[entry.id] ?? `${entry.symbol}-USD`;
          return {
            symbol: yahooSymbol,
            name: entry.name,
            subCategory: 'Crypto',
            group: 'Crypto',
            price: c?.price ?? null,
            currency: 'USD',
            dayPct: c?.change24hPercent ?? null,
            mtdPct: c?.mtdChangePercent ?? null,
            ytdPct: c?.ytdChangePercent ?? null,
            fiveYPct: c?.fiveYearChangePercent ?? null,
          };
        });

        const sectorItems: RotationItem[] = sectors.map(s => ({
          symbol: s.symbol,
          name: s.name,
          subCategory: s.category,
          group: 'Sectors',
          price: s.price,
          currency: s.currency ?? 'USD',
          dayPct: s.changePercent,
          mtdPct: s.mtdReturn,
          ytdPct: s.ytdReturn,
          fiveYPct: s.fiveYearReturn,
        }));

        const allItems = [...indexItems, ...commItems, ...cryptoItems, ...sectorItems];
        setItems(allItems);

        if (!userHasToggled.current) {
          const sorted = [...allItems].sort((a, b) => {
            const va = getPct(a, 'ytd') ?? -Infinity;
            const vb = getPct(b, 'ytd') ?? -Infinity;
            return vb - va;
          });
          const top5 = new Set(sorted.slice(0, 5).map(i => i.symbol));
          setSelectedSymbols(top5);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  const filteredItems = groupFilter === 'all'
    ? items
    : items.filter(i => i.group === groupFilter);

  const sortedItems = [...filteredItems].sort((a, b) => {
    const va = getPct(a, sortBy) ?? -Infinity;
    const vb = getPct(b, sortBy) ?? -Infinity;
    return vb - va;
  });

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
      return item
        ? { symbol: sym, name: item.name, color: colorMap.get(sym) ?? '#3b82f6' }
        : null;
    })
    .filter((a): a is ChartAsset => a !== null);

  return (
    <div className="space-y-4">
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
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-600">Name</th>
                  <th className={clsx(
                    'px-3 py-2 text-right text-[10px] font-medium hidden sm:table-cell',
                    sortBy === 'day' ? 'text-accent' : 'text-gray-600'
                  )}>Day</th>
                  <th className={clsx(
                    'px-3 py-2 text-right text-[10px] font-medium',
                    sortBy === 'mtd' ? 'text-accent' : 'text-gray-600'
                  )}>MTD</th>
                  <th className={clsx(
                    'px-3 py-2 text-right text-[10px] font-medium',
                    sortBy === 'ytd' ? 'text-accent' : 'text-gray-600'
                  )}>YTD</th>
                  <th className={clsx(
                    'px-3 py-2 text-right text-[10px] font-medium hidden sm:table-cell',
                    sortBy === '5y' ? 'text-accent' : 'text-gray-600'
                  )}>5Y</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedItems.map((item, idx) => {
                  const isSelected = selectedSymbols.has(item.symbol);
                  const dotColor = GROUP_COLORS[item.group];
                  const rowColor = colorMap.get(item.symbol);
                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => toggleSymbol(item.symbol)}
                      className={clsx(
                        'cursor-pointer transition-colors hover:bg-border/30',
                        isSelected ? 'bg-accent/10' : ''
                      )}
                    >
                      <td className="px-3 py-2 text-[11px] text-gray-600 tabular-nums w-8">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isSelected && rowColor ? (
                            <span
                              className="shrink-0 w-2 h-2 rounded-full"
                              style={{ background: rowColor }}
                            />
                          ) : (
                            <span
                              className="shrink-0 w-2 h-2 rounded-full opacity-40"
                              style={{ background: dotColor }}
                            />
                          )}
                          <span className="truncate text-xs font-medium text-gray-200">
                            {item.name}
                          </span>
                          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-border text-gray-500 leading-none">
                            {item.subCategory}
                          </span>
                        </div>
                      </td>
                      <td className={clsx(
                        'px-3 py-2 text-right text-xs tabular-nums hidden sm:table-cell',
                        sortBy === 'day' ? `font-bold ${pctColor(item.dayPct)}` : pctColor(item.dayPct)
                      )}>
                        {fmtPct(item.dayPct)}
                      </td>
                      <td className={clsx(
                        'px-3 py-2 text-right text-xs tabular-nums',
                        sortBy === 'mtd' ? `font-bold ${pctColor(item.mtdPct)}` : pctColor(item.mtdPct)
                      )}>
                        {fmtPct(item.mtdPct)}
                      </td>
                      <td className={clsx(
                        'px-3 py-2 text-right text-xs tabular-nums',
                        sortBy === 'ytd' ? `font-bold ${pctColor(item.ytdPct)}` : pctColor(item.ytdPct)
                      )}>
                        {fmtPct(item.ytdPct)}
                      </td>
                      <td className={clsx(
                        'px-3 py-2 text-right text-xs tabular-nums hidden sm:table-cell',
                        sortBy === '5y' ? `font-bold ${pctColor(item.fiveYPct)}` : pctColor(item.fiveYPct)
                      )}>
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

      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-gray-400 font-medium">
            {selectedSymbols.size === 0
              ? 'Click rows to add assets to chart'
              : `${selectedSymbols.size} asset${selectedSymbols.size !== 1 ? 's' : ''} selected`}
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
