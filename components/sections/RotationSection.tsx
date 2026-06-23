'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { INDEXES, COMMODITIES, CRYPTO_IDS, SECTORS, CRYPTO_YAHOO_SYMBOLS } from '@/lib/config';
import { QuoteData, CryptoData } from '@/lib/types';
import { useGistData } from '@/lib/gist';
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
}

interface RollingReturn {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
}

type SortKey = 'day' | '1m' | '3m' | '6m' | '1y' | '5y';
type GroupFilter = 'all' | Group;
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
  Stocks:      '#f43f5e',
};

const PINS_KEY = 'rotation-pins-v1';

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

// 1Y-return percentile across the universe (1 = biggest 1Y gainer). A high percentile
// means the big move has largely already happened → late-stage, crowded, crash-prone.
// A low percentile on an accelerating asset = the run is still young (the sweet spot).
function buildExtensionPctile(items: RotationItem[]): Map<string, number> {
  const withData = items.filter(i => i.r1y != null);
  const sorted = [...withData].sort((a, b) => (a.r1y ?? 0) - (b.r1y ?? 0));
  const n = sorted.length;
  const out = new Map<string, number>();
  sorted.forEach((it, i) => out.set(it.symbol, n > 1 ? i / (n - 1) : 0));
  return out;
}

function buildRankDeltas(items: RotationItem[]): Map<string, number> {
  const withData = items.filter(i => i.r1m != null && i.r3m != null);
  const by3m = [...withData].sort((a, b) => (b.r3m ?? -Infinity) - (a.r3m ?? -Infinity));
  const by1m = [...withData].sort((a, b) => (b.r1m ?? -Infinity) - (a.r1m ?? -Infinity));
  const rank3m = new Map(by3m.map((it, i) => [it.symbol, i]));
  const rank1m = new Map(by1m.map((it, i) => [it.symbol, i]));
  const out = new Map<string, number>();
  for (const it of withData) {
    // positive delta = better 1M rank than 3M rank → accelerating
    out.set(it.symbol, (rank3m.get(it.symbol) ?? 0) - (rank1m.get(it.symbol) ?? 0));
  }
  return out;
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

  // The full working set = config universe + the selected stock list. Stocks are
  // fully ranked alongside everything else (rank-delta, accelerating, sorting).
  const rows = useMemo(() => [...items, ...stockItems], [items, stockItems]);

  // Rank deltas computed across ALL rows (not just filtered) so the signal is global
  const rankDeltas = rollingLoading ? new Map<string, number>() : buildRankDeltas(rows);

  const groupFiltered = groupFilter === 'all'
    ? rows
    : rows.filter(i => i.group === groupFilter);

  // Top-third 1M return across all assets — momentum floor. Stricter than the median so
  // flat bonds that creep up a percent or two can't qualify as "movers".
  const r1mSorted = rows.map(i => i.r1m).filter((v): v is number => v != null).sort((a, b) => a - b);
  const topThirdR1m = r1mSorted.length ? r1mSorted[Math.floor(r1mSorted.length * 2 / 3)] : 0;

  // Extension: how far an asset already is into its 1Y move. Top 20% = "already ran".
  const extPctile = rollingLoading ? new Map<string, number>() : buildExtensionPctile(rows);
  const EXTENDED_CUTOFF = 0.8;

  // "Accelerating" = climbing the leaderboard (rank-delta ≥4) AND a genuine, confirmed
  // up-move. The quality gates drop flat assets — e.g. bonds bouncing from −1% to +2% —
  // that climb the ranking on noise alone:
  //   • r3m > 0      → the trend is confirmed over 3 months, not a one-month blip
  //   • r1m top-third → it's a real mover now, not a sleepy +1/2%
  const accelBase = groupFiltered.filter(i =>
    (rankDeltas.get(i.symbol) ?? -Infinity) >= 4 &&
    i.r1m != null && i.r1m > 0 && i.r1m >= topThirdR1m &&
    i.r3m != null && i.r3m > 0
  );
  // Extension guard: drop names already in the top 20% of 1Y gains — the move is mature
  // and crowded there, exactly the "buy the top then it crashes" trap to avoid.
  const accelEarly = accelBase.filter(i => (extPctile.get(i.symbol) ?? 0) < EXTENDED_CUTOFF);
  const hiddenExtended = accelBase.length - accelEarly.length;

  let filteredItems = accelOnly ? accelEarly : groupFiltered;
  if (pinnedOnly) filteredItems = filteredItems.filter(i => pins.has(i.symbol));

  const sortedItems = accelOnly
    ? [...filteredItems].sort((a, b) =>
        (rankDeltas.get(b.symbol) ?? -Infinity) - (rankDeltas.get(a.symbol) ?? -Infinity)
      )
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

  // Snapshot fed to the sentiment endpoint — the live leaderboard as it stands now.
  const buildSnapshot = (): SentimentSnapshot => {
    const withData = rows.filter(i => i.r3m != null);
    const byR3m = [...withData].sort((a, b) => (b.r3m ?? -Infinity) - (a.r3m ?? -Infinity));
    const mover = (i: RotationItem) => ({ name: i.name, group: i.group, r1m: i.r1m, r3m: i.r3m, r1y: i.r1y });
    const lvl = (sym: string) => rows.find(i => i.symbol === sym)?.price ?? null;
    const accelByGroup = new Map<Group, string[]>();
    for (const i of accelEarly) {
      const arr = accelByGroup.get(i.group) ?? [];
      arr.push(i.name);
      accelByGroup.set(i.group, arr);
    }
    // Per-asset-class breakdown so the model can comment on each one specifically.
    const GROUP_ORDER: Group[] = ['Indexes', 'Crypto', 'Commodities', 'Sectors', 'Stocks'];
    const byGroup = GROUP_ORDER.map(g => {
      const inGroup = byR3m.filter(i => i.group === g);
      if (inGroup.length === 0) return null;
      return {
        group: g,
        leaders: inGroup.slice(0, 4).map(mover),
        laggards: inGroup.length > 4 ? inGroup.slice(-2).reverse().map(mover) : [],
        accelerating: accelByGroup.get(g) ?? [],
      };
    }).filter((g): g is NonNullable<typeof g> => g !== null);
    return {
      date: new Date().toISOString().slice(0, 10),
      leaders: byR3m.slice(0, 8).map(mover),
      laggards: byR3m.slice(-5).reverse().map(mover),
      accelerating: accelEarly.map(i => ({ name: i.name, group: i.group })),
      byGroup,
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
      <SentimentPanel buildSnapshot={buildSnapshot} ready={!rollingLoading} />

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
            <span className="font-semibold">Early-stage rotation</span> — assets climbing the 1M ranking vs 3M with above-median momentum, whose 1-year run is <span className="font-semibold">not yet extended</span>. The spot to look before the move is obvious.
          </p>
          {hiddenExtended > 0 && (
            <p className="text-[11px] text-amber-400/80">
              ⚠️ {hiddenExtended} accelerating name{hiddenExtended !== 1 ? 's' : ''} hidden as already extended (top 20% of 1-yr gains — the move is mature and crowded there).
            </p>
          )}
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
                {sortedItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-xs text-gray-500">
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
                  const accel      = accelArrow(rankDeltas.get(item.symbol) ?? null);
                  // In accel mode, flag the freshest names: still in the bottom half of
                  // 1Y gains, so the run is genuinely young, not a late blow-off.
                  const isFresh    = accelOnly && (extPctile.get(item.symbol) ?? 1) < 0.5;
                  // Rebound vs trend: if the acceleration sits on a deeply negative 6M or
                  // 1Y base, it's a bounce off oversold (riskier) rather than a confirmed
                  // uptrend. Solid = up across every horizon.
                  const isRebound  = accelOnly &&
                    ((item.r6m != null && item.r6m < 0) || (item.r1y != null && item.r1y < 0));
                  const isSolid    = accelOnly && !isRebound &&
                    item.r6m != null && item.r6m > 0 && item.r1y != null && item.r1y > 0;
                  const isPinned   = pins.has(item.symbol);
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
