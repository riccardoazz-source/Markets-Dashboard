'use client';

import { useState, useEffect, useCallback } from 'react';
import { CURRENCY_GROUPS, CURRENCY_META } from '@/lib/config';
import { Timeframe } from '@/lib/types';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { LoadingSpinner, LoadingGrid } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { ArrowRight, RefreshCw } from 'lucide-react';

interface CurrencyRate {
  from: string;
  to: string;
  rate: number | null;
}

interface HistPoint { date: string; close: number }

const TF_OPTIONS: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

function decimals(rate: number | null) {
  if (!rate) return 4;
  if (rate >= 100) return 2;
  if (rate >= 10) return 3;
  if (rate >= 0.1) return 4;
  if (rate >= 0.01) return 5;
  return 6;
}

function flag(code: string) {
  return CURRENCY_META[code]?.flag ?? '';
}

export function CurrenciesSection({ jumpTo }: { jumpTo?: string | null }) {
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [historical, setHistorical] = useState<HistPoint[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);

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

  const fetchHistorical = useCallback(async (
    from: string, to: string, tf: Timeframe, override?: { from: string; to: string }
  ) => {
    setHistLoading(true);
    try {
      const base = `/api/currencies?mode=historical&from=${from}&to=${to}&timeframe=${tf}`;
      const url = override ? `${base}&fromDate=${override.from}&toDate=${override.to}` : base;
      const data = await fetch(url).then(r => r.json()) as { points: { date: string; rate: number }[]; average: number };
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
    if (selected) fetchHistorical(selected.from, selected.to, timeframe, customRange ?? undefined);
  }, [selected, timeframe, customRange, fetchHistorical]);

  useEffect(() => {
    if (jumpTo && jumpTo.includes('/')) {
      const [from, to] = jumpTo.split('/');
      if (from && to) setSelected({ from, to });
    }
  }, [jumpTo]);

  const selectedRate = rates.find(r => r.from === selected?.from && r.to === selected?.to);
  const dec = decimals(selectedRate?.rate ?? null);

  const rateOf = (from: string, to: string) =>
    rates.find(r => r.from === from && r.to === to)?.rate ?? null;

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
        <LoadingGrid count={8} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {CURRENCY_GROUPS.map(g => {
            const directions = [
              { from: g.base, to: g.quote },
              { from: g.quote, to: g.base },
            ];
            return (
              <div key={`${g.base}-${g.quote}`}
                className="rounded-xl border border-border bg-bg-card overflow-hidden">
                {/* Header — flags identify both currencies of the group */}
                <div className="flex items-center justify-center gap-1.5 px-3 py-2 bg-bg-input/40 border-b border-border">
                  <span className="text-base leading-none">{flag(g.base)}</span>
                  <span className="text-xs font-bold text-white">{g.base}</span>
                  <span className="text-gray-600 text-xs mx-0.5">⇄</span>
                  <span className="text-base leading-none">{flag(g.quote)}</span>
                  <span className="text-xs font-bold text-white">{g.quote}</span>
                </div>
                {/* Both directions — a pair and its inverse, side by side */}
                {directions.map((dir, i) => {
                  const rate = rateOf(dir.from, dir.to);
                  const isSelected = selected?.from === dir.from && selected?.to === dir.to;
                  const d = decimals(rate);
                  return (
                    <button
                      key={`${dir.from}/${dir.to}`}
                      onClick={() => setSelected({ from: dir.from, to: dir.to })}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2.5 transition-colors',
                        i === 1 && 'border-t border-border/60',
                        isSelected ? 'bg-accent/15' : 'hover:bg-bg-hover',
                      )}
                    >
                      <span className="flex items-center gap-1 text-[11px] text-gray-400">
                        <span className="text-[13px] leading-none">{flag(dir.from)}</span>
                        <span className="font-medium">{dir.from}</span>
                        <ArrowRight size={9} className="text-gray-600" />
                        <span className="text-[13px] leading-none">{flag(dir.to)}</span>
                        <span className="font-medium">{dir.to}</span>
                      </span>
                      <span className={clsx('text-sm font-bold tabular-nums',
                        isSelected ? 'text-accent' : 'text-white')}>
                        {rate != null ? rate.toFixed(d) : 'N/A'}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white flex items-center gap-1.5">
                <span>{flag(selected.from)}</span>
                {selected.from}
                <span className="text-gray-500">/</span>
                <span>{flag(selected.to)}</span>
                {selected.to}
              </h3>
              {selectedRate?.rate != null && (
                <span className="text-2xl font-bold text-accent">
                  {selectedRate.rate.toFixed(dec)}
                </span>
              )}
            </div>
            <TimeframeSelector
              value={timeframe}
              onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
              options={TF_OPTIONS}
              isCustom={!!customRange}
              onCustomRange={(from, to) => setCustomRange({ from, to })}
            />
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
          {historical.length > 0 && <ChartDataTable data={historical} unit={`${selected?.from}/${selected?.to}`} />}
          {selected && <ChartNotes chartId={`${selected.from}/${selected.to}`} />}
        </div>
      )}
    </div>
  );
}
