'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
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
import {
  IMF_INDICATORS, IMF_INDICATOR_BY_CODE, fmtImf, type ImfUnit,
  isPrincipalAggregate, principalAggregateOrder,
  IMF_SUMMARY_GROUPS, IMF_SUMMARY_INDICATORS,
} from '@/lib/imfConfig';
import { colorForPercent, formatPercent, calculateCAGR, getTimeframeStart, extendToToday } from '@/lib/utils';
import { X, RefreshCw, Globe, BarChart2 } from 'lucide-react';
import clsx from 'clsx';

// Same timeframe scale used everywhere else in the app. Data is annual, so the
// sub-year windows simply show few/no points — but the selector stays consistent.
const TF_OPTIONS: Timeframe[] = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];

interface Place { code: string; name: string; aggregate: boolean }
interface IndicatorData { series: HistoricalPoint[]; latest: number | null; latestYear: string | null }
interface CountryData { code: string; indicators: Record<string, IndicatorData> }
type SummaryMap = Record<string, Record<string, { value: number; year: string }>>;

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
  const [placeMode, setPlaceMode] = useState<'countries' | 'regions'>('countries');
  const [summary, setSummary] = useState<SummaryMap | null>(null);
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
    fetch('/api/worldbank?mode=summary')
      .then(r => r.json())
      .then((j) => { if (j && !j.error) setSummary(j as SummaryMap); })
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
  // Keep the Countries/Regions toggle in sync with the current place.
  useEffect(() => {
    const inList = countries.find(c => c.code === country);
    const isAgg = inList ? inList.aggregate : isPrincipalAggregate(country);
    setPlaceMode(isAgg ? 'regions' : 'countries');
  }, [country, countries]);
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
  // Only the principal aggregates (drop the ~40 IDA/IBRD/demographic buckets), in curated order.
  const aggregates = countries
    .filter(c => c.aggregate && isPrincipalAggregate(c.code))
    .sort((a, b) => principalAggregateOrder(a.code) - principalAggregateOrder(b.code));
  const pickList = placeMode === 'regions' ? aggregates : realCountries;

  return (
    <div className="space-y-3">
      {/* Country selector — Countries vs Regions & groups on separate toggles */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Globe size={14} className="text-gray-500 shrink-0" />
          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {(['countries', 'regions'] as const).map(m => (
              <button
                key={m}
                onClick={() => setPlaceMode(m)}
                className={clsx(
                  'px-2.5 py-1.5 text-xs font-medium transition-colors',
                  placeMode === m ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100',
                )}
              >
                {m === 'countries' ? 'Countries' : 'Regions & groups'}
              </button>
            ))}
          </div>
          <select
            value={pickList.some(c => c.code === country) ? country : ''}
            onChange={e => { if (e.target.value) { setSelected(null); setCountry(e.target.value); } }}
            className="bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 outline-none focus:border-accent max-w-[240px]"
          >
            {countries.length === 0 && <option value="USA">United States</option>}
            {!pickList.some(c => c.code === country) && (
              <option value="" disabled>{placeMode === 'regions' ? 'Select a region…' : 'Select a country…'}</option>
            )}
            {pickList.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
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

      {/* Macro-area summary board — headline economies & aggregates side by side */}
      <SummaryBoard summary={summary} activeCode={country} onPick={code => { setSelected(null); setCountry(code); }} />

      {/* Detail modal — same structure ("mascherina") as the Macro section */}
      {selected && sel && (
        <DetailModal onClose={() => setSelected(null)}>
          <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
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
              // Carry the last published year forward to today (World Bank lags ~1-2y),
              // so the line reaches "now" instead of stopping at the last data year —
              // except on a custom range, where the end date must be respected exactly.
              <PriceChart data={customRange ? series : extendToToday(series)} color="auto" height={220} toolsOverlay={activeTools}
                onSetRange={(from, to) => { setCustomRange(null); setCustomRange({ from, to }); }} />
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No series for this window.</div>
            )}

            {series.length > 0 && <ChartTools data={series} activeTools={activeTools} onChange={setActiveTools} />}
            {series.length > 0 && <ChartDataTable data={series} unit={sel.unit} />}
            <ChartNotes
              chartId={`imf:${country}:${sel.code}`}
              defaultCategory="Macro World"
              captureView={() => ({ tools: { ...activeTools } as Record<string, boolean>, timeframe, customRange })}
              onRestoreView={v => {
                if (v.tools) setActiveTools({ ...DEFAULT_TOOLS, ...(v.tools as Partial<ActiveTools>) });
                if (v.timeframe) setTimeframe(v.timeframe as Timeframe);
                setCustomRange(v.customRange ?? null);
              }}
            />
          </div>
        </DetailModal>
      )}
    </div>
  );
}

// Compact per-indicator column labels for the summary board.
const SUMMARY_COL_LABELS: Record<string, string> = {
  'NY.GDP.MKTP.KD.ZG': 'GDP Growth',
  'NY.GDP.MKTP.CD': 'GDP ($)',
  'NY.GDP.PCAP.CD': 'GDP/capita',
  'FP.CPI.TOTL.ZG': 'Inflation',
  'SL.UEM.TOTL.ZS': 'Unemploy.',
  'FR.INR.RINR': 'Real Rate',
  'BN.CAB.XOKA.GD.ZS': 'Curr. Acct',
  'GC.DOD.TOTL.GD.ZS': 'Debt/GDP',
};

// ─────────────────────────────────────────────────────────────────────────────
// Macro-area summary board. Headline economies (China & Japan distinct) and key
// aggregates (Euro area, World) grouped by region, compared across a few key
// indicators. Latest available value per cell; click a row to open that place.
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBoard({ summary, activeCode, onPick }: {
  summary: SummaryMap | null;
  activeCode: string;
  onPick: (code: string) => void;
}) {
  if (!summary) return null;
  const cols = IMF_SUMMARY_INDICATORS.map(code => {
    const ind = IMF_INDICATOR_BY_CODE.get(code);
    const unit = ind?.unit ?? '%';
    return {
      code,
      label: SUMMARY_COL_LABELS[code] ?? ind?.name ?? code,
      higherBetter: ind?.higherBetter ?? true,
      unit,
      scale: ind?.scale ?? 1,
      // Only ratio columns (%, % of GDP) get green/red — absolute $ figures stay neutral.
      colored: unit === '%' || unit === '% of GDP',
    };
  });

  return (
    <div className="rounded-xl border border-border bg-bg-card p-3 sm:p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-100">Macro-area snapshot</h3>
        <span className="text-[10px] text-gray-500">Latest available · World Bank · click a row to open</span>
      </div>
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <table className="w-full text-xs border-separate border-spacing-0 min-w-[760px]">
          <thead>
            <tr>
              <th className="text-left font-semibold text-gray-400 px-2 py-1.5 sticky left-0 bg-bg-card z-10">Economy</th>
              {cols.map(c => (
                <th key={c.code} className="text-right font-semibold text-gray-400 px-2 py-1.5 whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IMF_SUMMARY_GROUPS.map(group => (
              <Fragment key={group.region}>
                <tr>
                  <td colSpan={cols.length + 1} className="px-2 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                    {group.region}
                  </td>
                </tr>
                {group.places.map(p => {
                  const row = summary[p.code];
                  const isActive = p.code === activeCode;
                  return (
                    <tr
                      key={p.code}
                      onClick={() => onPick(p.code)}
                      className={clsx('cursor-pointer transition-colors', isActive ? 'bg-accent/10' : 'hover:bg-border/20')}
                    >
                      <td className={clsx('px-2 py-1.5 whitespace-nowrap sticky left-0 z-10', isActive ? 'bg-accent/10 text-accent font-semibold' : 'bg-bg-card text-gray-200')}>
                        {p.name}
                      </td>
                      {cols.map(c => {
                        const cell = row?.[c.code];
                        const val = cell ? cell.value / c.scale : null;
                        const color = val == null ? 'text-gray-600'
                          : c.colored ? colorForPercent(c.higherBetter ? val : -val)
                          : 'text-gray-200';
                        return (
                          <td key={c.code} title={cell ? `${cell.year}` : 'no data'}
                            className={clsx('text-right px-2 py-1.5 tabular-nums whitespace-nowrap', color)}>
                            {val == null ? '—' : fmtImf(val, c.unit as ImfUnit)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-600 leading-snug">
        Ratio columns are coloured (GDP Growth &amp; Current Account green = higher; Inflation, Unemployment, Real Rate, Debt green = lower); absolute $ figures stay neutral. Values are the latest year each source has published (hover a cell for the year). Some cells read “—” where the World Bank has no recent figure for that country.
      </p>
    </div>
  );
}
