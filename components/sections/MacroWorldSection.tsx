'use client';

import { useState, useEffect, useCallback } from 'react';
import { HistoricalPoint } from '@/lib/types';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChartTools, ActiveTools, DEFAULT_TOOLS } from '@/components/ui/ChartTools';
import { ChartDataTable } from '@/components/ui/ChartDataTable';
import { ChartNotes } from '@/components/ui/ChartNotes';
import { DetailModal } from '@/components/ui/DetailModal';
import { GeminiCommentButton } from '@/components/ui/GeminiCommentButton';
import { summarizeTools } from '@/lib/toolsSummary';
import { LoadingGrid, LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IMF_INDICATORS, IMF_INDICATOR_BY_CODE, fmtImf } from '@/lib/imfConfig';
import { colorForPercent } from '@/lib/utils';
import { X, RefreshCw, Globe } from 'lucide-react';
import clsx from 'clsx';

interface IndicatorData { series: HistoricalPoint[]; latest: number | null; latestYear: string | null }
interface CountryData { code: string; name: string; indicators: Record<string, IndicatorData> }

export function MacroWorldSection() {
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [country, setCountry] = useState('USA');
  const [data, setData] = useState<CountryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);       // indicator code
  const [activeTools, setActiveTools] = useState<ActiveTools>(DEFAULT_TOOLS);

  // Country list (once).
  useEffect(() => {
    fetch('/api/imf?mode=countries')
      .then(r => r.json())
      .then((j) => { if (Array.isArray(j)) setCountries(j); })
      .catch(() => {});
  }, []);

  const fetchCountry = useCallback(async (code: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/imf?mode=country&country=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (json?.error || !json?.indicators) { setError('Could not load IMF data for this country.'); setData(null); }
      else setData(json as CountryData);
    } catch { setError('Network error — could not reach the IMF data service.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCountry(country); }, [country, fetchCountry]);
  useEffect(() => { setActiveTools(DEFAULT_TOOLS); }, [selected, country]);

  const sel = selected ? IMF_INDICATOR_BY_CODE.get(selected) : null;
  const selData = selected ? data?.indicators[selected] : null;
  const selSeries = selData?.series ?? [];

  return (
    <div className="space-y-3">
      {/* Country selector + note */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-gray-500" />
          <select
            value={country}
            onChange={e => { setSelected(null); setCountry(e.target.value); }}
            className="bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 outline-none focus:border-accent max-w-[220px]"
          >
            {countries.length === 0 && <option value="USA">United States</option>}
            {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <span className="text-[10px] text-gray-600">IMF · World Economic Outlook · annual</span>
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
                <p className="text-[10px] text-gray-600">{d?.latestYear ? `${d.latestYear}` : ''} · {ind.unit}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal — same structure as the other sections */}
      {selected && sel && (
        <DetailModal onClose={() => setSelected(null)}>
          <div className="rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">{data?.name} — {sel.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="font-mono">{sel.code}</span> · {sel.unit} · IMF WEO (annual, incl. forecasts)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <GeminiCommentButton
                  key={`${country}:${sel.code}`}
                  name={`${data?.name} — ${sel.name}`}
                  symbol={`${country}:${sel.code}`}
                  assetClass="Macro (country)"
                  timeframe="annual"
                  tools={selSeries.length ? summarizeTools(activeTools, selSeries) : undefined}
                />
                <button onClick={() => setSelected(null)} className="p-1 text-gray-500 hover:text-gray-300" aria-label="Close"><X size={16} /></button>
              </div>
            </div>

            {selSeries.length > 1 ? (
              <PriceChart data={selSeries} color="auto" height={220} toolsOverlay={activeTools} />
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No IMF series for this indicator.</div>
            )}

            {selSeries.length > 0 && (
              <ChartTools data={selSeries} activeTools={activeTools} onChange={setActiveTools} />
            )}
            {selSeries.length > 0 && <ChartDataTable data={selSeries} unit={sel.unit} />}
            <ChartNotes chartId={`imf:${country}:${sel.code}`} defaultCategory="Macro World" />
          </div>
        </DetailModal>
      )}
    </div>
  );
}
