'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { HistoricalPoint, Timeframe } from '@/lib/types';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { DetailModal } from '@/components/ui/DetailModal';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { ReturnsTableButton } from '@/components/ui/ReturnsTableButton';
import { TimeframeSelector } from '@/components/ui/TimeframeSelector';
import { summarizeTools } from '@/lib/toolsSummary';
import { LoadingGrid } from '@/components/ui/LoadingSpinner';
import { IMF_INDICATORS, IMF_INDICATOR_BY_CODE, fmtImf, type ImfUnit } from '@/lib/imfConfig';
import { colorForPercent, formatPercent, calculateCAGR, getTimeframeStart } from '@/lib/utils';
import { X, RefreshCw, Globe, BarChart2 } from 'lucide-react';
import clsx from 'clsx';

// Annual data → only the multi-year windows make sense.
const TF_OPTIONS: Timeframe[] = ['3Y', '5Y', '10Y', 'MAX'];

interface Place { code: string; name: string; aggregate: boolean }
interface IndicatorData { series: HistoricalPoint[]; latest: number | null; latestYear: string | null }
interface CountryData { code: string; indicators: Record<string, IndicatorData> }

function changeStr(d: number, unit: ImfUnit): string {
  const s = d >= 0 ? '+' : '';
  switch (unit) {
    case '%':
    case '% of GDP': return `${s}${d.toFixed(2)} pp`;
    case 'USD':      return `${s}$${Math.round(d).toLocaleString('en-US')}`;
    case 'USD bn':   return `${s}$${d.toFixed(1)}B`;
    case 'M people': return `${s}${d.toFixed(2)}M`;
  }
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-input rounded-lg px-2.5 py-1.5">
      <p className="text-[9px] text-gray-500 mb-0.5 truncate">{label}</p>
      <p className={clsx('text-[13px] font-bold tabular-nums truncate', color ?? 'text-gray-100')}>{value}</p>
    </div>
  );
}

export function MacroWorldSection({ jumpTo, onCompare }: { jumpTo?: string | null; onCompare?: (symbol: string) => void }) {
  const [countries, setCountries] = useState<Place[]>([]);
  const [country, setCountry] = useState('USA');
  const [data, setData] = useState<CountryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);       // indicator code
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);
  const [timeframe, setTimeframe] = useState<Timeframe>('MAX');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    fetch('/api/worldbank?mode=countries')
      .then(r => r.json())
      .then((j) => { if (Array.isArray(j)) setCountries(j); })
      .catch(() => {});
  }, []);

  const fetchCountry = useCallback(async (code: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/worldbank?mode=country&country=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (json?.error || !json?.indicators) { setError('Could not load data for this country. Try Refresh.'); setData(null); }
      else setData(json as CountryData);
    } catch { setError('Network error — could not reach the data service.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCountry(country); }, [country, fetchCountry]);
  useEffect(() => { setActiveTools(DEFAULT_TOOLS); setTimeframe('MAX'); setCustomRange(null); }, [selected, country]);

  // Deep-link from the section notes: "imf:USA:NY.GDP.MKTP.KD.ZG".
  useEffect(() => {
    if (!jumpTo) return;
    const m = /^imf:([A-Z]{3}):(.+)$/.exec(jumpTo);
    if (m) { setCountry(m[1]); setSelected(m[2]); }
  }, [jumpTo]);

  const countryName = countries.find(c => c.code === country)?.name ?? country;
  const sel = selected ? IMF_INDICATOR_BY_CODE.get(selected) : null;
  const fullSeries = (selected ? data?.indicators[selected]?.series : null) ?? [];

  // Slice the annual series to the chosen window (client-side — the full series is already loaded).
  const series = useMemo(() => {
    if (!fullSeries.length) return fullSeries;
    if (customRange) return fullSeries.filter(p => p.date >= customRange.from && p.date <= customRange.to);
    if (timeframe === 'MAX') return fullSeries;
    const start = getTimeframeStart(timeframe);
    return fullSeries.filter(p => p.date >= start);
  }, [fullSeries, timeframe, customRange]);

  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const cagr = series.length > 1 ? calculateCAGR(series, timeframe) : null;
  const realCountries = countries.filter(c => !c.aggregate);
  const aggregates = countries.filter(c => c.aggregate);

  return (
    <div className="space-y-3">
      {/* Country selector */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-gray-500" />
          <select
            value={country}
            onChange={e => { setSelected(null); setCountry(e.target.value); }}
            className="bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 outline-none focus:border-accent max-w-[240px]"
          >
            {countries.length === 0 && <option value="USA">United States</option>}
            {aggregates.length > 0 && (
              <optgroup label="Regions & groups">
                {aggregates.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </optgroup>
            )}
            {realCountries.length > 0 && (
              <optgroup label="Countries">
                {realCountries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
          <span className="text-[10px] text-gray-600">World Bank · annual</span>
        </div>
        <button onClick={() => fetchCountry(country)} className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {error && <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">⚠ {error}</p>}

      {loading && !data ? (
        <LoadingGrid count={IMF_INDICATORS.length} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {IMF_INDICATORS.map(ind => {
            const d = data?.indicators[ind.code];
            const isPct = ind.unit === '%' || ind.unit === '% of GDP';
            const valColor = isPct && d?.latest != null ? colorForPercent(ind.higherBetter ? d.latest : -d.latest) : 'text-gray-100';
            return (
              <button
                key={ind.code}
                onClick={() => d?.series.length && setSelected(ind.code)}
                disabled={!d?.series.length}
                className={clsx(
                  'text-left rounded-xl border border-border bg-bg-card p-3 transition-all',
                  d?.series.length ? 'hover:border-accent/50 hover:bg-border/20 cursor-pointer' : 'opacity-50 cursor-not-allowed',
                )}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <p className="text-xs font-semibold text-gray-200 truncate">{ind.name}</p>
                  <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-border text-gray-500">{ind.category}</span>
                </div>
                <p className={clsx('text-lg font-bold tabular-nums', valColor)}>{fmtImf(d?.latest, ind.unit)}</p>
                <p className="text-[10px] text-gray-600">{d?.latestYear ?? ''} · {ind.unit}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal — same structure ("mascherina") as the Macro section */}
      {selected && sel && (
        <DetailModal onClose={() => setSelected(null)}>
          <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">{countryName} — {sel.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5"><span className="font-mono">{sel.code}</span> · {sel.category} · Unit: {sel.unit} · World Bank</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onCompare && (
                  <button
                    onClick={() => onCompare(`WB:${country}:${sel.code}`)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors text-xs font-medium"
                  >
                    <BarChart2 size={13} /> Compare
                  </button>
                )}
                <ReturnsTableButton name={`${countryName} — ${sel.name}`} symbol={`${country}:${sel.code}`} externalData={fullSeries} defaultGran="Yearly" />
                <GeminiCommentButton
                  key={`${country}:${sel.code}`}
                  name={`${countryName} — ${sel.name}`}
                  symbol={`${country}:${sel.code}`}
                  assetClass="Macro (country)"
                  timeframe={customRange ? 'Custom' : timeframe}
                  tools={series.length ? summarizeTools(activeTools, series) : undefined}
                />
                <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300" aria-label="Close"><X size={16} /></button>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
              <TimeframeSelector
                value={timeframe}
                onChange={tf => { setCustomRange(null); setTimeframe(tf); }}
                options={TF_OPTIONS}
                isCustom={!!customRange}
                onCustomRange={(from, to) => setCustomRange({ from, to })}
              />
            </div>

            {/* Stats row */}
            {latest && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                <Stat label="Latest" value={`${fmtImf(latest.close, sel.unit)}${latest.date ? ` (${latest.date.slice(0, 4)})` : ''}`} />
                {prev && <Stat label="Previous" value={fmtImf(prev.close, sel.unit)} />}
                {prev && (
                  <Stat label="Change" value={changeStr(latest.close - prev.close, sel.unit)}
                    color={colorForPercent(sel.higherBetter ? latest.close - prev.close : prev.close - latest.close)} />
                )}
                {cagr && (
                  <Stat label={`Change (${customRange ? 'Custom' : timeframe})`} value={formatPercent(cagr.return)}
                    color={colorForPercent(sel.higherBetter ? cagr.return : -cagr.return)} />
                )}
              </div>
            )}

            {series.length > 1 ? (
              <PriceChart data={series} color="auto" height={220} toolsOverlay={activeTools}
                onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No series for this window.</div>
            )}

            {series.length > 0 && <ChartTools data={series} activeTools={activeTools} onChange={setActiveTools} />}
            {series.length > 0 && <ChartDataTable data={series} unit={sel.unit} />}
            <ChartNotes chartId={`imf:${country}:${sel.code}`} defaultCategory="Macro World" />
          </div>
        </DetailModal>
      )}
    </div>
  );
}
