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
  IMF_INDICATORS, IMF_INDICATOR_BY_CODE, fmtImf, type ImfUnit, type ImfIndicator,
  isPrincipalAggregate, principalAggregateOrder,
  IMF_SUMMARY_GROUPS,
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
type Metric = { value: number; year: string } | null;
type ExtraMap = Record<string, { policyRate: Metric; gdpFcstCurr: Metric; gdpFcstNext: Metric; debt: Metric }>;
type CountryExtra = { policyRate: HistoricalPoint[]; gdpForecast: HistoricalPoint[]; debt: HistoricalPoint[]; buffett: HistoricalPoint[]; buffettIndex?: string | null };

// Extra per-country indicators (IMF IFS / WEO / FRED / Buffett) shown as openable
// cards next to the World Bank ones — each has a real time series so it opens a chart.
const EXTRA_SERIES_KEYS = ['policyRate', 'gdpForecast', 'debt', 'buffett'] as const;
const EXTRA_INDICATORS: (ImfIndicator & { seriesKey: typeof EXTRA_SERIES_KEYS[number] })[] = [
  { code: 'x:policyRate',  name: 'Interest Rate',         unit: '%',        category: 'Rates',     higherBetter: false, seriesKey: 'policyRate' },
  { code: 'x:gdpForecast', name: 'Real GDP Growth + Forecast', unit: '%',   category: 'Growth',    higherBetter: true,  seriesKey: 'gdpForecast' },
  { code: 'x:debt',        name: 'Govt Debt (IMF)',       unit: '% of GDP', category: 'Fiscal',    higherBetter: false, seriesKey: 'debt' },
  { code: 'x:buffett',     name: 'Buffett Indicator',     unit: 'ratio',    category: 'Valuation', higherBetter: false, seriesKey: 'buffett' },
];
const EXTRA_BY_CODE = new Map(EXTRA_INDICATORS.map(e => [e.code, e]));

function changeStr(d: number, unit: ImfUnit): string {
  const s = d >= 0 ? '+' : '';
  switch (unit) {
    case '%':
    case '% of GDP': return `${s}${d.toFixed(2)} pp`;
    case 'USD':      return `${s}$${Math.round(d).toLocaleString('en-US')}`;
    case 'USD bn':   return `${s}$${d.toFixed(1)}B`;
    case 'M people': return `${s}${d.toFixed(2)}M`;
    case 'ratio':    return `${s}${d.toFixed(2)}`;
    case 'index':    return `${s}${d.toFixed(1)}`;
  }
}

// Buffett-indicator colour (value = index/GDP vs its historical average, 1.0 = norm):
// cheap < 0.8 green, fair 0.8–1.2 neutral, 1.2–1.5 amber, > 1.5 red.
function buffettColor(v: number): string {
  if (v >= 1.5) return 'text-down-text';
  if (v >= 1.2) return 'text-amber-400';
  if (v < 0.8) return 'text-up-text';
  return 'text-gray-200';
}

// Gini index (income inequality): lower = more equal. <35 green, 35–45 amber, ≥45 red.
function giniColor(v: number): string {
  if (v >= 45) return 'text-down-text';
  if (v >= 35) return 'text-amber-400';
  return 'text-up-text';
}

// Govt debt / GDP: <100% green, 100–120% amber, >120% red.
function debtColor(v: number): string {
  if (v > 120) return 'text-down-text';
  if (v >= 100) return 'text-amber-400';
  return 'text-up-text';
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
  const [extra, setExtra] = useState<ExtraMap | null>(null);
  const [buffettMap, setBuffettMap] = useState<Record<string, { value: number; year: string }> | null>(null);
  const [data, setData] = useState<CountryData | null>(null);
  const [extraCountry, setExtraCountry] = useState<CountryExtra | null>(null);
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
    fetch('/api/macroworld-extra?mode=summary')
      .then(r => r.json())
      .then((j) => { if (j && !j.error) setExtra(j as ExtraMap); })
      .catch(() => {});
    // Buffett indicator (index ÷ real GDP) — separate/lazy so it never slows the board.
    fetch('/api/macroworld-extra?mode=buffett-summary')
      .then(r => r.json())
      .then((j) => { if (j && !j.error) setBuffettMap(j as Record<string, { value: number; year: string }>); })
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
  // Extra per-country series (policy rate, GDP forecast, IMF debt) — openable charts.
  useEffect(() => {
    setExtraCountry(null);
    fetch(`/api/macroworld-extra?mode=country&country=${encodeURIComponent(country)}`)
      .then(r => r.json())
      .then((j) => { if (j && !j.error) setExtraCountry(j as CountryExtra); })
      .catch(() => {});
  }, [country]);
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
  // The selected indicator may be a World Bank one OR an extra (IMF/FRED) one.
  const extraSel = selected ? EXTRA_BY_CODE.get(selected) : null;
  const sel = extraSel ?? (selected ? IMF_INDICATOR_BY_CODE.get(selected) : null);
  const fullSeries: HistoricalPoint[] = extraSel
    ? (extraCountry?.[extraSel.seriesKey] ?? [])
    : ((selected ? data?.indicators[selected]?.series : null) ?? []);

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

          {/* Extra indicators (IMF policy rate, WEO forecast & debt) — openable time charts */}
          {EXTRA_INDICATORS.map(e => {
            const s = extraCountry?.[e.seriesKey] ?? [];
            const last = s.length ? s[s.length - 1] : null;
            const isPct = e.unit === '%' || e.unit === '% of GDP';
            const neutral = e.code === 'x:policyRate';
            const valColor = e.code === 'x:buffett' && last ? buffettColor(last.close)
              : e.code === 'x:debt' && last ? debtColor(last.close)
              : !neutral && isPct && last ? colorForPercent(e.higherBetter ? last.close : -last.close)
              : 'text-gray-100';
            return (
              <button
                key={e.code}
                onClick={() => s.length && setSelected(e.code)}
                disabled={!s.length}
                className={clsx(
                  'text-left rounded-xl border bg-bg-card p-3 transition-all',
                  s.length ? 'border-emerald-500/25 hover:border-accent/50 hover:bg-border/20 cursor-pointer' : 'border-border opacity-50 cursor-not-allowed',
                )}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <p className="text-xs font-semibold text-gray-200 truncate">{e.name}</p>
                  <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400/80">{e.category}</span>
                </div>
                <p className={clsx('text-lg font-bold tabular-nums', valColor)}>{fmtImf(last?.close, e.unit)}</p>
                <p className="text-[10px] text-gray-600">{last ? last.date.slice(0, 4) : (extraCountry ? 'n/a' : '…')} · {e.unit}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Macro-area summary board — headline economies & aggregates side by side */}
      <SummaryBoard summary={summary} extra={extra} buffett={buffettMap} activeCode={country} onPick={code => { setSelected(null); setCountry(code); }} />

      {/* Detail modal — same structure ("mascherina") as the Macro section */}
      {selected && sel && (
        <DetailModal onClose={() => setSelected(null)}>
          <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">{countryName} — {sel.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {!extraSel && <><span className="font-mono">{sel.code}</span> · </>}
                  {sel.category} · Unit: {sel.unit} · {
                    !extraSel ? 'World Bank'
                    : extraSel.code === 'x:policyRate' ? 'IMF IFS · FRED'
                    : extraSel.code === 'x:buffett' ? `${extraCountry?.buffettIndex ?? 'index'} ÷ real GDP · indexed to historical avg (1.0)`
                    : 'IMF WEO'
                  }
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onCompare && (
                  <button
                    onClick={() => onCompare(extraSel ? `WBX:${country}:${extraSel.seriesKey}` : `WB:${country}:${sel.code}`)}
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
  'NY.GDP.MKTP.KD.ZG': 'Real GDP Gr.',
  'NY.GDP.MKTP.KD': 'GDP real ($)',
  'NY.GDP.PCAP.KD': 'GDP/cap. real',
  'FP.CPI.TOTL.ZG': 'Inflation',
  'SL.UEM.TOTL.ZS': 'Unemploy.',
  'BN.CAB.XOKA.GD.ZS': 'Curr. Acct',
  'GC.DOD.TOTL.GD.ZS': 'Debt/GDP',
  'SI.POV.GINI': 'Gini',
};

interface BoardCol {
  key: string; src: 'wb' | 'extra' | 'buffett'; label: string;
  unit: ImfUnit; higherBetter: boolean; scale: number; colored: boolean;
  colorMode?: 'band' | 'buffett' | 'gini' | 'debt'; // inflation / valuation / inequality / debt bands
  wbFallback?: string;
}
function wbCol(code: string, extra?: Partial<BoardCol>): BoardCol {
  const ind = IMF_INDICATOR_BY_CODE.get(code);
  const unit = (ind?.unit ?? '%') as ImfUnit;
  return {
    key: code, src: 'wb', label: SUMMARY_COL_LABELS[code] ?? ind?.name ?? code,
    unit, higherBetter: ind?.higherBetter ?? true, scale: ind?.scale ?? 1,
    colored: unit === '%' || unit === '% of GDP',
    ...extra,
  };
}
// Column order of the snapshot: World Bank actuals interleaved with the DBnomics
// extras (GDP forecast, central bank policy rate, WEO debt with a WB fallback).
const BOARD_COLUMNS: BoardCol[] = [
  wbCol('NY.GDP.MKTP.KD.ZG'),
  // Two forecast horizons — labels filled in dynamically from the data's own years.
  { key: 'gdpFcstCurr', src: 'extra', label: 'GDP fcst', unit: '%', higherBetter: true, scale: 1, colored: true },
  { key: 'gdpFcstNext', src: 'extra', label: 'GDP fcst', unit: '%', higherBetter: true, scale: 1, colored: true },
  wbCol('NY.GDP.MKTP.KD'),
  wbCol('NY.GDP.PCAP.KD'),
  wbCol('FP.CPI.TOTL.ZG', { colorMode: 'band' }), // inflation: healthy ~0-3%, not "lower = greener"
  wbCol('SL.UEM.TOTL.ZS'),
  // Central bank policy rate — left neutral (no "high/low is good" judgement).
  { key: 'policyRate', src: 'extra', label: 'Interest Rate', unit: '%', higherBetter: false, scale: 1, colored: false },
  wbCol('BN.CAB.XOKA.GD.ZS'),
  { key: 'debt', src: 'extra', label: 'Debt/GDP', unit: '% of GDP', higherBetter: false, scale: 1, colored: true, colorMode: 'debt', wbFallback: 'GC.DOD.TOTL.GD.ZS' },
  { key: 'buffett', src: 'buffett', label: 'Buffett', unit: 'ratio', higherBetter: false, scale: 1, colored: true, colorMode: 'buffett' },
  wbCol('SI.POV.GINI', { colored: true, colorMode: 'gini' }),
];

// Inflation colour: healthy near the ~2% target (0-3% green), elevated 3-6% amber,
// deflation (<0) or runaway (>6%) red. NOT a simple "lower is greener" scale.
function inflationColor(v: number): string {
  if (v < 0 || v > 6) return 'text-down-text';
  if (v > 3) return 'text-amber-400';
  return 'text-up-text';
}

// ─────────────────────────────────────────────────────────────────────────────
// Macro-area summary board. Headline economies (China & Japan distinct) and key
// aggregates (Euro area, World) grouped by region, compared across a few key
// indicators. Latest available value per cell; click a row to open that place.
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBoard({ summary, extra, buffett, activeCode, onPick }: {
  summary: SummaryMap | null;
  extra: ExtraMap | null;
  buffett: Record<string, { value: number; year: string }> | null;
  activeCode: string;
  onPick: (code: string) => void;
}) {
  // Click a column header to sort largest→smallest, then smallest→largest, then off.
  // (Declared before any early return so the Rules of Hooks are respected.)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  if (!summary) return null;

  // Forecast years vary over time (2026/2027 today, 2027/2028 next year), so the two
  // forecast column headers are derived from whatever years the WEO data carries.
  const fcYear = (key: 'gdpFcstCurr' | 'gdpFcstNext'): string => {
    if (extra) for (const v of Object.values(extra)) { const m = v[key]; if (m) return m.year; }
    return '';
  };
  const cols = BOARD_COLUMNS.map(c =>
    c.key === 'gdpFcstCurr' ? { ...c, label: `Real fcst ${fcYear('gdpFcstCurr') || 'now'}` }
    : c.key === 'gdpFcstNext' ? { ...c, label: `Real fcst ${fcYear('gdpFcstNext') || 'next'}` }
    : c,
  );

  // Resolve a cell's {value, year} for either a World Bank or an extra (DBnomics) column,
  // falling back to the World Bank figure for the WEO debt column when WEO has no value.
  const metricFor = (c: BoardCol, code: string): { value: number; year: string } | null => {
    if (c.src === 'wb') return summary[code]?.[c.key] ?? null;
    if (c.src === 'buffett') return buffett?.[code] ?? null;
    const m = extra?.[code]?.[c.key as 'policyRate' | 'gdpFcstCurr' | 'gdpFcstNext' | 'debt'] ?? null;
    if (m) return m;
    if (c.wbFallback) return summary[code]?.[c.wbFallback] ?? null;
    return null;
  };

  const toggleSort = (key: string) => setSort(s =>
    s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null);

  const sortedPlaces: { code: string; name: string }[] | null = (() => {
    if (!sort) return null;
    const col = cols.find(c => c.key === sort.key);
    if (!col) return null;
    return IMF_SUMMARY_GROUPS.flatMap(g => g.places)
      .map(p => { const cell = metricFor(col, p.code); return { p, v: cell ? cell.value / col.scale : null }; })
      .sort((a, b) => a.v == null ? 1 : b.v == null ? -1 : sort.dir === 'desc' ? b.v - a.v : a.v - b.v)
      .map(x => x.p);
  })();

  const renderRow = (p: { code: string; name: string }) => {
    const isActive = p.code === activeCode;
    return (
      <tr key={p.code} onClick={() => onPick(p.code)}
        className={clsx('cursor-pointer transition-colors', isActive ? 'bg-accent/10' : 'hover:bg-border/20')}>
        <td className={clsx('px-1.5 py-1 whitespace-nowrap sticky left-0 z-10', isActive ? 'bg-accent/10 text-accent font-semibold' : 'bg-bg-card text-gray-200')}>
          {p.name}
        </td>
        {cols.map(c => {
          const cell = metricFor(c, p.code);
          const val = cell ? cell.value / c.scale : null;
          const color = val == null ? 'text-gray-600'
            : c.colorMode === 'band' ? inflationColor(val)
            : c.colorMode === 'buffett' ? buffettColor(val)
            : c.colorMode === 'gini' ? giniColor(val)
            : c.colorMode === 'debt' ? debtColor(val)
            : c.colored ? colorForPercent(c.higherBetter ? val : -val)
            : 'text-gray-200';
          return (
            <td key={c.key} title={cell ? `${cell.year}` : 'no data'}
              className={clsx('text-right px-1.5 py-1 tabular-nums whitespace-nowrap', color)}>
              {val == null ? '—' : fmtImf(val, c.unit)}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-bg-card p-3 sm:p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-100">Macro-area snapshot</h3>
        <span className="text-[10px] text-gray-500">Latest available · click a row to open · click a column to sort</span>
      </div>
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <table className="w-full text-[11px] border-separate border-spacing-0 min-w-[900px]">
          <thead>
            <tr>
              <th className="text-left font-semibold text-gray-400 px-1.5 py-1 sticky left-0 bg-bg-card z-10">Economy</th>
              {cols.map(c => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className={clsx('text-right font-semibold px-1.5 py-1 whitespace-nowrap cursor-pointer select-none hover:text-gray-200',
                      active ? 'text-accent' : 'text-gray-400')}>
                    {c.label}{active ? (sort!.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedPlaces
              ? sortedPlaces.map(renderRow)
              : IMF_SUMMARY_GROUPS.map(group => (
                <Fragment key={group.region}>
                  <tr>
                    <td colSpan={cols.length + 1} className="px-1.5 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                      {group.region}
                    </td>
                  </tr>
                  {group.places.map(renderRow)}
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-600 leading-snug">
        <strong>GDP fcst</strong> = IMF WEO <strong>real GDP growth</strong> forecast, % (this year &amp; next, years in the headers) · <strong>Interest Rate</strong> = central bank policy rate · <strong>Debt/GDP</strong> = IMF WEO gross govt debt (World Bank fallback). Growth/forecast/current-account green = higher; unemployment/debt green = lower; <strong>inflation</strong> green ≈ 0-3% (healthy), amber 3-6%, red = deflation or &gt;6%; interest rate &amp; $ figures neutral. <strong>Buffett</strong> = country index ÷ real GDP, indexed to its own historical average (1.0 = norm): &lt;0.8 cheap (green), 0.8–1.2 fair, 1.2–1.5 rich (amber), &gt;1.5 strongly overvalued (red). <strong>Gini</strong> = income inequality (0–100): &lt;35 green, 35–45 amber, ≥45 red. Hover a cell for its year; “—” = no recent figure.
      </p>
    </div>
  );
}
