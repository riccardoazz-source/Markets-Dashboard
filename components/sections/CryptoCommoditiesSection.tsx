'use client';

import { useState, useEffect, useCallback } from 'react';
import { COMMODITIES, CRYPTO_IDS } from '@/lib/config';
import { QuoteData, HistoricalPoint, Timeframe, CAGRData, CryptoData } from '@/lib/types';
import {
  formatPrice, formatPercent, formatMarketCap, colorForPercent, calculateCAGR,
} from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

type Tab = 'crypto' | 'commodities';

export function CryptoCommoditiesSection() {
  const [tab, setTab] = useState<Tab>('crypto');
  const [cryptoData, setCryptoData] = useState<CryptoData[]>([]);
  const [commodityData, setCommodityData] = useState<Record<string, QuoteData>>({});
  const [loadingCrypto, setLoadingCrypto] = useState(true);
  const [loadingCommodities, setLoadingCommodities] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'crypto' | 'commodity'>('crypto');
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
    finally { setLoadingCrypto(false); }
  }, []);

  const fetchCommodities = useCallback(async () => {
    try {
      const symbols = COMMODITIES.map(c => c.symbol).join(',');
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const data = await res.json() as QuoteData[];
      const map: Record<string, QuoteData> = {};
      data.forEach(q => { map[q.symbol] = q; });
      setCommodityData(map);
    } catch (e) { console.error(e); }
    finally { setLoadingCommodities(false); }
  }, []);

  const fetchHistorical = useCallback(async (symbol: string, type: 'crypto' | 'commodity', tf: Timeframe) => {
    setHistLoading(true);
    try {
      let data: HistoricalPoint[];
      if (type === 'crypto') {
        const coin = CRYPTO_IDS.find(c => c.id === symbol);
        const daysMap: Record<string, number> = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, 'YTD': 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650 };
        const days = daysMap[tf] ?? 365;
        const res = await fetch(`/api/crypto?mode=historical&id=${coin?.id ?? symbol}&days=${days}`);
        data = await res.json() as HistoricalPoint[];
      } else {
        const res = await fetch(`/api/historical?symbol=${symbol}&timeframe=${tf}`);
        data = await res.json() as HistoricalPoint[];
      }
      setHistorical(data);
      setCAGRData(calculateCAGR(data, tf));
    } catch (e) { console.error(e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchCrypto();
    fetchCommodities();
    const id = setInterval(() => { fetchCrypto(); fetchCommodities(); }, 60_000);
    return () => clearInterval(id);
  }, [fetchCrypto, fetchCommodities]);

  useEffect(() => {
    if (selected) fetchHistorical(selected, selectedType, timeframe);
  }, [selected, selectedType, timeframe, fetchHistorical]);

  const handleSelect = (id: string, type: 'crypto' | 'commodity') => {
    if (selected === id) { setSelected(null); return; }
    setSelected(id);
    setSelectedType(type);
    setHistorical([]);
    setCAGRData(null);
  };

  const selectedCrypto = cryptoData.find(c => c.id === selected);
  const selectedCommodity = selected ? commodityData[selected] : null;
  const selectedName = selectedCrypto?.name ?? COMMODITIES.find(c => c.symbol === selected)?.name ?? selected;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['crypto', 'commodities'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-1.5 text-sm font-semibold rounded-full transition-all',
                tab === t ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200 border border-border'
              )}>
              {t === 'crypto' ? 'Crypto' : 'Commodities'}
            </button>
          ))}
        </div>
        {lastUpdate && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <RefreshCw size={11} />
            {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {tab === 'crypto' && (
        loadingCrypto ? <LoadingGrid count={8} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {cryptoData.map(coin => {
              const isUp = coin.change24hPercent >= 0;
              const isSelected = selected === coin.id;
              return (
                <button key={coin.id} onClick={() => handleSelect(coin.id, 'crypto')}
                  className={clsx(
                    'rounded-xl border p-4 text-left transition-all duration-150 hover:border-accent/50',
                    isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                  )}>
                  <div className="flex items-center gap-2 mb-3">
                    {coin.image && <img src={coin.image} alt={coin.name} className="w-7 h-7 rounded-full" />}
                    <div>
                      <p className="text-xs font-bold text-gray-100">{coin.name}</p>
                      <p className="text-[10px] text-gray-500">{coin.symbol}</p>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {formatPrice(coin.price)}
                  </p>
                  <div className={clsx('flex items-center gap-1 mt-1 text-xs font-semibold', colorForPercent(coin.change24hPercent))}>
                    {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {formatPercent(coin.change24hPercent)} 24h
                  </div>
                  {coin.change7dPercent != null && (
                    <p className={clsx('text-[10px] mt-0.5', colorForPercent(coin.change7dPercent))}>
                      7d: {formatPercent(coin.change7dPercent)}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-500 mt-1.5">
                    MCap: {formatMarketCap(coin.marketCap)}
                  </p>
                </button>
              );
            })}
          </div>
        )
      )}

      {tab === 'commodities' && (
        loadingCommodities ? <LoadingGrid count={9} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {COMMODITIES.map(com => {
              const q = commodityData[com.symbol];
              const isUp = (q?.changePercent ?? 0) >= 0;
              const isSelected = selected === com.symbol;
              return (
                <button key={com.symbol} onClick={() => handleSelect(com.symbol, 'commodity')}
                  className={clsx(
                    'rounded-xl border p-4 text-left transition-all duration-150 hover:border-accent/50',
                    isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                  )}>
                  <div className="mb-2">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">{com.category}</p>
                    <p className="text-sm font-semibold text-gray-100">{com.name}</p>
                  </div>
                  {q ? (
                    <>
                      <p className="text-xl font-bold text-white">{formatPrice(q.price)}</p>
                      <div className={clsx('flex items-center gap-1 mt-1 text-xs font-semibold', colorForPercent(q.changePercent))}>
                        {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {formatPercent(q.changePercent)}
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-500 text-sm mt-2">Loading…</p>
                  )}
                </button>
              );
            })}
          </div>
        )
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-lg font-bold text-white">{selectedName}</h3>
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {selectedCrypto && (
              <>
                <Stat label="Price" value={formatPrice(selectedCrypto.price)} />
                <Stat label="24h Change" value={formatPercent(selectedCrypto.change24hPercent)} color={colorForPercent(selectedCrypto.change24hPercent)} />
                <Stat label="Market Cap" value={formatMarketCap(selectedCrypto.marketCap)} />
                <Stat label="24h Volume" value={formatMarketCap(selectedCrypto.volume24h)} />
              </>
            )}
            {selectedCommodity && (
              <>
                <Stat label="Price" value={formatPrice(selectedCommodity.price)} />
                <Stat label="Change" value={formatPercent(selectedCommodity.changePercent)} color={colorForPercent(selectedCommodity.changePercent)} />
                {selectedCommodity.high52w && <Stat label="52W High" value={formatPrice(selectedCommodity.high52w)} />}
                {selectedCommodity.low52w && <Stat label="52W Low" value={formatPrice(selectedCommodity.low52w)} />}
              </>
            )}
            {cagrData && (
              <>
                <Stat label={`Return (${timeframe})`} value={formatPercent(cagrData.return)} color={colorForPercent(cagrData.return)} />
                <Stat label={`CAGR (${timeframe})`} value={formatPercent(cagrData.cagr)} color={colorForPercent(cagrData.cagr)} />
              </>
            )}
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center h-48"><LoadingSpinner size={32} /></div>
          ) : (
            <PriceChart data={historical} color="auto" height={240} />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-3 py-2.5">
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className={clsx('text-sm font-bold', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}
