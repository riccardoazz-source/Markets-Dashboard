'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { INDEXES, COMMODITIES, CRYPTO_IDS, SECTORS, CRYPTO_YAHOO_SYMBOLS } from '@/lib/config';
import { QuoteData, CryptoData } from '@/lib/types';
import { useGistData } from '@/lib/gist';
import { scoreRotation, ScoredItem } from '@/lib/rotationModel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RotationChart, ChartAsset } from '@/components/charts/RotationChart';
import { BacktestPanel } from '@/components/sections/BacktestPanel';
import { SentimentPanel, SentimentSnapshot } from '@/components/sections/SentimentPanel';

type Group = 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors' | 'Stocks';

interface RotationItem {
  symbol: string;
  name: string;
  subCategory: string;
  group: Group;
  price: number | null;
  currency: string;
  dayPct: number | null;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  fiveYPct: number | null;
  ma200: number | null;    // 200-day SMA (from rotation-returns)
  sma200w: number | null;  // 200-week SMA (from quotes/crypto/sectors)
  volRatio: number | null; // latestVol / avg20dVol (from rotation-returns)
}

interface RollingReturn {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  ma200: number | null;
  volRatio: number | null;
}

type SortKey = 'day' | '1m' | '3m' | '6m' | '1y' | '5y' | '200d' | '200w';
type GroupFilter = 'all' | Group;
type ChartTimeframe = '1M' | '3M' | '6M' | '1Y';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'day',  label: 'Day'  },
  { value: '1m',   label: '1M'   },
  { value: '3m',   label: '3M'   },
  { value: '6m',   label: '6M'   },
  { value: '1y',   label: '1Y'   },
  { value: '5y',   label: '5Y'   },
  { value: '200d', label: '200D' },
  { value: '200w', label: '200W' },
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
  Stocks:      '#f43f5e',
};

const PINS_KEY = 'rotation-pins-v1';

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#a855f7',
];

// % gap between current price and a moving average (positive = price above MA).
function vsMa(price: number | null, ma: number | null): number | null {
  if (price == null || ma == null || ma === 0) return null;
  return (price / ma - 1) * 100;
}

function getPct(item: RotationItem, key: SortKey): number | null {
  switch (key) {
    case 'day':  return item.dayPct;
    case '1m':   return item.r1m;
    case '3m':   return item.r3m;
    case '6m':   return item.r6m;
    case '1y':   return item.r1y;
    case '5y':   return item.fiveYPct;
    case '200d': return vsMa(item.price, item.ma200);
    case '200w': return vsMa(item.price, item.sma200w);
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

// Rank delta: positive = asset moved UP in the 1M ranking vs 3M ranking.
// Computed after sorting all items by each metric, so this is called at render time.
function accelArrow(rankDelta: number | null): { arrow: string; color: string } | null {
  if (rankDelta == null) return null;
  if (rankDelta >= 12) return { arrow: '↑↑', color: 'text-green-300' };
  if (rankDelta >= 4)  return { arrow: '↑',  color: 'text-green-500' };
  if (rankDelta <= -12)return { arrow: '↓↓', color: 'text-red-300'   };
  if (rankDelta <= -4) return { arrow: '↓',  color: 'text-red-500'   };
  return                      { arrow: '→',  color: 'text-gray-500'  };
}


export function RotationSection() {
  const [items, setItems] = useState<RotationItem[]>([]);
  const [rollingLoading, setRollingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('3m');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [accelOnly, setAccelOnly] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('3M');
  const userHasToggled = useRef(false);

  // Pinned assets — durable "remember to check" list, saved to the gist database
  // (synced across devices) just like notes and sentiment history.
  const { data: gistData, update: updateGist } = useGistData();
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const pins = useMemo(() => new Set(gistData.pins ?? []), [gistData.pins]);

  const [stockList, setStockList] = useState<string | null>(null);
  const [stockItems, setStockItems] = useState<RotationItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  // One-time migration: lift any pins that lived only in localStorage into the gist.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      if (!raw) return;
      const local = JSON.parse(raw) as string[];
      if (local.length && !(gistData.pins && gistData.pins.length)) {
        updateGist({ pins: local });
      }
      localStorage.removeItem(PINS_KEY);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gistData.pins]);

  const togglePin = (symbol: string) => {
    const next = new Set(pins);
    if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
    updateGist({ pins: [...next] });
  };

  // Stock watchlists = note categories on `stock:SYM` chart IDs (same source the
  // Stocks tab uses). New lists/stocks added there appear here automatically.
  const stockLists = useMemo(() => {
    const notes = gistData.notes ?? {};
    const cats = new Set<string>();
    for (const [chartId, list] of Object.entries(notes)) {
      if (!chartId.startsWith('stock:')) continue;
      list.forEach(n => { if (n.category) cats.add(n.category); });
    }
    return Array.from(cats).sort();
  }, [gistData]);

  const stockListSymbols = useMemo(() => {
    if (!stockList) return [];
    const notes = gistData.notes ?? {};
    const syms: string[] = [];
    for (const [chartId, list] of Object.entries(notes)) {
      if (!chartId.startsWith('stock:')) continue;
      if (list.some(n => n.category?.toLowerCase() === stockList.toLowerCase())) {
        syms.push(chartId.slice('stock:'.length));
      }
    }
    return syms;
  }, [gistData, stockList]);

  // Fetch quotes + rolling returns for the selected stock list and build items.
  useEffect(() => {
    if (!stockList || stockListSymbols.length === 0) { setStockItems([]); return; }
    let cancelled = false;
    setStockLoading(true);
    const symParam = encodeURIComponent(stockListSymbols.join(','));
    Promise.all([
      fetch(`/api/quotes?symbols=${symParam}`).then(r => r.json() as Promise<QuoteData[]>).catch(() => []),
      fetch(`/api/rotation-returns?extra=${symParam}`).then(r => r.json() as Promise<RollingReturn[]>).catch(() => []),
    ]).then(([quotes, rolling]) => {
      if (cancelled) return;
      const qMap = new Map<string, QuoteData>((quotes ?? []).map(q => [q.symbol, q]));
      const rMap = new Map<string, RollingReturn>((rolling ?? []).map(r => [r.symbol, r]));
      const built: RotationItem[] = stockListSymbols.map(sym => {
        const q = qMap.get(sym);
        const r = rMap.get(sym);
        return {
          symbol: sym, name: sym, subCategory: 'Stock', group: 'Stocks' as const,
          price: q?.price ?? null, currency: q?.currency ?? 'USD',
          dayPct: q?.changePercent ?? null,
          r1m: r?.r1m ?? null, r3m: r?.r3m ?? null, r6m: r?.r6m ?? null, r1y: r?.r1y ?? null,
          fiveYPct: q?.fiveYearChangePercent ?? null,
          ma200: r?.ma200 ?? null, sma200w: q?.sma200w ?? null, volRatio: r?.volRatio ?? null,
        };
      });
      setStockItems(built);
      setStockLoading(false);
    }).catch(() => { if (!cancelled) { setStockItems([]); setStockLoading(false); } });
    return () => { cancelled = true; };
  }, [stockList, stockListSymbols]);

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
            ma200: null, sma200w: q?.sma200w ?? null, volRatio: null,
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
            ma200: null, sma200w: q?.sma200w ?? null, volRatio: null,
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
            ma200: null, sma200w: c?.sma200w ?? null, volRatio: null,
          };
        });

        const sectorItems: RotationItem[] = sectors.map(s => ({
          symbol: s.symbol, name: s.name, subCategory: s.category, group: 'Sectors' as const,
          price: s.price, currency: s.currency ?? 'USD',
          dayPct: s.changePercent,
          r1m: null, r3m: null, r6m: null, r1y: null,
          fiveYPct: s.fiveYearReturn,
          ma200: null, sma200w: (s as { sma200w?: number | null }).sma200w ?? null, volRatio: null,
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
          return r ? { ...item, r1m: r.r1m, r3m: r.r3m, r6m: r.r6m, r1y: r.r1y, ma200: r.ma200, volRatio: r.volRatio } : item;
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

  // The full working set = config universe + the selected stock list. Stocks are
  // fully ranked alongside everything else (rank-delta, accelerating, sorting).
  const rows = useMemo(() => [...items, ...stockItems], [items, stockItems]);

  // Score all rows cross-sectionally (universe-wide percentiles, so group filter applied after)
  const scoreMap = useMemo<Map<string, ScoredItem<RotationItem>>>(() => {
    if (rollingLoading) return new Map();
    return new Map(scoreRotation(rows).map(s => [s.item.symbol, s]));
  }, [rows, rollingLoading]);

  const groupFiltered = groupFilter === 'all'
    ? rows
    : rows.filter(i => i.group === groupFilter);

  // Accelerating: pass sanity gates (r1m>0, r3m>0), ranked by composite RotationScore
  const accelItems = useMemo(() => {
    if (rollingLoading) return [];
    return groupFiltered
      .map(i => scoreMap.get(i.symbol))
      .filter((s): s is ScoredItem<RotationItem> => s != null && s.passesGate)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item);
  }, [groupFiltered, scoreMap, rollingLoading]);

  let filteredItems = accelOnly ? accelItems : groupFiltered;
  if (pinnedOnly) filteredItems = filteredItems.filter(i => pins.has(i.symbol));

  const sortedItems = accelOnly
    ? filteredItems // already sorted by score above
    : [...filteredItems].sort((a, b) =>
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
      const item = rows.find(i => i.symbol === sym);
      return item ? { symbol: sym, name: item.name, color: colorMap.get(sym) ?? '#3b82f6' } : null;
    })
    .filter((a): a is ChartAsset => a !== null);

  // When the user hits Refresh on the sentiment panel, snap the table back to the
  // canonical view (All classes, sorted by today's move) so what they see equals
  // what Gemini is fed.
  const resetTableForSentiment = () => {
    userHasToggled.current = true;
    setAccelOnly(false);
    setPinnedOnly(false);
    setGroupFilter('all');
    setSortBy('day');
  };

  // Snapshot fed to the sentiment endpoint — the ENTIRE on-screen table, so Gemini
  // reads exactly what the user sees and reasons over it itself.
  const buildSnapshot = (): SentimentSnapshot => {
    const mover = (i: RotationItem) => ({
      name: i.name, group: i.group, dayPct: i.dayPct,
      r1m: i.r1m, r3m: i.r3m, r6m: i.r6m, r1y: i.r1y,
    });
    const lvl = (sym: string) => rows.find(i => i.symbol === sym)?.price ?? null;
    return {
      date: new Date().toISOString().slice(0, 10),
      table: rows.map(mover),
      accelerating: accelItems.map(i => ({ name: i.name, group: i.group })),
      levels: {
        'S&P 500': lvl('^GSPC'),
        Gold: lvl('GC=F'),
        'WTI Crude': lvl('CL=F'),
        Bitcoin: lvl('BTC-USD'),
      },
    };
  };

  return (
    <div className="space-y-4">
      {/* Daily sentiment */}
      <SentimentPanel buildSnapshot={buildSnapshot} ready={!rollingLoading} onBeforeRun={resetTableForSentiment} />

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAccelOnly(v => !v)}
            disabled={rollingLoading}
            className={clsx(
              'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border',
              accelOnly
                ? 'bg-green-500/15 border-green-500/50 text-green-300'
                : 'bg-bg-input border-border text-gray-400 hover:text-gray-100 hover:border-gray-600',
              rollingLoading && 'opacity-40 cursor-not-allowed'
            )}
            title="Show only assets climbing the leaderboard — the potential next Kospi"
          >
            🚀 Accelerating
          </button>
          <button
            onClick={() => setPinnedOnly(v => !v)}
            disabled={pins.size === 0}
            className={clsx(
              'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border flex items-center gap-1',
              pinnedOnly
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-bg-input border-border text-gray-400 hover:text-gray-100 hover:border-gray-600',
              pins.size === 0 && 'opacity-40 cursor-not-allowed'
            )}
            title="Show only your pinned assets"
          >
            <Star size={12} className={pinnedOnly ? 'fill-amber-300' : ''} />
            Pinned{pins.size > 0 ? ` (${pins.size})` : ''}
          </button>
          <div className={clsx('flex gap-1 bg-bg-input rounded-lg p-1', accelOnly && 'opacity-40 pointer-events-none')}>
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
        </div>
        <div className="flex gap-1 bg-bg-input rounded-lg p-1 flex-wrap">
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
          {stockItems.length > 0 && (
            <button
              onClick={() => setGroupFilter('Stocks')}
              className={clsx(
                'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                groupFilter === 'Stocks'
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-border'
              )}
            >
              Stocks
            </button>
          )}
        </div>
      </div>

      {/* Stock list selector — pick one of your saved Stocks watchlists to rank here */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">Add a stock list:</span>
        {stockLists.length === 0 ? (
          <span className="text-[11px] text-gray-600 italic">
            None yet — save stocks into a list from the Stocks tab (add a note with a category).
          </span>
        ) : (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setStockList(null)}
              className={clsx('px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all',
                stockList === null ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-gray-500 hover:text-gray-300')}
            >
              None
            </button>
            {stockLists.map(cat => (
              <button
                key={cat}
                onClick={() => setStockList(cat)}
                className={clsx('px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all',
                  stockList === cat ? 'border-rose-400/60 text-rose-300 bg-rose-400/10' : 'border-border text-gray-500 hover:text-gray-300')}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
        {stockLoading && <LoadingSpinner size={12} />}
      </div>

      {/* Rolling returns loading badge */}
      {!loading && rollingLoading && (
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <LoadingSpinner size={12} />
          <span>Computing rolling returns…</span>
        </div>
      )}

      {/* Accelerating mode explainer */}
      {accelOnly && !rollingLoading && (
        <div className="space-y-1">
          <p className="text-[11px] text-green-400/80">
            <span className="font-semibold">Early-stage rotation</span> — scored by acceleration (1M vs 3M leaderboard climb), trend strength, structural regime, and volume. Extension is a soft penalty, not a hard gate.
          </p>
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
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden xl:table-cell', sortBy === '200d' ? 'text-accent' : 'text-gray-600')} title="% gap from 200-day MA (green=above, red=below)">vs 200D</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden xl:table-cell', sortBy === '200w' ? 'text-accent' : 'text-gray-600')} title="% gap from 200-week MA (green=above, red=below)">vs 200W</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-xs text-gray-500">
                      {accelOnly
                        ? 'No assets are accelerating right now — the leaderboard is stable.'
                        : pinnedOnly
                          ? 'No pinned assets in this view — tap the ☆ on a row to pin it.'
                          : 'No assets match this filter.'}
                    </td>
                  </tr>
                )}
                {sortedItems.map((item, idx) => {
                  const isSelected = selectedSymbols.has(item.symbol);
                  const dotColor   = GROUP_COLORS[item.group];
                  const rowColor   = colorMap.get(item.symbol);
                  const scored     = scoreMap.get(item.symbol);
                  const accel      = accelArrow(scored?.rankDelta ?? null);
                  // Flag names in the bottom half of 1Y extension: the run is still young.
                  const isFresh    = accelOnly && (scored?.accPctile ?? 0) > 0.7 && (item.r1y == null || item.r1y < 30);
                  // Rebound vs trend: if the acceleration sits on a deeply negative 6M or
                  // 1Y base, it's a bounce off oversold (riskier) rather than a confirmed
                  // uptrend. Solid = up across every horizon.
                  const isRebound  = accelOnly &&
                    ((item.r6m != null && item.r6m < 0) || (item.r1y != null && item.r1y < 0));
                  const isSolid    = accelOnly && !isRebound &&
                    item.r6m != null && item.r6m > 0 && item.r1y != null && item.r1y > 0;
                  // Above 200W = structural long-term bull (mega-cycle confirmed).
                  const above200w  = item.price != null && item.sma200w != null && item.price > item.sma200w;
                  const isPinned   = pins.has(item.symbol);
                  const vs200d     = vsMa(item.price, item.ma200);
                  const vs200w     = vsMa(item.price, item.sma200w);
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
                          {isFresh && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-green-500/15 text-green-300 leading-none" title="Run still young — bottom half of 1-year gains">
                              🌱 early
                            </span>
                          )}
                          {isRebound && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 leading-none" title="Accelerating off a negative 6M/1Y base — a bounce off oversold, riskier than a confirmed trend">
                              ↩ rebound
                            </span>
                          )}
                          {isSolid && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-300 leading-none" title="Up across every horizon — a confirmed trend, not just a bounce">
                              ✓ trend
                            </span>
                          )}
                          {above200w && !rollingLoading && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 leading-none" title="Price above 200-week MA — structural long-term bull">
                              🐂 200W
                            </span>
                          )}
                          {accel && !rollingLoading && (
                            <span className={clsx('shrink-0 text-[10px] font-bold leading-none', accel.color)}>
                              {accel.arrow}
                            </span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePin(item.symbol); }}
                            className={clsx('shrink-0 ml-auto p-0.5 rounded transition-colors',
                              isPinned ? 'text-amber-300' : 'text-gray-700 hover:text-gray-400')}
                            title={isPinned ? 'Unpin' : 'Pin to remember'}
                          >
                            <Star size={12} className={isPinned ? 'fill-amber-300' : ''} />
                          </button>
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
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums hidden xl:table-cell', sortBy === '200d' ? `font-bold ${pctColor(vs200d)}` : pctColor(vs200d))}
                          title={item.ma200 != null ? `200D MA: ${item.ma200.toFixed(2)}` : undefined}>
                        {rollingLoading ? <span className="text-gray-700">…</span> : fmtPct(vs200d)}
                      </td>
                      <td className={clsx('px-3 py-2 text-right text-xs tabular-nums hidden xl:table-cell', sortBy === '200w' ? `font-bold ${pctColor(vs200w)}` : pctColor(vs200w))}
                          title={item.sma200w != null ? `200W MA: ${item.sma200w.toFixed(2)}` : undefined}>
                        {rollingLoading ? <span className="text-gray-700">…</span> : fmtPct(vs200w)}
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

      {/* Backtest — time machine */}
      <BacktestPanel />
    </div>
  );
}
