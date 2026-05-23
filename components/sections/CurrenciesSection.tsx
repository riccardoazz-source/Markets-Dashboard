'use client';

import { useState, useEffect, useCallback } from 'react';
import { CURRENCY_GROUPS, CURRENCY_META } from '@/lib/config';
import { Timeframe } from '@/lib/types';
import { dataAvailabilityMessage } from '@/lib/utils';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { LoadingSpinner, LoadingGrid } from '@/components/ui/LoadingSpinner';
import clsx from 'clsx';
import { ArrowRight, RefreshCw, BarChart2 } from 'lucide-react';

interface CurrencyRate {
  from: string;
  to: string;
  rate: number | null;
  change1d: number | null;
  ytd: number | null;
  mtd: number | null;
}

interface HistPoint { date: string; close: number }

const TF_OPTIONS: Timeframe[] = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

function decimals(rate: number | null) {
  if (!rate) return 4;
  if (rate >= 100) return 2;
  if (rate >= 10) return 3;
  if (rate >= 0.1) return 4;
  if (rate >= 0.01) return 5;
  return 6;
}

// Real flag image — emoji flags don't render on Windows.
function Flag({ code, size = 14 }: { code: string; size?: number }) {
  const cc = CURRENCY_META[code]?.cc;
  if (!cc) return null;
  const w = Math.round(size * 4 / 3);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${cc}.png`}
      alt={code}
      className="inline-block rounded-[2px] object-cover shrink-0"
      style={{ width: w, height: size }}
    />
  );
}

function pctClass(v: number | null) {
  if (v == null) return 'text-gray-600';
  return v >= 0 ? 'text-up-text' : 'text-down-text';
}

function pctText(v: number | null) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function CurrenciesSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [historical, setHistorical] = useState<HistPoint[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

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
      const pts = data.points?.map(p => ({ date: p.date, close: p.rate })) ?? [];
      setHistorical(pts);
      setAverage(data.average ?? null);
      setDataMsg(dataAvailabilityMessage(pts, tf));
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

  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setDataMsg(null); }, [selected]);

  const selectedRate = rates.find(r => r.from === selected?.from && r.to === selected?.to);
  const dec = decimals(selectedRate?.rate ?? null);

  const dataOf = (from: string, to: string) =>
    rates.find(r => r.from === from && r.to === to) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-gray-400">USD &amp; EUR Currency Pairs</h2>
          <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">
            {CURRENCY_GROUPS.length} pairs · {CURRENCY_GROUPS.length * 2} directions
          </span>
        </div>
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
                  <Flag code={g.base} size={13} />
                  <span className="text-xs font-bold text-white">{g.base}</span>
                  <span className="text-gray-600 text-xs mx-0.5">⇄</span>
                  <Flag code={g.quote} size={13} />
                  <span className="text-xs font-bold text-white">{g.quote}</span>
                </div>
                {/* Both directions — a pair and its inverse, stacked */}
                {directions.map((dir, i) => {
                  const d = dataOf(dir.from, dir.to);
                  const rate = d?.rate ?? null;
                  const isSelected = selected?.from === dir.from && selected?.to === dir.to;
                  const prec = decimals(rate);
                  return (
                    <button
                      key={`${dir.from}/${dir.to}`}
                      onClick={() => setSelected({ from: dir.from, to: dir.to })}
                      className={clsx(
                        'w-full flex flex-col gap-1 px-3 py-2.5 transition-colors text-left',
                        i === 1 && 'border-t border-border/60',
                        isSelected ? 'bg-accent/15' : 'hover:bg-bg-hover',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[11px] text-gray-400">
                          <Flag code={dir.from} size={12} />
                          <span className="font-medium">{dir.from}</span>
                          <ArrowRight size={9} className="text-gray-600" />
                          <Flag code={dir.to} size={12} />
                          <span className="font-medium">{dir.to}</span>
                        </span>
                        <span className={clsx('text-sm font-bold tabular-nums',
                          isSelected ? 'text-accent' : 'text-white')}>
                          {rate != null ? rate.toFixed(prec) : 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] tabular-nums">
                        <span className="flex items-center gap-1">
                          <span className="text-gray-600 uppercase tracking-wide">1D</span>
                          <span className={clsx('font-semibold', pctClass(d?.change1d ?? null))}>
                            {pctText(d?.change1d ?? null)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-gray-600 uppercase tracking-wide">MTD</span>
                          <span className={clsx('font-semibold', pctClass(d?.mtd ?? null))}>
                            {pctText(d?.mtd ?? null)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-gray-600 uppercase tracking-wide">YTD</span>
                          <span className={clsx('font-semibold', pctClass(d?.ytd ?? null))}>
                            {pctText(d?.ytd ?? null)}
                          </span>
                        </span>
                      </div>
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
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-white flex items-center gap-1.5">
                <Flag code={selected.from} size={16} />
                {selected.from}
                <span className="text-gray-500">/</span>
                <Flag code={selected.to} size={16} />
                {selected.to}
              </h3>
              {selectedRate?.rate != null && (
                <span className="text-2xl font-bold text-accent">
                  {selectedRate.rate.toFixed(dec)}
                </span>
              )}
              {onCompare && (
                <button
                  onClick={() => onCompare(`${selected.from}${selected.to}=X`)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
                >
                  <BarChart2 size={13} />
                  Compare
                </button>
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

          {dataMsg && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
              ⚠ {dataMsg}
            </p>
          )}

          <div className="flex gap-4 flex-wrap">
            {selectedRate?.change1d != null && (
              <div className="bg-bg-input rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">Daily Change</p>
                <p className={clsx('text-sm font-bold', pctClass(selectedRate.change1d))}>
                  {pctText(selectedRate.change1d)}
                </p>
              </div>
            )}
            {selectedRate?.ytd != null && (
              <div className="bg-bg-input rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">YTD</p>
                <p className={clsx('text-sm font-bold', pctClass(selectedRate.ytd))}>
                  {pctText(selectedRate.ytd)}
                </p>
              </div>
            )}
            {average != null && (
              <div className="bg-bg-input rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">Period Average</p>
                <p className="text-sm font-bold text-gold">{average.toFixed(dec)}</p>
              </div>
            )}
            {average != null && selectedRate?.rate != null && (
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

          {histLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size={32} />
            </div>
          ) : (
            <PriceChart
              data={historical}
              color="#6366f1"
              height={240}
              isCurrency={true}
              toolsOverlay={activeTools}
            />
          )}
          {historical.length > 0 && (
            <ChartTools
              data={historical}
              activeTools={activeTools}
              onChange={setActiveTools}
              decimals={dec}
            />
          )}
          {historical.length > 0 && <ChartDataTable data={historical} unit={`${selected?.from}/${selected?.to}`} />}
          {selected && <ChartNotes chartId={`${selected.from}/${selected.to}`} />}
        </div>
      )}
    </div>
  );
}
