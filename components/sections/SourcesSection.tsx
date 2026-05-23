'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, CheckCircle2, XCircle, Loader2, Trash2, Plus, Edit2, Check, X, Eye, EyeOff, Download, Upload, Link2, FlaskConical, ChevronDown, ChevronRight } from 'lucide-react';
import { MACRO_INDICATORS, INDEXES, CRYPTO_IDS, COMMODITIES, SECTORS, CURRENCY_GROUPS, ALL_COMPARABLE_ASSETS } from '@/lib/config';
import { useGistData, AnalysisEntry, todayStr, makeId } from '@/lib/gist';
import { AssetSearchInput } from '@/components/ui/AssetSearchInput';
import {
  loadSourcesConfig, saveSourcesConfig, generateId, notifySourcesChanged,
  saveToHash, loadFromHash,
  type SourcesConfig, type CustomSource,
} from '@/lib/userSources';
import clsx from 'clsx';

// ─────────────────────────────────────────────────────────────────────────────
// Data-type helpers
// ─────────────────────────────────────────────────────────────────────────────

// Series that have a SNAPSHOT_FALLBACK in the backend (approximate last-known
// values used when FRED and DBnomics both fail).
const SNAPSHOT_IDS = new Set([
  'HOUST', 'M2SL', 'WALCL', 'DRCLACBS', 'DRALACBN', 'DRCRELEXFACBS', 'BOGZ1FA673065500Q',
]);
// Series that have a hardcoded table as last-resort fallback (not snapshots —
// these are policy tables that rarely change between updates).
const HARDCODED_FALLBACK_IDS = new Set(['DFEDTARU', 'ECBDFR', 'FEDFUNDS']);
// Event-calendar series: dates are in the source code, not fetched from an API.
const EVENT_CALENDAR_IDS = new Set(['FOMC_MEETINGS', 'BTC_HALVING']);

interface DataTypeInfo { label: string; color: 'green' | 'blue' | 'amber' | 'gray' }

function getDataType(id: string, sourceType: string): DataTypeInfo {
  if (EVENT_CALENDAR_IDS.has(id)) {
    return id === 'BTC_HALVING'
      ? { label: 'Dynamic (block height) + hardcoded past', color: 'amber' }
      : { label: 'Event calendar — hardcoded 2000-2026, update yearly', color: 'amber' };
  }
  if (HARDCODED_FALLBACK_IDS.has(id)) return { label: 'Live + hardcoded fallback table', color: 'blue' };
  if (SNAPSHOT_IDS.has(id))          return { label: 'Live + snapshot fallback (2025-08)', color: 'blue' };
  if (sourceType === 'computed')      return { label: 'Computed (server-side formula)', color: 'green' };
  return { label: 'Live — auto-updates', color: 'green' };
}

function DataTypeBadge({ id, sourceType }: { id: string; sourceType: string }) {
  const dt = getDataType(id, sourceType);
  const colors: Record<DataTypeInfo['color'], string> = {
    green: 'bg-emerald-900/40 text-emerald-400',
    blue:  'bg-blue-900/40 text-blue-300',
    amber: 'bg-amber-900/40 text-amber-400',
    gray:  'bg-gray-800 text-gray-400',
  };
  return (
    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap', colors[dt.color])}
      title={dt.label}>
      {dt.color === 'green' ? '🟢' : dt.color === 'blue' ? '🔵' : '🟡'} {dt.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'error' | 'loading' | 'idle';
interface StatusInfo { status: Status; message: string; pts: number }

function StatusBadge({ info }: { info?: StatusInfo }) {
  if (!info || info.status === 'idle') return <span className="text-gray-600 text-[10px]">—</span>;
  if (info.status === 'loading') return <Loader2 size={13} className="animate-spin text-gray-500" />;
  if (info.status === 'ok') {
    return (
      <span className="flex items-center gap-1 text-emerald-400 text-[11px] font-semibold" title={info.message || undefined}>
        <CheckCircle2 size={13} /> {info.pts > 0 ? `${info.pts} pts` : info.message || 'ok'}
      </span>
    );
  }
  if (info.status === 'warn') {
    return (
      <span className="flex items-start gap-1 text-amber-400 text-[11px] max-w-[220px]" title={info.message}>
        <span className="shrink-0">⚠</span>
        <span className="leading-tight">{info.message}</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1 text-red-400 text-[11px] max-w-[220px]" title={info.message}>
      <XCircle size={13} className="shrink-0 mt-px" />
      <span className="leading-tight">{info.message || 'Error'}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-macro asset sections (read-only info — Indexes, FX, Crypto, Commodities, Sectors)
// ─────────────────────────────────────────────────────────────────────────────

interface AssetRow { symbol: string; name: string; category: string; provider: string; type: string }

const NON_MACRO_SECTIONS: { title: string; count: string; provider: string; rows: AssetRow[] }[] = [
  {
    title: 'Indexes & ETFs',
    count: `${INDEXES.length} series`,
    provider: 'Yahoo Finance (live)',
    rows: INDEXES.map(i => ({ symbol: i.symbol, name: i.name, category: i.category, provider: 'Yahoo Finance', type: i.type })),
  },
  {
    title: 'Currencies (FX)',
    count: `${CURRENCY_GROUPS.length} pairs · ${CURRENCY_GROUPS.length * 2} directions`,
    provider: 'Yahoo Finance (live)',
    rows: CURRENCY_GROUPS.map(g => ({
      symbol: `${g.base}${g.quote}=X`,
      name: `${g.base}/${g.quote}`,
      category: 'FX',
      provider: 'Yahoo Finance',
      type: 'currency',
    })),
  },
  {
    title: 'Cryptocurrencies',
    count: `${CRYPTO_IDS.length} coins`,
    provider: 'CoinGecko (live) · Yahoo Finance fallback',
    rows: CRYPTO_IDS.map(c => ({ symbol: `${c.symbol}-USD`, name: c.name, category: 'Crypto', provider: 'CoinGecko / Yahoo Finance', type: 'crypto' })),
  },
  {
    title: 'Commodities',
    count: `${COMMODITIES.length} series`,
    provider: 'Yahoo Finance (live)',
    rows: COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, category: c.category, provider: 'Yahoo Finance', type: 'commodity' })),
  },
  {
    title: 'Sectors (US ETFs)',
    count: `${SECTORS.length} ETFs`,
    provider: 'Yahoo Finance (live)',
    rows: SECTORS.map(s => ({ symbol: s.symbol, name: s.name, category: s.category, provider: 'Yahoo Finance', type: 'sector' })),
  },
];

function NonMacroSection({ section }: { section: typeof NON_MACRO_SECTIONS[0] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover/20 transition text-left"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
          <span className="text-sm font-medium text-gray-200">{section.title}</span>
          <span className="text-[10px] text-gray-500 bg-bg-input px-2 py-0.5 rounded-full border border-border">{section.count}</span>
        </div>
        <span className="text-[11px] text-gray-500 font-mono">{section.provider}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-4 py-1.5 font-semibold">Symbol</th>
                <th className="text-left px-4 py-1.5 font-semibold">Name</th>
                <th className="text-left px-4 py-1.5 font-semibold">Category</th>
                <th className="text-left px-4 py-1.5 font-semibold">Provider</th>
                <th className="text-left px-4 py-1.5 font-semibold">Data</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(r => (
                <tr key={r.symbol} className="border-t border-border hover:bg-bg-hover/20">
                  <td className="px-4 py-1.5 font-mono text-gray-300">{r.symbol}</td>
                  <td className="px-4 py-1.5 text-gray-100">{r.name}</td>
                  <td className="px-4 py-1.5 text-gray-400">{r.category}</td>
                  <td className="px-4 py-1.5 text-gray-500">{r.provider}</td>
                  <td className="px-4 py-1.5">
                    <span className="bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded text-[10px]">🟢 Live — auto-updates</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculation formulas
// ─────────────────────────────────────────────────────────────────────────────

const FORMULAS = [
  { label: 'Total return (with dividends)',
    body: 'Each dividend on its ex-date scales the subsequent series by (1 + dividend / close_on_ex_date).' },
  { label: 'CAGR',
    body: 'CAGR = (P_end / P_start)^(1/years) − 1 over the visible window.' },
  { label: 'IRR',
    body: 'Solves NPV=0 over dated cashflows. Newton–Raphson with bisection fallback. Annualised.' },
  { label: 'Correlation matrix',
    body: 'Pearson correlation of daily log-returns on the union of dates with forward-fill.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_CUSTOM: Omit<CustomSource, 'id'> = { name: '', category: 'Growth', unit: 'idx', url: '' };

// Group macro indicators by category for display
const MACRO_CATEGORIES = [
  'Rates', 'Inflation', 'Growth', 'Employment', 'Real Estate', 'Money',
  'Commodities', 'Sentiment', 'Crypto', 'Debt', 'Market Value', 'Recessions',
];

const totalSources =
  MACRO_INDICATORS.length + INDEXES.length + CURRENCY_GROUPS.length + CRYPTO_IDS.length +
  COMMODITIES.length + SECTORS.length;

export function SourcesSection() {
  const [config, setConfig] = useState<SourcesConfig>({ overrides: {}, custom: [], hidden: [] });
  const [statuses, setStatuses] = useState<Record<string, StatusInfo>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newInd, setNewInd] = useState<Omit<CustomSource, 'id'>>(BLANK_CUSTOM);
  const [checkingAll, setCheckingAll] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(MACRO_CATEGORIES));

  useEffect(() => {
    setMounted(true);
    const fromHash = loadFromHash();
    const cfg = fromHash ?? loadSourcesConfig();
    setConfig(cfg);
    if (fromHash) saveSourcesConfig(fromHash);
    else saveToHash(cfg);
  }, []);

  const persist = useCallback((next: SourcesConfig) => {
    setConfig(next);
    saveSourcesConfig(next);
    saveToHash(next);
    notifySourcesChanged();
  }, []);

  const startEdit = (id: string, currentUrl: string) => { setEditingId(id); setEditUrl(currentUrl); };

  const commitEdit = (id: string, isBuiltin: boolean) => {
    const url = editUrl.trim();
    if (!url) { setEditingId(null); return; }
    if (isBuiltin) {
      persist({ ...config, overrides: { ...config.overrides, [id]: url } });
    } else {
      persist({ ...config, custom: config.custom.map(c => c.id === id ? { ...c, url } : c) });
    }
    setEditingId(null);
  };

  const clearOverride = (id: string) => {
    const overrides = { ...config.overrides };
    delete overrides[id];
    persist({ ...config, overrides });
  };

  const deleteCustom = (id: string) => {
    persist({ ...config, custom: config.custom.filter(c => c.id !== id) });
    const next = { ...statuses };
    delete next[id];
    setStatuses(next);
  };

  const toggleHide = (id: string) => {
    const hidden = config.hidden ?? [];
    const next = hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id];
    persist({ ...config, hidden: next });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'macro-sources.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string) as Partial<SourcesConfig>;
        persist({
          overrides: (typeof parsed.overrides === 'object' && parsed.overrides !== null) ? parsed.overrides as Record<string,string> : {},
          custom: Array.isArray(parsed.custom) ? parsed.custom : [],
          hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
        });
      } catch { /* invalid file */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addCustom = () => {
    if (!newInd.name.trim() || !newInd.url.trim()) return;
    const entry: CustomSource = { id: generateId(), ...newInd, name: newInd.name.trim(), url: newInd.url.trim() };
    persist({ ...config, custom: [...config.custom, entry] });
    setNewInd(BLANK_CUSTOM);
    setShowAdd(false);
  };

  // ── Pipeline status check ─────────────────────────────────────────────────
  // When a series has a snapshot or event-calendar fallback, "No data from
  // live source" is expected in some environments — show a warning (amber)
  // instead of an error (red) so it's clear the data IS available in the app.
  const checkOne = useCallback(async (id: string, url: string, isBuiltinNoOverride: boolean) => {
    setStatuses(s => ({ ...s, [id]: { status: 'loading', message: '', pts: 0 } }));
    const from18 = new Date(); from18.setMonth(from18.getMonth() - 18);
    const fromStr = from18.toISOString().slice(0, 10);
    try {
      if (isBuiltinNoOverride) {
        const res = await fetch(`/api/macro?mode=history&id=${id}&from=${fromStr}`);
        const json = await res.json() as unknown[];
        const pts = Array.isArray(json) ? json.length : 0;
        if (pts > 0) {
          setStatuses(s => ({ ...s, [id]: { status: 'ok', message: '', pts } }));
        } else if (EVENT_CALENDAR_IDS.has(id)) {
          setStatuses(s => ({ ...s, [id]: { status: 'ok', message: 'Event calendar — always available', pts: 1 } }));
        } else if (SNAPSHOT_IDS.has(id)) {
          setStatuses(s => ({ ...s, [id]: { status: 'warn', message: 'Live source unavailable — snapshot fallback active in app', pts: 0 } }));
        } else if (HARDCODED_FALLBACK_IDS.has(id)) {
          setStatuses(s => ({ ...s, [id]: { status: 'warn', message: 'Live source unavailable — hardcoded fallback active in app', pts: 0 } }));
        } else {
          setStatuses(s => ({ ...s, [id]: { status: 'error', message: 'No data from pipeline', pts: 0 } }));
        }
      } else {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}&from=${fromStr}`);
        const json = await res.json() as { success: boolean; data: unknown[]; message: string };
        setStatuses(s => ({
          ...s,
          [id]: { status: json.success ? 'ok' : 'error', message: json.message, pts: json.data?.length ?? 0 },
        }));
      }
    } catch (e) {
      setStatuses(s => ({ ...s, [id]: { status: 'error', message: String(e), pts: 0 } }));
    }
  }, []);

  const hiddenSet = new Set(mounted ? (config.hidden ?? []) : []);

  const allIndicators = mounted ? [
    ...MACRO_INDICATORS.map(m => ({
      id: m.id, name: m.name, category: m.category, unit: m.unit,
      sourceLabel: m.source.label, sourceType: m.source.type,
      defaultUrl: m.source.url, effectiveUrl: config.overrides[m.id] ?? m.source.url,
      isBuiltin: true, isOverridden: !!config.overrides[m.id], isHidden: hiddenSet.has(m.id),
    })),
    ...config.custom.map(c => ({
      id: c.id, name: c.name, category: c.category, unit: c.unit,
      sourceLabel: 'Custom', sourceType: 'url',
      defaultUrl: c.url, effectiveUrl: c.url,
      isBuiltin: false, isOverridden: false, isHidden: false,
    })),
  ] : MACRO_INDICATORS.map(m => ({
    id: m.id, name: m.name, category: m.category, unit: m.unit,
    sourceLabel: m.source.label, sourceType: m.source.type,
    defaultUrl: m.source.url, effectiveUrl: m.source.url,
    isBuiltin: true, isOverridden: false, isHidden: false,
  }));

  const checkAll = async () => {
    if (!mounted) return;
    setCheckingAll(true);
    await Promise.all(allIndicators.map(ind =>
      checkOne(ind.id, ind.effectiveUrl, ind.isBuiltin && !ind.isOverridden)
    ));
    setCheckingAll(false);
  };

  const sourceTypeBadge = (t: string) => {
    const map: Record<string, string> = {
      fred: 'bg-blue-900/60 text-blue-300', ecb: 'bg-purple-900/60 text-purple-300',
      bls: 'bg-green-900/60 text-green-300', treasury: 'bg-sky-900/60 text-sky-300',
      fomc: 'bg-orange-900/60 text-orange-300',
      yahoo_price: 'bg-red-900/60 text-red-300', yahoo_ratio: 'bg-red-900/60 text-red-300',
      multpl: 'bg-pink-900/60 text-pink-300', url: 'bg-gray-700/60 text-gray-300',
    };
    return map[t] ?? 'bg-gray-700/60 text-gray-300';
  };

  const toggleCat = (cat: string) => setOpenCats(prev => {
    const next = new Set(prev);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    return next;
  });

  // Custom indicators (user-added) — always shown in their own group
  const customIndicators = allIndicators.filter(i => !i.isBuiltin);

  const macroByCategory = MACRO_CATEGORIES.map(cat => ({
    cat,
    inds: allIndicators.filter(i => i.isBuiltin && i.category === cat),
  })).filter(g => g.inds.length > 0);

  const renderIndicatorRow = (ind: typeof allIndicators[0]) => {
    const isEditing = editingId === ind.id;
    const st = statuses[ind.id];
    return (
      <tr key={ind.id}
        className={clsx(
          'border-t border-border align-middle transition-colors',
          ind.isHidden ? 'opacity-50 hover:opacity-70' : 'hover:bg-bg-hover/20',
        )}>
        <td className="px-3 py-2">
          <div className="font-medium text-gray-100 flex items-center gap-1.5">
            {ind.name}
            {ind.isHidden && <span className="text-[9px] text-gray-600 border border-gray-700 rounded px-1">hidden</span>}
          </div>
          <div className="text-[10px] text-gray-600 font-mono">{ind.id}</div>
        </td>
        <td className="px-3 py-2">
          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-mono', sourceTypeBadge(ind.sourceType))}>
            {ind.sourceType}
          </span>
        </td>
        <td className="px-3 py-2 min-w-[260px]">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input autoFocus value={editUrl} onChange={e => setEditUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(ind.id, ind.isBuiltin); if (e.key === 'Escape') setEditingId(null); }}
                className="flex-1 bg-bg border border-accent rounded px-2 py-1 text-[11px] text-gray-100 focus:outline-none font-mono" />
              <button onClick={() => commitEdit(ind.id, ind.isBuiltin)} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
              <button onClick={() => setEditingId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group">
              <span className={clsx('font-mono text-[10px] truncate max-w-[220px]', ind.isOverridden ? 'text-yellow-400' : 'text-gray-400')}>
                {ind.effectiveUrl}
              </span>
              {ind.isOverridden && <span className="text-[9px] text-yellow-600 shrink-0">(overridden)</span>}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <DataTypeBadge id={ind.id} sourceType={ind.sourceType} />
        </td>
        <td className="px-3 py-2 whitespace-nowrap"><StatusBadge info={st} /></td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {!isEditing && (
              <button onClick={() => startEdit(ind.id, ind.effectiveUrl)} title="Edit URL"
                className="p-1 text-gray-500 hover:text-gray-200 transition"><Edit2 size={12} /></button>
            )}
            <button onClick={() => checkOne(ind.id, ind.effectiveUrl, ind.isBuiltin && !ind.isOverridden)}
              title="Test this source" className="p-1 text-gray-500 hover:text-sky-400 transition"><CheckCircle2 size={12} /></button>
            <a href={ind.effectiveUrl} target="_blank" rel="noopener noreferrer"
              className="p-1 text-gray-500 hover:text-accent transition"><ExternalLink size={12} /></a>
            {ind.isOverridden && (
              <button onClick={() => clearOverride(ind.id)} title="Reset to default"
                className="p-1 text-yellow-600 hover:text-yellow-400 transition text-[10px] font-semibold">↺</button>
            )}
            {ind.isBuiltin && (
              <button onClick={() => toggleHide(ind.id)}
                title={ind.isHidden ? 'Show in Macro tab' : 'Hide from Macro tab'}
                className={clsx('p-1 transition', ind.isHidden ? 'text-gray-600 hover:text-gray-300' : 'text-gray-500 hover:text-yellow-400')}>
                {ind.isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
            {!ind.isBuiltin && (
              <button onClick={() => deleteCustom(ind.id)} title="Delete custom indicator"
                className="p-1 text-gray-600 hover:text-red-400 transition"><Trash2 size={12} /></button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const tableHead = (
    <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px] sticky top-0">
      <tr>
        <th className="text-left px-3 py-2 font-semibold">Indicator</th>
        <th className="text-left px-3 py-2 font-semibold">Source type</th>
        <th className="text-left px-3 py-2 font-semibold min-w-[260px]">Source URL</th>
        <th className="text-left px-3 py-2 font-semibold min-w-[200px]">Data</th>
        <th className="text-left px-3 py-2 font-semibold">Pipeline</th>
        <th className="text-left px-3 py-2 font-semibold">Actions</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-4">

      {/* ── Legend ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-card px-4 py-3 flex flex-wrap gap-4 items-center text-[11px] text-gray-400">
        <span className="font-semibold text-gray-200 mr-2">
          Total: {totalSources} series
          {mounted && config.custom.length > 0 && ` + ${config.custom.length} custom`}
        </span>
        <span><span className="text-emerald-400">🟢 Live</span> — fetched from API on every request, auto-updates</span>
        <span><span className="text-blue-300">🔵 Live + fallback</span> — live API first; hardcoded snapshot if API fails</span>
        <span><span className="text-amber-400">🟡 Event calendar</span> — dates stored in source code, need manual update when new events are published</span>
      </div>

      {/* ── Macro Indicator Sources ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 py-3 bg-bg-input border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-100">Macro Indicators</h3>
              <span className="text-[10px] text-gray-500 bg-bg px-2 py-0.5 rounded-full border border-border">
                {MACRO_INDICATORS.length} built-in{mounted && config.custom.length > 0 ? ` + ${config.custom.length} custom` : ''}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Edit any URL to override where data is fetched from. Add custom indicators that appear in the Macro tab.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={checkAll} disabled={checkingAll}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5 disabled:opacity-50">
              {checkingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Check all
            </button>
            <button onClick={() => { navigator.clipboard.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }); }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5"
              title="Copy shareable URL with your config">
              {linkCopied ? <Check size={12} className="text-emerald-400" /> : <Link2 size={12} />}
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
            <button onClick={handleExport}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5">
              <Download size={12} /> Export
            </button>
            <label className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5 cursor-pointer">
              <Upload size={12} /> Import
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
            <button onClick={() => setShowAdd(v => !v)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent/80 transition flex items-center gap-1.5">
              <Plus size={12} /> Add indicator
            </button>
          </div>
        </div>

        {/* Add indicator form */}
        {showAdd && (
          <div className="px-4 py-3 border-b border-border bg-bg-input/40 flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Name</label>
              <input value={newInd.name} onChange={e => setNewInd(v => ({ ...v, name: e.target.value }))}
                placeholder="e.g. Gold Price" className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-32 focus:outline-none focus:border-accent" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Category</label>
              <input value={newInd.category} onChange={e => setNewInd(v => ({ ...v, category: e.target.value }))}
                placeholder="Growth" className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-24 focus:outline-none focus:border-accent" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Unit</label>
              <select value={newInd.unit} onChange={e => setNewInd(v => ({ ...v, unit: e.target.value as CustomSource['unit'] }))}
                className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent">
                {(['%', 'idx', 'K', 'B$'] as const).map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                Source URL <span className="normal-case text-gray-600">(FRED series page, Yahoo quote, CSV/JSON/HTML)</span>
              </label>
              <input value={newInd.url} onChange={e => setNewInd(v => ({ ...v, url: e.target.value }))}
                placeholder="https://fred.stlouisfed.org/series/DXY or any URL"
                className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-full focus:outline-none focus:border-accent" />
            </div>
            <div className="flex gap-1.5">
              <button onClick={addCustom} disabled={!newInd.name.trim() || !newInd.url.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white disabled:opacity-40 transition">Add</button>
              <button onClick={() => { setShowAdd(false); setNewInd(BLANK_CUSTOM); }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-400 hover:text-gray-200 transition">Cancel</button>
            </div>
          </div>
        )}

        {/* Category-grouped macro table */}
        {macroByCategory.map(({ cat, inds }) => (
          <div key={cat}>
            <button
              onClick={() => toggleCat(cat)}
              className="w-full flex items-center gap-2 px-4 py-2 bg-bg-input/50 border-t border-border hover:bg-bg-hover/20 transition text-left"
            >
              {openCats.has(cat)
                ? <ChevronDown size={12} className="text-gray-500 shrink-0" />
                : <ChevronRight size={12} className="text-gray-500 shrink-0" />}
              <span className="text-xs font-semibold text-gray-300">{cat}</span>
              <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border ml-1">
                {inds.length}
              </span>
              {/* Show warning if any in this category have non-live status */}
              {inds.some(i => EVENT_CALENDAR_IDS.has(i.id)) && (
                <span className="text-[10px] text-amber-500 ml-auto">⚠ contains event calendar</span>
              )}
            </button>
            {openCats.has(cat) && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">{tableHead}<tbody>{inds.map(renderIndicatorRow)}</tbody></table>
              </div>
            )}
          </div>
        ))}

        {/* Custom indicators */}
        {customIndicators.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-4 py-2 bg-bg-input/50 border-t border-border">
              <span className="text-xs font-semibold text-gray-300">Custom (user-added)</span>
              <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border">{customIndicators.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">{tableHead}<tbody>{customIndicators.map(renderIndicatorRow)}</tbody></table>
            </div>
          </div>
        )}

        <div className="px-4 py-2 border-t border-border text-[10px] text-gray-600">
          URL formats supported: FRED series pages, Yahoo Finance quotes, any CSV/JSON endpoint, HTML tables.
          Changes take effect immediately — Macro tab auto-refreshes.
        </div>

        {mounted && (config.custom.length > 0 || Object.keys(config.overrides).length > 0) && (
          <div className="px-4 py-2 border-t border-border bg-amber-950/20 text-[10px] text-amber-400/80 flex items-center gap-1.5">
            <Link2 size={11} className="shrink-0" />
            Your config is encoded in the current URL.{' '}
            <button className="underline hover:text-amber-300 transition"
              onClick={() => { navigator.clipboard.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }); }}>
              {linkCopied ? 'Copied!' : 'Bookmark or copy this link'}
            </button>
            {' '}to preserve custom indicators across Vercel deployments.
          </div>
        )}
      </div>

      {/* ── Non-macro asset sections (Indexes, FX, Crypto, Commodities, Sectors) ── */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 py-3 bg-bg-input border-b border-border">
          <h3 className="text-sm font-semibold text-gray-100">Market Data Sources</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            All live — fetched from Yahoo Finance / CoinGecko on every request. No override or pipeline test needed.
          </p>
        </div>
        {NON_MACRO_SECTIONS.map(s => <NonMacroSection key={s.title} section={s} />)}
      </div>

      {/* ── Calculation conventions ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-100">Calculation conventions</h3>
        <ul className="space-y-2 text-xs text-gray-300">
          {FORMULAS.map((f, i) => (
            <li key={i}>
              <p className="text-gray-100 font-medium">{f.label}</p>
              <p className="text-gray-400 mt-0.5">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Troubleshooting ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-100">Troubleshooting</h3>
        <ul className="space-y-1.5 text-xs text-gray-300 list-disc pl-5">
          <li>
            <span className="text-gray-100 font-medium">🟡 Event calendar (FOMC Meetings, BTC Halvings):</span>{' '}
            Dates are stored in the source code. Pipeline test always shows OK. Update the code when the Fed publishes the next-year calendar (November) or after each halving.
          </li>
          <li>
            <span className="text-gray-100 font-medium">🔵 Snapshot fallback (HOUST, M2SL, WALCL, delinquency series):</span>{' '}
            Pipeline test shows ⚠ "snapshot fallback active" when FRED is rate-limited (common on mobile). The app still shows values — they come from the last-known snapshot (2025-08). Cards update automatically when FRED becomes reachable again.
          </li>
          <li>
            <span className="text-gray-100 font-medium">Red error for a FRED series:</span>{' '}
            Edit the URL to the direct FRED CSV:{' '}
            <code className="font-mono text-accent">https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES</code>
          </li>
          <li>
            <span className="text-gray-100 font-medium">Custom URL returns no data:</span>{' '}
            The scraper tries JSON → CSV → HTML table. Make sure the URL returns a table with date + number columns, or a direct CSV/JSON.
          </li>
        </ul>
      </div>

      {/* ── Analysis Notes ─────────────────────────────────────────────── */}
      <AnalysisTable />

      <p className="text-[10px] text-gray-700">All data fetched from public endpoints. Not financial advice.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis table (unchanged logic)
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_ANALYSIS = { var1: '', var1Name: '', var2: '', var2Name: '', result: '' };

function getVarDisplayName(symbol: string, savedName?: string): string {
  if (savedName) return savedName;
  const preset = ALL_COMPARABLE_ASSETS.find(a => a.symbol === symbol);
  if (preset) return preset.name;
  const macro = MACRO_INDICATORS.find(m => m.id === symbol);
  if (macro) return macro.name;
  return symbol;
}

function AnalysisTable() {
  const { data, update } = useGistData();
  const analyses: AnalysisEntry[] = data.analyses ?? [];
  const [form, setForm] = useState(BLANK_ANALYSIS);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(BLANK_ANALYSIS);

  const saveNew = async () => {
    if (!form.var1 || !form.result.trim()) return;
    const entry: AnalysisEntry = { id: makeId(), var1: form.var1, var1Name: form.var1Name || undefined, var2: form.var2, var2Name: form.var2Name || undefined, result: form.result.trim(), date: todayStr() };
    await update({ analyses: [...analyses, entry] });
    setForm(BLANK_ANALYSIS);
  };

  const deleteEntry = async (id: string) => {
    await update({ analyses: analyses.filter(a => a.id !== id) });
  };

  const startEdit = (a: AnalysisEntry) => {
    setEditId(a.id);
    setEditForm({ var1: a.var1, var1Name: a.var1Name ?? '', var2: a.var2, var2Name: a.var2Name ?? '', result: a.result });
  };

  const commitEdit = async () => {
    if (!editId) return;
    const updated = analyses.map(a =>
      a.id === editId
        ? { ...a, var1: editForm.var1, var1Name: editForm.var1Name || undefined, var2: editForm.var2, var2Name: editForm.var2Name || undefined, result: editForm.result.trim(), date: todayStr() }
        : a
    );
    await update({ analyses: updated });
    setEditId(null);
  };

  return (
    <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
      <div className="px-4 py-3 bg-bg-input border-b border-border flex items-center gap-2">
        <FlaskConical size={14} className="text-accent shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Analysis Notes</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Save observations linking two assets or indicators. Synced to GitHub Gist.</p>
        </div>
      </div>
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Variable 1 *</label>
            <AssetSearchInput value={form.var1} displayName={form.var1Name} onChange={(sym, name) => setForm(v => ({ ...v, var1: sym, var1Name: name }))} placeholder="Search asset or indicator…" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Variable 2</label>
            <AssetSearchInput value={form.var2} displayName={form.var2Name} onChange={(sym, name) => setForm(v => ({ ...v, var2: sym, var2Name: name }))} placeholder="Search (optional)…" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Observation / Result *</label>
            <input value={form.result} onChange={e => setForm(v => ({ ...v, result: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveNew(); }}
              placeholder="e.g. Strong negative correlation when rates rise above 5%"
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-full focus:outline-none focus:border-accent" />
          </div>
          <button onClick={saveNew} disabled={!form.var1 || !form.result.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition shrink-0">
            <Plus size={12} /> Save
          </button>
        </div>
        <p className="text-[10px] text-gray-600">Date is set automatically to today.</p>
      </div>
      {analyses.length === 0 ? (
        <div className="px-4 py-4 text-xs text-gray-600 italic">No analyses saved yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Date</th>
                <th className="text-left px-3 py-2 font-semibold">Variable 1</th>
                <th className="text-left px-3 py-2 font-semibold">Variable 2</th>
                <th className="text-left px-3 py-2 font-semibold min-w-[200px]">Observation</th>
                <th className="text-left px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...analyses].reverse().map(a => {
                const isEditing = editId === a.id;
                const name1 = getVarDisplayName(a.var1, a.var1Name);
                const name2 = a.var2 ? getVarDisplayName(a.var2, a.var2Name) : '';
                return (
                  <tr key={a.id} className="border-t border-border align-top hover:bg-bg-hover/20">
                    <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">{a.date}</td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <AssetSearchInput value={editForm.var1} displayName={editForm.var1Name} onChange={(sym, name) => setEditForm(v => ({ ...v, var1: sym, var1Name: name }))} placeholder="Search…" />
                      ) : (
                        <div><p className="font-medium text-gray-100">{name1}</p><p className="text-[10px] text-gray-600 font-mono">{a.var1}</p></div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <AssetSearchInput value={editForm.var2} displayName={editForm.var2Name} onChange={(sym, name) => setEditForm(v => ({ ...v, var2: sym, var2Name: name }))} placeholder="Search (optional)…" />
                      ) : a.var2 ? (
                        <div><p className="font-medium text-gray-100">{name2}</p><p className="text-[10px] text-gray-600 font-mono">{a.var2}</p></div>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      {isEditing ? (
                        <input value={editForm.result} onChange={e => setEditForm(v => ({ ...v, result: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                          className="bg-bg border border-accent rounded px-2 py-1 text-[11px] text-gray-100 focus:outline-none w-full" autoFocus />
                      ) : <p className="text-gray-200 leading-relaxed">{a.result}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <><button onClick={commitEdit} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
                          <button onClick={() => setEditId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button></>
                        ) : (
                          <><button onClick={() => startEdit(a)} className="p-1 text-gray-500 hover:text-gray-300"><Edit2 size={12} /></button>
                          <button onClick={() => deleteEntry(a.id)} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button></>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
