'use client';

import { useState, useEffect, useCallback } from 'react';
import { PanelClose } from '@/components/ui/PanelClose';
import { Stat, StatGrid } from '@/components/ui/StatCard';
import { CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS } from '@/lib/config';
import { HistoricalPoint, Timeframe, CAGRData, CryptoData } from '@/lib/types';
import { formatPrice, formatPercent, formatCagr, formatMarketCap, colorForPercent, calculateCAGR, dataAvailabilityMessage, getTimeframeStart } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { useChartFit, paneCountOf } from '@/lib/useChartFit';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Sma200wLine, Ma200dLine, MaSpreadLine } from '@/components/ui/Sma200wLine';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, BarChart2 } from 'lucide-react';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { summarizeTools } from '@/lib/toolsSummary';
import { ReturnsTableButton } from '@/components/ui/ReturnsTableButton';
import { QuadrantButton } from '@/components/ui/QuadrantButton';
import { TradingViewButton } from '@/components/ui/TradingViewButton';
import { DetailModal } from '@/components/ui/DetailModal';
import { useAvgYearly } from '@/lib/useAvgYearly';
import { usePins } from '@/lib/gist';
import { useRotationPhases } from '@/lib/useRotationPhases';
import { PhaseChip, PinButton, RotationFilterBar, MAFilterChips, PhaseFilter, isBelowMA } from '@/components/ui/RotationControls';

type SortKey = 'change24hPercent' | 'oneMonthChangePercent' | 'threeMonthChangePercent' | 'sixMonthChangePercent' | 'mtdChangePercent' | 'ytdChangePercent' | 'fiveYearChangePercent' | 'fiveYearCagrPercent' | 'avgYearly';
const coinYahooSym = (c: { id: string; symbol: string }) => CRYPTO_YAHOO_SYMBOLS[c.id] ?? `${c.symbol}-USD`;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'change24hPercent',        label: 'Day' },
  { value: 'oneMonthChangePercent',   label: '1M' },
  { value: 'threeMonthChangePercent', label: '3M' },
  { value: 'sixMonthChangePercent',   label: '6M' },
  { value: 'mtdChangePercent',        label: 'MTD' },
  { value: 'ytdChangePercent',        label: 'YTD' },
  { value: 'fiveYearChangePercent',   label: '5Y' },
  { value: 'fiveYearCagrPercent',     label: 'CAGR' },
  { value: 'avgYearly',               label: 'Avg Yr' },
];

// Category filter tabs — derived from the crypto config so they always match.
const CRYPTO_CATEGORIES = ['All', ...Array.from(new Set(CRYPTO_IDS.map(c => c.category)))];
const CRYPTO_CATEGORY_BY_ID = new Map(CRYPTO_IDS.map(c => [c.id, c.category]));

export function CryptoCommoditiesSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [cryptoData, setCryptoData] = useState<CryptoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('change24hPercent');
  const [selectedCat, setSelectedCat] = useState('All');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [below200d, setBelow200d] = useState(false);
  const [below200w, setBelow200w] = useState(false);
  const { pins, togglePin } = usePins();
  const phases = useRotationPhases();
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  const fetchCrypto = useCallback(async () => {
    try {
      const res = await fetch('/api/crypto?mode=markets');
      const data = await res.json();
      // Guard: API may return { error: '...' } when CoinGecko is rate-limited.
      // Spreading a non-array would throw "Symbol.iterator is not a function".
      if (Array.isArray(data)) {
        setCryptoData(data as CryptoData[]);
        setLastUpdate(new Date());
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchHistorical = useCallback(async (id: string, tf: Timeframe, override?: { from: string; to: string }) => {
    setHistLoading(true);
    try {
      const coin = CRYPTO_IDS.find(c => c.id === id);
      let data: HistoricalPoint[] = [];

      if (override) {
        // For a custom date range, use Yahoo Finance directly — CoinGecko's
        // ?days=N API always returns the LAST N days from today (it cannot
        // target a specific past window), so it returns the wrong period for
        // old custom ranges. Yahoo supports an explicit from/to window.
        const yahooSym = CRYPTO_YAHOO_SYMBOLS[coin?.id ?? id];
        if (yahooSym) {
          const yRes = await fetch(
            `/api/historical?symbol=${encodeURIComponent(yahooSym)}&timeframe=MAX&from=${override.from}&to=${override.to}`
          );
          if (yRes.ok) {
            const yRaw = await yRes.json() as HistoricalPoint[];
            if (Array.isArray(yRaw) && yRaw.length) {
              data = yRaw.filter(p => p.date >= override.from && p.date <= override.to);
            }
          }
        }
        // If Yahoo didn't cover the range, try CoinGecko range API
        if (!data.length) {
          const from1 = Math.floor(new Date(override.from).getTime() / 1000);
          const to1 = Math.floor(new Date(override.to).getTime() / 1000) + 86400;
          const cgRes = await fetch(
            `/api/crypto?mode=historical&id=${coin?.id ?? id}&from=${from1}&to=${to1}`
          );
          if (cgRes.ok) {
            const cgRaw = await cgRes.json() as HistoricalPoint[];
            if (Array.isArray(cgRaw) && cgRaw.length) {
              data = cgRaw.filter(p => p.date >= override.from && p.date <= override.to);
            }
          }
        }
      } else {
        // CoinGecko granularity: > 90 days → daily, but free-tier caps daily
        // data at ~3650 days (10 years). Requesting days=4000+ silently
        // degrades to MONTHLY data (~141 points), which breaks SMA/EMA tools.
        const daysMap: Record<string, number> = { '1D': 3, '1W': 7, 'MTD': 35, '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650, 'MAX': 3650 };
        const days = daysMap[tf] ?? 365;
        const yahooSym = CRYPTO_YAHOO_SYMBOLS[coin?.id ?? id];

        // Fetch CoinGecko and Yahoo CONCURRENTLY, then pick the best result.
        // Why: CoinGecko's free tier rate-limits (30/min) and its route retries
        // with backoff (up to ~4.5s) before giving up — which made recently-listed
        // coins (e.g. Hyperliquid) load slowly or show "no data" whenever CoinGecko
        // was throttled. Yahoo is fast and not rate-limited, so we race them: Yahoo
        // always resolves quickly as a backstop, and CoinGecko is preferred for its
        // finer granularity only when it returns promptly. The startDate clip below
        // trims any pre-listing Yahoo garbage (HYPE-USD reused a delisted ticker).
        const cgPromise: Promise<HistoricalPoint[]> = fetch(`/api/crypto?mode=historical&id=${coin?.id ?? id}&days=${days}`)
          .then(r => (r.ok ? r.json() : null))
          .then(j => (Array.isArray(j) ? (j as HistoricalPoint[]) : []))
          .catch(() => []);
        const yPromise: Promise<HistoricalPoint[]> = yahooSym
          ? fetch(`/api/historical?symbol=${encodeURIComponent(yahooSym)}&timeframe=${tf}`)
              .then(r => (r.ok ? r.json() : null))
              .then(j => (Array.isArray(j) ? (j as HistoricalPoint[]) : []))
              .catch(() => [])
          : Promise.resolve([]);

        const yData = await yPromise;
        // Give CoinGecko a brief window for its better granularity, but never let a
        // throttled CoinGecko stall the chart — cap the extra wait at 1.5s.
        const cgData = await Promise.race([
          cgPromise,
          new Promise<HistoricalPoint[]>(res => setTimeout(() => res([]), 1500)),
        ]);

        if (tf === '1D') {
          // 1D should show only the last day. Yahoo's daily series is trimmed to
          // the last 2 bars server-side (prev close → latest); CoinGecko at days=3
          // returns hourly points spanning ~3 days, so prefer Yahoo here.
          data = yData.length >= 2 ? yData : cgData.slice(-2);
        } else if (tf === 'MAX') {
          // MAX: prefer whichever has the longer usable history.
          data = cgData.length >= yData.length ? cgData : yData;
        } else {
          // Shorter ranges: prefer CoinGecko's granularity, fall back to Yahoo.
          data = cgData.length ? cgData : yData;
          // CoinGecko fetches by DAYS (rolling window), so calendar timeframes like
          // MTD/YTD would show ~35/365 rolling days instead of "since month/year
          // start" — clip to the timeframe's true start so the chart matches its label.
          const tfStart = getTimeframeStart(tf);
          data = data.filter(p => p.date >= tfStart);
        }
      }

      // Clip to the asset's known real-data start date. Some Yahoo tickers reuse a
      // symbol that previously belonged to a different (now-delisted) asset — HYPE-USD
      // is the canonical example: the ticker existed before Hyperliquid's Nov 2024
      // airdrop and carried an unrelated instrument that went to zero. Without this
      // clip the MAX chart shows bogus pre-launch data ending at −100%.
      if (coin?.startDate) {
        data = data.filter(p => p.date >= coin.startDate!);
      }
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
      setDataMsg(dataAvailabilityMessage(data, tf, !!override));
    } catch (e) { console.error(e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchCrypto();
    const id = setInterval(fetchCrypto, 60_000);
    return () => clearInterval(id);
  }, [fetchCrypto]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchHistorical]);

  useEffect(() => {
    if (jumpTo?.startsWith('crypto:')) setSelected(jumpTo.slice('crypto:'.length));
  }, [jumpTo]);

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

  // Double-guard: cryptoData is initialised as [] but could be stale if a fetch
  // overwrote state with a non-array error object. Spread on non-array throws.
  const safeData = Array.isArray(cryptoData) ? cryptoData : [];
  const catFiltered = safeData.filter(c =>
    (selectedCat === 'All' || CRYPTO_CATEGORY_BY_ID.get(c.id) === selectedCat)
    && (phaseFilter === 'all' || phases.get(coinYahooSym(c)) === phaseFilter)
    && (!pinnedOnly || pins.has(coinYahooSym(c)))
    && (!below200d || isBelowMA(c.price, c.sma200d))
    && (!below200w || isBelowMA(c.price, c.sma200w))
  );
  const avgYearlyMap = useAvgYearly(CRYPTO_IDS.map(coinYahooSym));
  const sorted = [...catFiltered].sort((a, b) => {
    const av = (sortBy === 'avgYearly' ? avgYearlyMap[coinYahooSym(a)] : (a as unknown as Record<string, number | null>)[sortBy]) ?? -Infinity;
    const bv = (sortBy === 'avgYearly' ? avgYearlyMap[coinYahooSym(b)] : (b as unknown as Record<string, number | null>)[sortBy]) ?? -Infinity;
    return (bv as number) - (av as number);
  });

  const selectedCrypto = cryptoData.find(c => c.id === selected);

  // Panes the active tools open push the panel taller; this keeps it inside the
  // window by measuring it rather than guessing (see lib/useChartFit).
  const { ref: fitRef, height: chartH, paneHeight } = useChartFit(paneCountOf(activeTools));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {CRYPTO_IDS.length} cryptocurrencies
        </span>
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          <div className="flex gap-1 bg-bg-input rounded-lg p-1 overflow-x-auto scrollbar-hide min-w-0">
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={clsx('px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                {opt.label}
              </button>
            ))}
            <MAFilterChips below200d={below200d} setBelow200d={setBelow200d} below200w={below200w} setBelow200w={setBelow200w} />
          </div>
          {lastUpdate && (
            <div className="flex items-center gap-1 text-[10px] text-gray-600">
              <RefreshCw size={10} />
              {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {/* Rotation phase + pinned filter */}
      <RotationFilterBar phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter}
        pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} pinnedCount={CRYPTO_IDS.filter(c => pins.has(coinYahooSym(c))).length} />
      {/* Category filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {CRYPTO_CATEGORIES.map(c => (
          <button key={c} onClick={() => setSelectedCat(c)}
            className={clsx(
              'px-3 py-1 text-xs font-semibold rounded-full transition-all whitespace-nowrap shrink-0',
              selectedCat === c
                ? 'bg-accent text-white'
                : 'text-gray-400 border border-border hover:border-border-light hover:text-gray-200'
            )}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingGrid count={8} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sorted.map(coin => {
            const isUp = coin.change24hPercent >= 0;
            const isSelected = selected === coin.id;
            const ysym = coinYahooSym(coin);
            return (
              <button key={coin.id}
                onClick={() => setSelected(isSelected ? null : coin.id)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}>
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {coin.image && <img src={coin.image} alt={coin.name} className="w-6 h-6 rounded-full shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <p className="text-xs font-bold text-gray-100 leading-none truncate">{coin.name}</p>
                        <PhaseChip phase={phases.get(ysym)} />
                      </div>
                      <p className="text-[10px] text-gray-500">{coin.symbol}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                      USD
                    </span>
                    <PinButton pinned={pins.has(ysym)} onToggle={() => togglePin(ysym)} />
                  </div>
                </div>
                <p className="text-lg font-bold text-white tabular-nums">{formatPrice(coin.price)}</p>
                <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(coin.change24hPercent))}>
                  {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {formatPercent(coin.change24hPercent)} <span className="text-[10px] font-medium opacity-70">day</span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 mt-1.5">
                  {([
                    { k: '1M', v: coin.oneMonthChangePercent },
                    { k: '3M', v: coin.threeMonthChangePercent },
                    { k: '6M', v: coin.sixMonthChangePercent },
                    { k: 'MTD', v: coin.mtdChangePercent },
                    { k: 'YTD', v: coin.ytdChangePercent },
                    // '5Y*' when history < 5y — the figure covers a shorter span.
                    { k: coin.fiveYearFull ? '5Y' : '5Y*', v: coin.fiveYearChangePercent },
                    { k: 'CAGR', v: coin.fiveYearCagrPercent, cagr: true },
                    { k: 'Avg Yr', v: avgYearlyMap[coinYahooSym(coin)] ?? null },
                  ] as { k: string; v: number | null | undefined; cagr?: boolean }[])
                    .filter(s => s.v != null)
                    .map(s => (
                      <p key={s.k} className={clsx('text-[9px] leading-[1.35] tabular-nums', colorForPercent(s.v as number))}>
                        <span className="text-gray-500">{s.k}:</span> {s.cagr ? formatCagr(s.v as number, coin.fiveYearFull) : formatPercent(s.v as number, 1)}
                      </p>
                    ))}
                </div>
                <Ma200dLine price={coin.price} sma200d={coin.sma200d} />
                <Sma200wLine price={coin.price} sma200w={coin.sma200w} />
                <MaSpreadLine sma200d={coin.sma200d} sma200w={coin.sma200w} />
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedCrypto && (
        <DetailModal onClose={() => setSelected(null)}>
        <div ref={fitRef} className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <PanelClose onClose={() => setSelected(null)} />
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white">{selectedCrypto.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                {selectedCrypto.symbol}
                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                  USD
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end pr-7 min-w-0">
              {onCompare && (
                <button
                  onClick={() => onCompare(CRYPTO_YAHOO_SYMBOLS[selected] ?? `${selectedCrypto.symbol}-USD`)}
                  className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-[11px] sm:text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  <span className="hidden sm:inline">Compare</span>
                </button>
              )}
              <ReturnsTableButton name={selectedCrypto.name} symbol={CRYPTO_YAHOO_SYMBOLS[selected] ?? `${selectedCrypto.symbol}-USD`} />
              <QuadrantButton name={selectedCrypto.name} symbol={CRYPTO_YAHOO_SYMBOLS[selected] ?? `${selectedCrypto.symbol}-USD`} group="Crypto" />
              <TradingViewButton symbol={CRYPTO_YAHOO_SYMBOLS[selected] ?? `${selectedCrypto.symbol}-USD`} name={selectedCrypto.name} group="Crypto" />
              <GeminiCommentButton
                key={selected}
                name={selectedCrypto.name}
                symbol={CRYPTO_YAHOO_SYMBOLS[selected] ?? `${selectedCrypto.symbol}-USD`}
                assetClass="Crypto"
                price={selectedCrypto.price}
                dayPct={selectedCrypto.change24hPercent}
                timeframe={timeframe}
                tools={historical.length > 0 ? summarizeTools(activeTools, historical) : undefined}
              />
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
            <TimeframeSelector
              value={timeframe}
              onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
              isCustom={!!customRange}
              onCustomRange={(from, to) => setCustomRange({ from, to })}
            />
          </div>

          {dataMsg && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              ⚠ {dataMsg}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
            <Stat label="Price" value={formatPrice(selectedCrypto.price)} />
            <Stat label="Day Change" value={formatPercent(selectedCrypto.change24hPercent)} color={colorForPercent(selectedCrypto.change24hPercent)} />
            {selectedCrypto.mtdChangePercent != null && (
              <Stat label="MTD Return" value={formatPercent(selectedCrypto.mtdChangePercent)} color={colorForPercent(selectedCrypto.mtdChangePercent)} />
            )}
            {selectedCrypto.ytdChangePercent != null && (
              <Stat label="YTD Return" value={formatPercent(selectedCrypto.ytdChangePercent)} color={colorForPercent(selectedCrypto.ytdChangePercent)} />
            )}
            {cagrData && (
              <>
                <Stat label={`Return (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
                <Stat label={`CAGR (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
              </>
            )}
            <Stat label="Market Cap" value={formatMarketCap(selectedCrypto.marketCap)} />
            <Stat label="24h Volume" value={formatMarketCap(selectedCrypto.volume24h)} />
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : (
            <PriceChart data={historical} symbol={coinYahooSym(selectedCrypto)} color="auto" toolsOverlay={activeTools}
              syncId="crypto-detail" height={chartH} subChartHeight={paneHeight}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          )}
          {historical.length > 0 && (
            <ChartTools data={historical} symbol={coinYahooSym(selectedCrypto)} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && <ChartDataTable data={historical} />}
          {selected && (
            <ChartNotes
              chartId={`crypto:${selected}`}
              captureView={() => ({ tools: { ...activeTools } as Record<string, boolean>, timeframe, customRange })}
              onRestoreView={v => {
                if (v.tools) setActiveTools({ ...DEFAULT_TOOLS, ...(v.tools as Partial<ActiveTools>) });
                if (v.timeframe) setTimeframe(v.timeframe as Timeframe);
                setCustomRange(v.customRange ?? null);
              }}
            />
          )}
        </div>
        </DetailModal>
      )}
    </div>
  );
}

