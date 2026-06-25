'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { INDEXES, COMMODITIES, CRYPTO_IDS, SECTORS, CRYPTO_YAHOO_SYMBOLS, assetNavTarget } from '@/lib/config';
import { QuoteData, CryptoData } from '@/lib/types';
import { useGistData, QuadrantPoint } from '@/lib/gist';
import { scoreRotation, selectPicks, ScoredItem, MODEL_WEIGHTS, PRE_BREAKOUT_SLOTS, PRE_BREAKOUT_POS52W_MIN, PRE_BREAKOUT_R1M_FLOOR } from '@/lib/rotationModel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { QuadrantChart, QuadrantAsset } from '@/components/charts/QuadrantChart';
import { BacktestPanel } from '@/components/sections/BacktestPanel';
import { SentimentPanel, SentimentSnapshot } from '@/components/sections/SentimentPanel';

type Group = 'Indexes' | 'Crypto' | 'Commodities' | 'Sectors' | 'Stocks';

interface RotationItem {
  symbol: string;
  name: string;
  subCategory: string;
  group: Group;
  price: number | null;      // live intraday price (display only)
  lastClose: number | null;  // most recent daily close (used for regime gate — matches backtest)
  currency: string;
  dayPct: number | null;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  fiveYPct: number | null;
  ma200: number | null;    // 200-day SMA (from rotation-returns)
  vol: number | null;      // realized monthly volatility % (from rotation-returns)
  volEdge: number | null;  // net upside volatility %/month (from rotation-returns; VQ signal)
  sma200w: number | null;  // 200-week SMA (from quotes/crypto/sectors)
  volRatio: number | null; // latestVol / avg20dVol (from rotation-returns)
  high52w: number | null;  // 52-week high (from rotation-returns)
  low52w: number | null;   // 52-week low (from rotation-returns)
  pos52wRaw: number | null;// route-computed 52W range position (fallback)
  trendR2: number | null;  // 0–1 trailing ~6mo trend smoothness (from rotation-returns; LEAD signal)
  trendR2Long: number | null; // 0–1 ~12mo trend persistence (from rotation-returns; CYC signal)
  rsi: number | null;      // Wilder 14-day RSI (from rotation-returns; M8 overheat guard)
  macdHist: number | null; // MACD histogram %/price (from rotation-returns; M8 confirmation)
  pos52w?: number | null;  // resolved 0–100 range position fed to the model (set at scoring time)
}

interface RollingReturn {
  symbol: string;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  ma200: number | null;
  vol: number | null;
  volEdge: number | null;
  volRatio: number | null;
  high52w: number | null;
  low52w: number | null;
  pos52w: number | null;
  trendR2: number | null;
  trendR2Long: number | null;
  rsi: number | null;
  macdHist: number | null;
  lastClose: number | null;
}

type SortKey = 'day' | '1m' | '3m' | '6m' | '1y' | '5y' | '200d' | '200w' | '52w';
type GroupFilter = 'all' | Group;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'day',  label: 'Day'  },
  { value: '1m',   label: '1M'   },
  { value: '3m',   label: '3M'   },
  { value: '6m',   label: '6M'   },
  { value: '1y',   label: '1Y'   },
  { value: '5y',   label: '5Y'   },
  { value: '52w',  label: '52W'  },
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

const PINS_KEY = 'rotation-pins-v1';

// % gap between current price and a moving average (positive = price above MA).
function vsMa(price: number | null, ma: number | null): number | null {
  if (price == null || ma == null || ma === 0) return null;
  return (price / ma - 1) * 100;
}

// Position of the current price within the 52-week range: 0% = on the 52W low,
// 100% = on the 52W high. Computed live from the latest price when high/low are
// known (so it tracks intraday), falling back to the route-computed value.
function pos52w(item: RotationItem): number | null {
  const { price, high52w, low52w, pos52wRaw } = item;
  if (price != null && high52w != null && low52w != null && high52w > low52w) {
    return Math.max(0, Math.min(100, ((price - low52w) / (high52w - low52w)) * 100));
  }
  return pos52wRaw;
}

function getPct(item: RotationItem, key: SortKey): number | null {
  switch (key) {
    case 'day':  return item.dayPct;
    case '1m':   return item.r1m;
    case '3m':   return item.r3m;
    case '6m':   return item.r6m;
    case '1y':   return item.r1y;
    case '5y':   return item.fiveYPct;
    case '52w':  return pos52w(item);
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

// Acceleration arrow from the asset's acceleration percentile (0..1): how strongly
// it is speeding up relative to the universe right now.
function accelArrow(accPctile: number | null): { arrow: string; color: string } | null {
  if (accPctile == null) return null;
  if (accPctile >= 0.85) return { arrow: '↑↑', color: 'text-green-300' };
  if (accPctile >= 0.65) return { arrow: '↑',  color: 'text-green-500' };
  if (accPctile <= 0.15) return { arrow: '↓↓', color: 'text-red-300'   };
  if (accPctile <= 0.35) return { arrow: '↓',  color: 'text-red-500'   };
  return                       { arrow: '→',  color: 'text-gray-500'  };
}

// Collapsible legend: explains every badge AND prints the live model formula.
// The formula weights come straight from MODEL_WEIGHTS, so this can never drift
// from the actual calculation in lib/rotationModel.ts.
function RotationLegend() {
  const W = MODEL_WEIGHTS;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <details className="rounded-lg border border-border bg-bg-input/40 text-[11px]">
      <summary className="cursor-pointer select-none px-3 py-2 text-gray-300 font-medium hover:text-gray-100">
        Legend &amp; model formula
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3 text-gray-400">
        <div>
          <p className="text-gray-300 font-semibold mb-1">Badges</p>
          <ul className="space-y-1">
            <li><span className="inline-block w-2 h-2 rounded-full bg-blue-500 align-middle mr-1.5" />Coloured dot = asset class (Indexes blue · Crypto orange · Commodities amber · Sectors purple · Stocks pink)</li>
            <li><span className="text-green-300">🌱 early</span> — strong acceleration and the 1-year run is still small: caught early, before the crowd</li>
            <li><span className="text-amber-300">↩ rebound</span> — accelerating off a negative 6M/1Y base: a bounce off oversold, riskier than a confirmed trend</li>
            <li><span className="text-blue-300">✓ trend</span> — up across every horizon (3M, 6M, 1Y all positive): a confirmed uptrend</li>
            <li><span className="text-emerald-300">🐂 200W</span> — price above its 200-week moving average: structural long-term bull (display only — not in the score)</li>
            <li><span className="text-green-400 font-bold">↑↑ ↑ → ↓ ↓↓</span> — acceleration: how strongly the asset is speeding up (pace ladder: last month vs quarter vs half-year) relative to the universe</li>
            <li><span className="text-amber-300">★</span> — pinned (saved to your database)</li>
          </ul>
        </div>
        <div>
          <p className="text-gray-300 font-semibold mb-1">RotationScore — how &quot;Accelerating&quot; is ranked</p>
          <p className="mb-1.5">Each input is a cross-sectional percentile vs the whole universe (0–1). The list shows <span className="text-gray-200">every name that clears the gate</span>, ranked by score — the count is whatever the market warrants, not a fixed number.</p>
          <pre className="font-mono text-[10.5px] leading-relaxed text-gray-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre">
{`3-horizon pace ladder (geometric monthly pace at each horizon):
  p1  = r1m
  p3  = ((1+r3m/100)^(1/3) − 1)·100
  p6  = ((1+r6m/100)^(1/6) − 1)·100
  p1y = ((1+r1y/100)^(1/12) − 1)·100

  aRecent = p1 − p3         (last month faster than the quarter?)
  aBuild  = p3 − p6         (quarter faster than the half-year? → BUILDING)
  aLong   = p6 − p1y        (half-year vs annual → only the NEGATIVE side counts)
  ACCEL   = 0.55·aRecent + 0.35·aBuild + 0.20·min(0, aLong)
            (2-horizon fallback 0.60/0.40 when r1y unavailable)

VQ = net upside volatility — the "good volatility" engine (M6):
  upRms   = √mean(r² on UP days)      downRms = √mean(r² on DOWN days)
  volEdge = (upRms − downRms)·√21·100     VQ = pctile(volEdge)
  HIGH = upside-dominated mover (capacity for big moves: NVDA, MU)
  ~0   = low-vol bond (capped) OR symmetric churner ·  <0 = downside-heavy
  (replaces the old Sharpe term, which divided by vol → picked smooth LOSERS)

TRD = raw durable momentum:  0.60 · p3m  +  0.40 · p6m   (percentile ranks)

CYC = pctile( trendR2 over ~12 months )   secular vs cyclical:
  HIGH = a compounder marching up for a year+ (NVDA)
  LOW  = a flat/choppy base with a recent vertical spike (oil on a war) → demoted

Over-extension guard — EXT = max of two signals:
  STRETCH = max(0, price/MA200 − 1)·100 / monthlyVol   (σ above MA200)
  R1M_ABS = cross-sectional percentile of |r1m|
  EXT     = max(STRETCH_pctile, R1M_ABS_pctile)

Score = ${pct(W.acceleration)} · ACC   (3-horizon acceleration percentile — an asset isn't a winner if it doesn't accelerate)
      + ${pct(W.volQuality)} · VQ   (net upside volatility — the engine of big returns)
      + ${pct(W.trend)} · TRD   (raw 3M/6M momentum)
      + ${pct(W.cycle)} · CYC   (12-month trend persistence — secular, not cyclical)
      + ${pct(W.lead)} · LEAD  (52w-high position + 6mo trend smoothness)
      + ${pct(W.regime)} · REG   (graduated percentile of price vs 200-day MA)
      + ${pct(W.volume)} · VOL   (volume: latestVol/avg20dVol percentile; null→neutral)
      − wEXT · EXT   (over-extension; wEXT = 20% · commodities 32%)

Gate:  r1m > 0  AND  r3m > 0  AND  aRecent > 0  AND  r1m < cap
       AND  price ≥ 200-day MA   (regime confirmation — uses daily close, matches backtest)
       (cap = 50% · commodities 25%)
       aBuild / aLong: ranking signals, not gate blockers

Pre-breakout sleeve (M7) — ${PRE_BREAKOUT_SLOTS} reserved "coiled spring" slots 🔒:
  r1y > 0  AND  pos52w ≥ ${PRE_BREAKOUT_POS52W_MIN}  AND  price ≥ 200-day MA  AND  r1m > ${PRE_BREAKOUT_R1M_FLOOR}%
  → a year-long uptrend basing near its 52w high, last month flat/down so it
    FAILS the momentum gate. Catches the next-leg winners (semis pre-AI-run) the
    pure-acceleration gate would reject. Commodities excluded (their high bases
    are cyclical tops). Ranked by 52w-high closeness + secular trend + upside vol.`}
          </pre>
          <p className="mt-1.5 text-gray-500"><span className="text-gray-300">Regime confirmation</span>: a pick must trade at/above its 200-day MA — this filters low-quality momentum pops that flash up while still below trend (and then revert), while keeping genuine rebounds that have reclaimed the MA. aLong is a <span className="text-gray-300">brake, not a booster</span>: a maturing trend (1Y pace &gt; 6M pace → aLong&lt;0) is demoted, but a dormant asset that just popped gets no bonus. EXT catches two blow-off types: price stretched above MA200 AND extreme recent 1M magnitude. <span className="text-gray-300">Commodities mean-revert harder</span> — event spikes (Iran war → Brent/WTI, fear → Silver/Gold) get bought then crash — so they carry a heavier EXT weight (32%) and a tighter 1M cap (25%). VOL rewards breakouts on elevated volume (backtest-neutral when volume history is unavailable). Every input is point-in-time, so the backtest stays honest.</p>
        </div>
      </div>
    </details>
  );
}


export function RotationSection({ onNavigate }: { onNavigate?: (section: string, symbol: string) => void }) {
  const [items, setItems] = useState<RotationItem[]>([]);
  const [rollingLoading, setRollingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('3m');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [accelOnly, setAccelOnly] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const userHasToggled = useRef(false);

  // Pinned assets — durable "remember to check" list, saved to the gist database
  // (synced across devices) just like notes and sentiment history.
  const { data: gistData, update: updateGist } = useGistData();
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const pins = useMemo(() => new Set(gistData.pins ?? []), [gistData.pins]);

  // Active stock watchlists are persisted to the gist (like pins) so the
  // selection survives reloads and syncs across every device.
  const activeStockLists = useMemo(() => gistData.rotationStockLists ?? [], [gistData.rotationStockLists]);
  const setActiveStockLists = (next: string[]) => updateGist({ rotationStockLists: next });
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
    if (activeStockLists.length === 0) return [];
    const notes = gistData.notes ?? {};
    const activeLower = activeStockLists.map(l => l.toLowerCase());
    const syms: string[] = [];
    for (const [chartId, list] of Object.entries(notes)) {
      if (!chartId.startsWith('stock:')) continue;
      if (list.some(n => n.category && activeLower.includes(n.category.toLowerCase()))) {
        const sym = chartId.slice('stock:'.length);
        if (!syms.includes(sym)) syms.push(sym);
      }
    }
    return syms;
  }, [gistData, activeStockLists]);

  // Fetch quotes + rolling returns for the selected stock lists and build items.
  useEffect(() => {
    if (activeStockLists.length === 0 || stockListSymbols.length === 0) { setStockItems([]); return; }
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
          price: q?.price ?? null, lastClose: r?.lastClose ?? null, currency: q?.currency ?? 'USD',
          dayPct: q?.changePercent ?? null,
          r1m: r?.r1m ?? null, r3m: r?.r3m ?? null, r6m: r?.r6m ?? null, r1y: r?.r1y ?? null,
          fiveYPct: q?.fiveYearChangePercent ?? null,
          ma200: r?.ma200 ?? null, vol: r?.vol ?? null, volEdge: r?.volEdge ?? null, sma200w: q?.sma200w ?? null, volRatio: r?.volRatio ?? null,
          high52w: r?.high52w ?? q?.high52w ?? null, low52w: r?.low52w ?? q?.low52w ?? null, pos52wRaw: r?.pos52w ?? null,
          trendR2: r?.trendR2 ?? null, trendR2Long: r?.trendR2Long ?? null, rsi: r?.rsi ?? null, macdHist: r?.macdHist ?? null,
        };
      });
      setStockItems(built);
      setStockLoading(false);
    }).catch(() => { if (!cancelled) { setStockItems([]); setStockLoading(false); } });
    return () => { cancelled = true; };
  }, [activeStockLists, stockListSymbols]);

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
            price: q?.price ?? null, lastClose: null, currency: q?.currency ?? 'USD',
            dayPct: q?.changePercent ?? null,
            r1m: null, r3m: null, r6m: null, r1y: null,
            fiveYPct: q?.fiveYearChangePercent ?? null,
            ma200: null, vol: null, volEdge: null, sma200w: q?.sma200w ?? null, volRatio: null,
            high52w: q?.high52w ?? null, low52w: q?.low52w ?? null, pos52wRaw: null,
            trendR2: null, trendR2Long: null, rsi: null, macdHist: null,
          };
        });

        const commItems: RotationItem[] = COMMODITIES.map(c => {
          const q = quoteMap.get(c.symbol);
          return {
            symbol: c.symbol, name: c.name, subCategory: c.category, group: 'Commodities',
            price: q?.price ?? null, lastClose: null, currency: q?.currency ?? 'USD',
            dayPct: q?.changePercent ?? null,
            r1m: null, r3m: null, r6m: null, r1y: null,
            fiveYPct: q?.fiveYearChangePercent ?? null,
            ma200: null, vol: null, volEdge: null, sma200w: q?.sma200w ?? null, volRatio: null,
            high52w: q?.high52w ?? null, low52w: q?.low52w ?? null, pos52wRaw: null,
            trendR2: null, trendR2Long: null, rsi: null, macdHist: null,
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
            price: c?.price ?? null, lastClose: null, currency: 'USD',
            dayPct: c?.change24hPercent ?? null,
            r1m: null, r3m: null, r6m: null, r1y: null,
            fiveYPct: c?.fiveYearChangePercent ?? null,
            ma200: null, vol: null, volEdge: null, sma200w: c?.sma200w ?? null, volRatio: null,
            high52w: null, low52w: null, pos52wRaw: null,
            trendR2: null, trendR2Long: null, rsi: null, macdHist: null,
          };
        });

        const sectorItems: RotationItem[] = sectors.map(s => ({
          symbol: s.symbol, name: s.name, subCategory: s.category, group: 'Sectors' as const,
          price: s.price, lastClose: null, currency: s.currency ?? 'USD',
          dayPct: s.changePercent,
          r1m: null, r3m: null, r6m: null, r1y: null,
          fiveYPct: s.fiveYearReturn,
          ma200: null, vol: null, volEdge: null, sma200w: (s as { sma200w?: number | null }).sma200w ?? null, volRatio: null,
          high52w: null, low52w: null, pos52wRaw: null,
          trendR2: null, trendR2Long: null, rsi: null, macdHist: null,
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
          return r ? {
            ...item,
            r1m: r.r1m, r3m: r.r3m, r6m: r.r6m, r1y: r.r1y, ma200: r.ma200, vol: r.vol, volEdge: r.volEdge ?? null, volRatio: r.volRatio,
            lastClose: r.lastClose ?? null,
            trendR2: r.trendR2 ?? null, trendR2Long: r.trendR2Long ?? null, rsi: r.rsi ?? null, macdHist: r.macdHist ?? null,
            // Prefer the uniform 52W range from history; keep any quote value as fallback.
            high52w: r.high52w ?? item.high52w, low52w: r.low52w ?? item.low52w, pos52wRaw: r.pos52w ?? item.pos52wRaw,
          } : item;
        });

        setItems(enriched);

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

  // Score all rows cross-sectionally (universe-wide percentiles, so group filter applied after).
  // Use lastClose (daily close from rotation-returns) as the price for the regime gate so it
  // matches the backtest — both use the same daily close, avoiding intraday divergence.
  const scoreMap = useMemo<Map<string, ScoredItem<RotationItem>>>(() => {
    if (rollingLoading) return new Map();
    const forScoring: RotationItem[] = rows.map(item => ({
      ...item,
      price: item.lastClose ?? item.price,
      // Resolve the 52W range position the model scores on (live price-based when
      // available, else the route value). trendR2 already rides along on the item.
      pos52w: pos52w(item),
    }));
    return new Map(scoreRotation(forScoring).map(s => [s.item.symbol, s]));
  }, [rows, rollingLoading]);

  const groupFiltered = groupFilter === 'all'
    ? rows
    : rows.filter(i => i.group === groupFilter);

  // Accelerating: momentum names that clear the gate (ranked by RotationScore)
  // PLUS a few reserved pre-breakout "coiled spring" slots (M7) — selectPicks()
  // is the SAME selector the backtest uses, so the live list and the backtest are
  // identical. The list is as long as the market warrants (few in a shock).
  const accelItems = useMemo(() => {
    if (rollingLoading) return [];
    const scored = groupFiltered
      .map(i => scoreMap.get(i.symbol))
      .filter((s): s is ScoredItem<RotationItem> => s != null);
    return selectPicks(scored).map(s => s.item);
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

  // Build quadrant chart data from the currently filtered view.
  const quadrantAssets = useMemo<QuadrantAsset[]>(() => {
    const accelSet = new Set(accelItems.map(i => i.symbol));
    const result: QuadrantAsset[] = [];
    for (const item of groupFiltered) {
      const s = scoreMap.get(item.symbol);
      if (!s || item.r3m == null) continue;
      result.push({
        symbol: item.symbol,
        name: item.name,
        group: item.group as string,
        r3m: item.r3m,
        accScore: Math.round(s.accPctile * 100),
        accel: s.accel,
        r1m: item.r1m,
        r1y: item.r1y,
        isAccel: accelSet.has(item.symbol),
        isSelected: selectedSymbols.has(item.symbol),
      });
    }
    return result;
  }, [groupFiltered, scoreMap, accelItems, selectedSymbols]);

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

  // Snapshot of the Rotation Quadrant saved alongside each sentiment reading so
  // past days' quadrants can be re-drawn from history. Derived from quadrantAssets
  // — the SAME source the live chart renders — so "what you see" is exactly what
  // gets saved. onBeforeRun() resets groupFilter to 'all' before calling Gemini, so
  // by the time the result is stored the quadrant already shows the full universe
  // (stocks included), and this snapshot captures exactly that view.
  const buildQuadrant = (): QuadrantPoint[] => {
    const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
    return quadrantAssets.map(a => ({
      symbol: a.symbol,
      name: a.name,
      group: a.group,
      r3m: r1(a.r3m)!,
      accScore: a.accScore,
      accel: a.accel != null ? r1(a.accel) ?? undefined : undefined,
      r1m: r1(a.r1m),
      r1y: r1(a.r1y),
      isAccel: a.isAccel,
    }));
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
      <SentimentPanel buildSnapshot={buildSnapshot} getQuadrant={buildQuadrant} ready={!rollingLoading} onBeforeRun={resetTableForSentiment} />

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
            title="Show only assets that are genuinely accelerating — rising AND speeding up"
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

      {/* Stock list selector — toggle one or more saved Stocks watchlists to rank here */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">Stock lists:</span>
        {stockLists.length === 0 ? (
          <span className="text-[11px] text-gray-600 italic">
            None yet — save stocks into a list from the Stocks tab (add a note with a category).
          </span>
        ) : (
          <div className="flex gap-1 flex-wrap">
            {stockLists.map(cat => {
              const active = activeStockLists.includes(cat);
              return (
                <button
                  key={cat}
                  onClick={() => setActiveStockLists(
                    active ? activeStockLists.filter(l => l !== cat) : [...activeStockLists, cat]
                  )}
                  className={clsx('px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all',
                    active ? 'border-rose-400/60 text-rose-300 bg-rose-400/10' : 'border-border text-gray-500 hover:text-gray-300')}
                >
                  {cat}
                </button>
              );
            })}
            {activeStockLists.length > 0 && (
              <button
                onClick={() => setActiveStockLists([])}
                className="px-2.5 py-1 text-[11px] font-medium rounded-full border border-border text-gray-600 hover:text-gray-400 transition-all"
              >
                Clear
              </button>
            )}
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

      {/* Accelerating mode explainer + legend */}
      {accelOnly && !rollingLoading && (
        <div className="space-y-2">
          <p className="text-[11px] text-green-400/80">
            <span className="font-semibold">Early-stage rotation</span> — every name that clears the gate, ranked by RotationScore: recent acceleration (last month faster than the quarter), trend strength, regime vs 200-day MA, minus a blow-off penalty for parabolic over-extension. The count varies with the market — there is no fixed slot limit.
          </p>
          <RotationLegend />
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
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden md:table-cell', sortBy === '52w' ? 'text-accent' : 'text-gray-600')} title="Position within the 52-week range: 0% = on the 52W low, 100% = on the 52W high">52W Range</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden xl:table-cell', sortBy === '200d' ? 'text-accent' : 'text-gray-600')} title="% gap from 200-day MA (green=above, red=below)">vs 200D</th>
                  <th className={clsx('px-3 py-2 text-right text-[10px] font-medium hidden xl:table-cell', sortBy === '200w' ? 'text-accent' : 'text-gray-600')} title="% gap from 200-week MA (green=above, red=below)">vs 200W</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedItems.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-xs text-gray-500">
                      {accelOnly
                        ? 'Nothing is accelerating right now — no asset is both rising and speeding up.'
                        : pinnedOnly
                          ? 'No pinned assets in this view — tap the ☆ on a row to pin it.'
                          : 'No assets match this filter.'}
                    </td>
                  </tr>
                )}
                {sortedItems.map((item, idx) => {
                  const isSelected = selectedSymbols.has(item.symbol);
                  const scored     = scoreMap.get(item.symbol);
                  const accel      = accelArrow(scored?.accPctile ?? null);
                  // Flag names in the bottom half of 1Y extension: the run is still young.
                  const isFresh    = accelOnly && (scored?.accPctile ?? 0) > 0.7 && (item.r1y == null || item.r1y < 30);
                  // Rebound vs trend: if the acceleration sits on a deeply negative 6M or
                  // 1Y base, it's a bounce off oversold (riskier) rather than a confirmed
                  // uptrend. Solid = up across every horizon.
                  const isRebound  = accelOnly &&
                    ((item.r6m != null && item.r6m < 0) || (item.r1y != null && item.r1y < 0));
                  const isSolid    = accelOnly && !isRebound &&
                    item.r6m != null && item.r6m > 0 && item.r1y != null && item.r1y > 0;
                  // Pre-breakout "coiled spring": picked by the reserved sleeve, NOT the
                  // momentum gate — a year-long uptrend basing near its 52w high (M7).
                  const isCoiled   = accelOnly && (scored?.passesPreBreakout ?? false) && !(scored?.passesGate ?? false);
                  // Overheated cyclical (M8): RSI is hot AND the overheat guard is
                  // actively demoting it (so the badge only shows on the cyclicals it bites).
                  const isHot      = accelOnly && (scored?.overheat ?? 0) > 0.33 && (scored?.rsi ?? 0) >= 70
                    && (item.group === 'Commodities' || item.group === 'Crypto');
                  // Above 200W = structural long-term bull (mega-cycle confirmed).
                  const above200w  = item.price != null && item.sma200w != null && item.price > item.sma200w;
                  const isPinned   = pins.has(item.symbol);
                  const vs200d     = vsMa(item.price, item.ma200);
                  const vs200w     = vsMa(item.price, item.sma200w);
                  const rangePos   = pos52w(item);
                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => { const t = assetNavTarget(item.group as string, item.symbol); onNavigate?.(t.section, t.jumpTo); }}
                      className={clsx(
                        'cursor-pointer transition-colors hover:bg-border/30',
                        isSelected && 'bg-accent/10'
                      )}
                    >
                      <td className="px-3 py-2 text-[11px] text-gray-600 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            onClick={(e) => { e.stopPropagation(); toggleSymbol(item.symbol); }}
                            className={clsx('shrink-0 w-2.5 h-2.5 rounded-full transition-opacity', isSelected ? 'opacity-100 ring-1 ring-white/30' : 'opacity-40 hover:opacity-70')}
                            style={{ background: { Indexes:'#3b82f6', Crypto:'#f97316', Commodities:'#f59e0b', Sectors:'#8b5cf6', Stocks:'#f43f5e' }[item.group] ?? '#6b7280' }}
                            title="Click to highlight on chart"
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
                          {isSolid && !isCoiled && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-300 leading-none" title="Up across every horizon — a confirmed trend, not just a bounce">
                              ✓ trend
                            </span>
                          )}
                          {isCoiled && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-violet-500/15 text-violet-300 leading-none" title="Coiled spring — a year-long uptrend basing near its 52-week high, not accelerating yet. Reserved pre-breakout slot (M7).">
                              🔒 coiled
                            </span>
                          )}
                          {isHot && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-red-500/15 text-red-300 leading-none" title="Overheated cyclical — RSI in the overbought zone on a commodity/crypto. The M8 overheat guard demotes it (these mean-revert hardest off an overbought RSI, like oil before the Iran-war crash). A secular grower running hot is barely touched.">
                              🔥 hot
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
                          {accelOnly && !rollingLoading && scored && !isCoiled && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent leading-none tabular-nums" title="Composite RotationScore (0–100) from the CURRENT model — this is what changes when the model changes. The list is ordered by it.">
                              {Math.round(scored.score * 100)}
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
                      <td className="px-3 py-2 hidden md:table-cell"
                          title={item.high52w != null && item.low52w != null ? `52W range: ${item.low52w.toFixed(2)} – ${item.high52w.toFixed(2)}` : undefined}>
                        {rollingLoading ? (
                          <div className="text-right text-gray-700">…</div>
                        ) : rangePos == null ? (
                          <div className="text-right text-gray-500">—</div>
                        ) : (
                          <div className="flex items-center gap-1.5 justify-end">
                            <div className="w-12 h-1.5 rounded-full bg-border overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${rangePos}%`, background: rangePos >= 66 ? '#4ade80' : rangePos >= 33 ? '#fbbf24' : '#f87171' }} />
                            </div>
                            <span className={clsx('text-xs tabular-nums w-8 text-right', sortBy === '52w' && 'font-bold', rangePos >= 66 ? 'text-green-400' : rangePos >= 33 ? 'text-amber-400' : 'text-red-400')}>
                              {rangePos.toFixed(0)}%
                            </span>
                          </div>
                        )}
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

      {/* Rotation Quadrant chart */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-400">Rotation Quadrant</p>
          {selectedSymbols.size > 0 && (
            <button
              onClick={() => { userHasToggled.current = true; setSelectedSymbols(new Set()); }}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              Clear highlights
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-600">Click a row to highlight its dot. Labeled = names that clear the Accelerating gate.</p>
        <QuadrantChart
          assets={quadrantAssets}
          loading={rollingLoading}
          onAssetClick={a => {
            const t = assetNavTarget(a.group, a.symbol);
            onNavigate?.(t.section, t.jumpTo);
          }}
        />
      </div>

      {/* Backtest — time machine. Includes the active stock lists so the model
          is tested on exactly the universe shown above. */}
      <BacktestPanel stockSymbols={stockListSymbols} onNavigate={onNavigate} />
    </div>
  );
}
