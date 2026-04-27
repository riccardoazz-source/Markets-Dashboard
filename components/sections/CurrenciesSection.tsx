'use client';

import { useState, useEffect, useCallback } from 'react';
import { CURRENCY_PAIRS } from '@/lib/config';
import { Timeframe } from '@/lib/types';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { LoadingSpinner, LoadingGrid } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { ArrowRight, RefreshCw } from 'lucide-react';

interface CurrencyRate {
  from: string;
  to: string;
  rate: number | null;
}

interface HistPoint { date: string; close: number }

const TF_OPTIONS: Timeframe[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

function decimals(rate: number | null) {
  if (!rate) return 4;
  return rate > 100 ? 2 : rate > 10 ? 3 : 4;
}

export function CurrenciesSection() {
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [historical, setHistorical] = useState<HistPoint[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchRates = useCallback(async () => {
    try {
      const res = await fetch('/api/currencies?mode=latest');
      const data = await res.json() as CurrencyRate[];
      setRates(data);
      setLastUpdate(new Date());
      if (!selected && data.length > 0) setSelected({ from: data[0].from, to: data[0].to });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const fetchHistorical = useCallback(async (from: string, to: string, tf: Timeframe) => {
    setHistLoading(true);
    try {
      const res = await fetch(`/api/currencies?mode=historical&from=${from}&to=${to}&timeframe=${tf}`);
      const data = await res.json() as { points: { date: string; rate: number }[]; average: number };
      setHistorical(data.points?.map(p => ({ date: p.date, close: p.rate })) ?? []);
      setAverage(data.average ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
    const id = setInterval(fetchRates, 60_000);
    return () => clearInterval(id);
  }, [fetchRates]);

  useEffect(() => {
    if (selected) fetchHistorical(selected.from, selected.to, timeframe);
  }, [selected, timeframe, fetchHistorical]);

  const selectedRate = rates.find(r => r.from === selected?.from && r.to === selected?.to);
  const dec = decimals(selectedRate?.rate ?? null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-400">Major Currency Pairs</h2>
        {lastUpdate && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <RefreshCw size={11} />
            {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {loading ? (
        <LoadingGrid count={10} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {rates.map(rate => {
            const isSelected = selected?.from === rate.from && selected?.to === rate.to;
            const d = decimals(rate.rate);
            return (
              <button
                key={`${rate.from}/${rate.to}`}
                onClick={() => setSelected({ from: rate.from, to: rate.to })}
                className={clsx(
                  'rounded-xl border p-4 text-left transition-all duration-150 hover:border-accent/50',
                  isSelected ? 'border-accent bg-accent/10' : 'border-border bg-bg-card'
                )}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm font-bold text-white">{rate.from}</span>
                  <ArrowRight size={12} className="text-gray-500" />
                  <span className="text-sm font-bold text-white">{rate.to}</span>
                </div>
                {rate.rate != null ? (
                  <p className="text-xl font-bold text-white">
                    {rate.rate.toFixed(d)}
                  </p>
                ) : (
                  <p className="text-gray-500 text-sm">N/A</p>
                )}
                <p className="text-[10px] text-gray-500 mt-1">
                  1 {rate.from} = {rate.rate?.toFixed(d)} {rate.to}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white">
                {selected.from} / {selected.to}
              </h3>
              {selectedRate?.rate != null && (
                <span className="text-2xl font-bold text-accent">
                  {selectedRate.rate.toFixed(dec)}
                </span>
              )}
            </div>
            <TimeframeSelector value={timeframe} onChange={setTimeframe} options={TF_OPTIONS} />
          </div>

          {average != null && (
            <div className="flex gap-4 flex-wrap">
              <div className="bg-bg-input rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">Period Average</p>
                <p className="text-sm font-bold text-gold">{average.toFixed(dec)}</p>
              </div>
              {selectedRate?.rate != null && (
                <div className="bg-bg-input rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-gray-500 mb-0.5">vs Average</p>
                  <p className={clsx(
                    'text-sm font-bold',
                    selectedRate.rate > average ? 'text-up-text' : 'text-down-text'
                  )}>
                    {selectedRate.rate > average ? '+' : ''}
                    {((selectedRate.rate - average) / average * 100).toFixed(2)}%
                  </p>
                </div>
              )}
              {historical.length > 0 && (
                <div className="bg-bg-input rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-gray-500 mb-0.5">Period Change</p>
                  <p className={clsx(
                    'text-sm font-bold',
                    historical[historical.length - 1].close >= historical[0].close ? 'text-up-text' : 'text-down-text'
                  )}>
                    {((historical[historical.length - 1].close - historical[0].close) / historical[0].close * 100).toFixed(2)}%
                  </p>
                </div>
              )}
            </div>
          )}

          {histLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size={32} />
            </div>
          ) : (
            <PriceChart
              data={historical}
              color="#6366f1"
              showAverage={true}
              averageValue={average ?? undefined}
              height={240}
              isCurrency={true}
            />
          )}
        </div>
      )}
    </div>
  );
}
