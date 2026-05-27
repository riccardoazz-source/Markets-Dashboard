'use client';

import { useState, useEffect, useCallback } from 'react';
import { CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS } from '@/lib/config';
import { HistoricalPoint, Timeframe, CAGRData, CryptoData } from '@/lib/types';
import { formatPrice, formatPercent, formatMarketCap, colorForPercent, calculateCAGR, dataAvailabilityMessage } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X, BarChart2 } from 'lucide-react';

type SortKey = 'change24hPercent' | 'mtdChangePercent' | 'ytdChangePercent' | 'fiveYearChangePercent';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'change24hPercent',     label: 'Day' },
  { value: 'mtdChangePercent',     label: 'MTD' },
  { value: 'ytdChangePercent',     label: 'YTD' },
  { value: 'fiveYearChangePercent',label: '5Y' },
];

export function CryptoCommoditiesSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [cryptoData, setCryptoData] = useState<CryptoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('change24hPercent');
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
        const daysMap: Record<string, number> = { '1D': 3, '1W': 7, 'MTD': 35, '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650, 'MAX': 4000 };
        const days = daysMap[tf] ?? 365;
        const res = await fetch(`/api/crypto?mode=historical&id=${coin?.id ?? id}&days=${days}`);
        const rawJson = await res.json();
        data = Array.isArray(rawJson) ? (rawJson as HistoricalPoint[]) : [];

        // Yahoo Finance fallback when CoinGecko is rate-limited (common for >1Y ranges)
        if (!data.length) {
          const yahooSym = CRYPTO_YAHOO_SYMBOLS[coin?.id ?? id];
          if (yahooSym) {
            const fbRes = await fetch(`/api/historical?symbol=${encodeURIComponent(yahooSym)}&timeframe=${tf}`);
            if (fbRes.ok) {
              const fbRaw = await fbRes.json() as HistoricalPoint[];
              if (Array.isArray(fbRaw) && fbRaw.length) data = fbRaw;
            }
          }
        }
      }

      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
      setDataMsg(dataAvailabilityMessage(data, tf));
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
  const sorted = [...safeData].sort((a, b) => {
    const av = a[sortBy] ?? -Infinity;
    const bv = b[sortBy] ?? -Infinity;
    return (bv as number) - (av as number);
  });

  const selectedCrypto = cryptoData.find(c => c.id === selected);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
          {CRYPTO_IDS.length} cryptocurrencies
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex gap-1 bg-bg-input rounded-lg p-1">
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={clsx('px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                {opt.label}
              </button>
            ))}
          </div>
          {lastUpdate && (
            <div className="flex items-center gap-1 text-[10px] text-gray-600">
              <RefreshCw size={10} />
              {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingGrid count={8} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sorted.map(coin => {
            const isUp = coin.change24hPercent >= 0;
            const isSelected = selected === coin.id;
            return (
              <button key={coin.id}
                onClick={() => setSelected(isSelected ? null : coin.id)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {coin.image && <img src={coin.image} alt={coin.name} className="w-6 h-6 rounded-full" />}
                    <div>
                      <p className="text-xs font-bold text-gray-100 leading-none">{coin.name}</p>
                      <p className="text-[10px] text-gray-500">{coin.symbol}</p>
                    </div>
                  </div>
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none shrink-0">
                    USD
                  </span>
                </div>
                <p className="text-lg font-bold text-white tabular-nums">{formatPrice(coin.price)}</p>
                <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(coin.change24hPercent))}>
                  {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {formatPercent(coin.change24hPercent)} <span className="text-[10px] font-medium opacity-70">day</span>
                </div>
                {coin.mtdChangePercent != null && (
                  <p className={clsx('text-[10px] mt-0.5', colorForPercent(coin.mtdChangePercent))}>
                    MTD: {formatPercent(coin.mtdChangePercent, 1)}
                  </p>
                )}
                {coin.ytdChangePercent != null && (
                  <p className={clsx('text-[10px] mt-0.5', colorForPercent(coin.ytdChangePercent))}>
                    YTD: {formatPercent(coin.ytdChangePercent, 1)}
                  </p>
                )}
                {coin.fiveYearChangePercent != null && (
                  <p className={clsx('text-[10px] mt-0.5', colorForPercent(coin.fiveYearChangePercent))}>
                    5Y: {formatPercent(coin.fiveYearChangePercent, 1)}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedCrypto && (
        <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white">{selectedCrypto.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                {selectedCrypto.symbol}
                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30 leading-none">
                  USD
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onCompare && (
                <button
                  onClick={() => onCompare(CRYPTO_YAHOO_SYMBOLS[selected] ?? `${selectedCrypto.symbol}-USD`)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  Compare
                </button>
              )}
              <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
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

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
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
                <Stat label={`Return (${timeframe})`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
                <Stat label={`CAGR (${timeframe})`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
              </>
            )}
            <Stat label="Market Cap" value={formatMarketCap(selectedCrypto.marketCap)} />
            <Stat label="24h Volume" value={formatMarketCap(selectedCrypto.volume24h)} />
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-40"><LoadingSpinner size={28} /></div>
          ) : (
            <PriceChart data={historical} color="auto" height={200} toolsOverlay={activeTools}
              onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
          )}
          {historical.length > 0 && (
            <ChartTools data={historical} activeTools={activeTools} onChange={setActiveTools} />
          )}
          {historical.length > 0 && <ChartDataTable data={historical} />}
          {selected && <ChartNotes chartId={`crypto:${selected}`} />}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className={clsx('text-sm font-bold', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}
