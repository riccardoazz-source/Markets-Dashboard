'use client';

import { useState, useEffect, useCallback } from 'react';
import { CRYPTO_IDS } from '@/lib/config';
import { HistoricalPoint, Timeframe, CAGRData, CryptoData } from '@/lib/types';
import { formatPrice, formatPercent, formatMarketCap, colorForPercent, calculateCAGR } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw, X } from 'lucide-react';

type SortKey = 'change24hPercent' | 'change1yPercent';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'change24hPercent', label: 'Day' },
  { value: 'change1yPercent',  label: '1Y'  },
];

export function CryptoCommoditiesSection() {
  const [cryptoData, setCryptoData] = useState<CryptoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('change24hPercent');
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [cagrData, setCAGRData] = useState<CAGRData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchCrypto = useCallback(async () => {
    try {
      const res = await fetch('/api/crypto?mode=markets');
      const data = await res.json() as CryptoData[];
      setCryptoData(data);
      setLastUpdate(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchHistorical = useCallback(async (id: string, tf: Timeframe) => {
    setHistLoading(true);
    try {
      const coin = CRYPTO_IDS.find(c => c.id === id);
      const daysMap: Record<string, number> = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650 };
      const days = daysMap[tf] ?? 365;
      const res = await fetch(`/api/crypto?mode=historical&id=${coin?.id ?? id}&days=${days}`);
      const data = await res.json() as HistoricalPoint[];
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
    } catch (e) { console.error(e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchCrypto();
    const id = setInterval(fetchCrypto, 60_000);
    return () => clearInterval(id);
  }, [fetchCrypto]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, timeframe);
  }, [selected, timeframe, fetchHistorical]);

  const sorted = [...cryptoData].sort((a, b) => {
    const av = a[sortBy] ?? -Infinity;
    const bv = b[sortBy] ?? -Infinity;
    return (bv as number) - (av as number);
  });

  const selectedCrypto = cryptoData.find(c => c.id === selected);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-500 font-medium">Sort:</p>
          <div className="flex gap-1 bg-bg-input rounded-lg p-1">
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={clsx('px-3 py-1 text-xs font-semibold rounded-md transition-all',
                  sortBy === opt.value ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {lastUpdate && (
          <div className="flex items-center gap-1 text-[10px] text-gray-600 shrink-0">
            <RefreshCw size={10} />
            {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
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
                <div className="flex items-center gap-2 mb-2">
                  {coin.image && <img src={coin.image} alt={coin.name} className="w-6 h-6 rounded-full" />}
                  <div>
                    <p className="text-xs font-bold text-gray-100 leading-none">{coin.name}</p>
                    <p className="text-[10px] text-gray-500">{coin.symbol}</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-white tabular-nums">{formatPrice(coin.price)}</p>
                <div className={clsx('flex items-center gap-1 mt-0.5 text-sm font-bold', colorForPercent(coin.change24hPercent))}>
                  {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {formatPercent(coin.change24hPercent)} <span className="text-[10px] font-medium opacity-70">day</span>
                </div>
                {coin.change1yPercent != null && (
                  <p className={clsx('text-[10px] mt-0.5', colorForPercent(coin.change1yPercent))}>
                    1Y: {formatPercent(coin.change1yPercent, 1)}
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
              <p className="text-xs text-gray-500 mt-0.5">{selectedCrypto.symbol}</p>
            </div>
            <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300 shrink-0">
              <X size={16} />
            </button>
          </div>
          <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <Stat label="Price" value={formatPrice(selectedCrypto.price)} />
            <Stat label="Day Change" value={formatPercent(selectedCrypto.change24hPercent)} color={colorForPercent(selectedCrypto.change24hPercent)} />
            {selectedCrypto.change1yPercent != null && (
              <Stat label="1Y Return" value={formatPercent(selectedCrypto.change1yPercent)} color={colorForPercent(selectedCrypto.change1yPercent)} />
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
            <PriceChart data={historical} color="auto" height={200} />
          )}
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
