'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, CheckCircle2, XCircle, Loader2, Trash2, Plus, Edit2, Check, X, Eye, EyeOff } from 'lucide-react';
import { MACRO_INDICATORS } from '@/lib/config';
import {
  loadSourcesConfig, saveSourcesConfig, generateId, notifySourcesChanged,
  type SourcesConfig, type CustomSource,
} from '@/lib/userSources';
import clsx from 'clsx';

type Status = 'ok' | 'error' | 'loading' | 'idle';

interface StatusInfo { status: Status; message: string; pts: number }

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ info }: { info?: StatusInfo }) {
  if (!info || info.status === 'idle') {
    return <span className="text-gray-600 text-[10px]">—</span>;
  }
  if (info.status === 'loading') {
    return <Loader2 size={13} className="animate-spin text-gray-500" />;
  }
  if (info.status === 'ok') {
    return (
      <span className="flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
        <CheckCircle2 size={13} /> {info.pts} pts
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-red-400 text-[11px]" title={info.message}>
      <XCircle size={13} /> Error
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulas / notes (unchanged from original)
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

const BLANK_CUSTOM: Omit<CustomSource, 'id'> = {
  name: '', category: 'Growth', unit: 'idx', url: '',
};

export function SourcesSection() {
  const [config, setConfig] = useState<SourcesConfig>({ overrides: {}, custom: [], hidden: [] });
  const [statuses, setStatuses] = useState<Record<string, StatusInfo>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newInd, setNewInd] = useState<Omit<CustomSource, 'id'>>(BLANK_CUSTOM);
  const [checkingAll, setCheckingAll] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConfig(loadSourcesConfig());
  }, []);

  // ── Save helpers ──────────────────────────────────────────────────────────

  const persist = useCallback((next: SourcesConfig) => {
    setConfig(next);
    saveSourcesConfig(next);
    notifySourcesChanged();
  }, []);

  // ── Inline edit ───────────────────────────────────────────────────────────

  const startEdit = (id: string, currentUrl: string) => {
    setEditingId(id);
    setEditUrl(currentUrl);
  };

  const commitEdit = (id: string, isBuiltin: boolean) => {
    const url = editUrl.trim();
    if (!url) { setEditingId(null); return; }
    if (isBuiltin) {
      const next = { ...config, overrides: { ...config.overrides, [id]: url } };
      persist(next);
    } else {
      const next = {
        ...config,
        custom: config.custom.map(c => c.id === id ? { ...c, url } : c),
      };
      persist(next);
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
    const next = hidden.includes(id)
      ? hidden.filter(h => h !== id)
      : [...hidden, id];
    persist({ ...config, hidden: next });
  };

  // ── Add custom indicator ──────────────────────────────────────────────────

  const addCustom = () => {
    if (!newInd.name.trim() || !newInd.url.trim()) return;
    const entry: CustomSource = { id: generateId(), ...newInd, name: newInd.name.trim(), url: newInd.url.trim() };
    persist({ ...config, custom: [...config.custom, entry] });
    setNewInd(BLANK_CUSTOM);
    setShowAdd(false);
  };

  // ── Live status check ─────────────────────────────────────────────────────

  // sourceType distinguishes how to check each indicator:
  // - 'fred' built-ins → /api/scrape (Node.js, reaches DBnomics reliably)
  // - all other built-ins → /api/macro (Edge, handles ECB/BLS/Treasury/Yahoo natively)
  // - overridden/custom → /api/scrape with the effective URL
  const checkOne = useCallback(async (id: string, url: string, isBuiltinNoOverride: boolean, sourceType?: string) => {
    setStatuses(s => ({ ...s, [id]: { status: 'loading', message: '', pts: 0 } }));
    const from18 = new Date(); from18.setMonth(from18.getMonth() - 18);
    const fromStr = from18.toISOString().slice(0, 10);
    try {
      if (isBuiltinNoOverride && sourceType === 'fred') {
        // FRED indicators fail from Edge (DBnomics unreachable) — use Node.js scrape route
        // url = m.source.url = "https://fred.stlouisfed.org/series/ID", scrape detects FRED ID
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}&from=${fromStr}`);
        const json = await res.json() as { success: boolean; data: unknown[]; message: string };
        setStatuses(s => ({
          ...s,
          [id]: { status: json.success ? 'ok' : 'error', message: json.message, pts: json.data?.length ?? 0 },
        }));
      } else if (isBuiltinNoOverride) {
        // ECB, BLS, Treasury, FOMC, Yahoo: use /api/macro native pipeline
        const res = await fetch(`/api/macro?mode=history&id=${id}&from=${fromStr}`);
        const json = await res.json() as unknown[];
        const pts = Array.isArray(json) ? json.length : 0;
        setStatuses(s => ({
          ...s,
          [id]: { status: pts > 0 ? 'ok' : 'error', message: pts > 0 ? '' : 'No data from pipeline', pts },
        }));
      } else {
        // Overridden/custom URL: use universal scraper
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

  const checkAll = async () => {
    if (!mounted) return;
    setCheckingAll(true);
    await Promise.all(allIndicators.map(ind =>
      checkOne(ind.id, ind.effectiveUrl, ind.isBuiltin && !ind.isOverridden, ind.sourceType)
    ));
    setCheckingAll(false);
  };

  // ── Combined indicator list ───────────────────────────────────────────────

  const hiddenSet = new Set(mounted ? (config.hidden ?? []) : []);

  const allIndicators = mounted ? [
    ...MACRO_INDICATORS.map(m => ({
      id: m.id,
      name: m.name,
      category: m.category,
      unit: m.unit,
      sourceLabel: m.source.label,
      sourceType: m.source.type,
      defaultUrl: m.source.url,
      effectiveUrl: config.overrides[m.id] ?? m.source.url,
      isBuiltin: true,
      isOverridden: !!config.overrides[m.id],
      isHidden: hiddenSet.has(m.id),
    })),
    ...config.custom.map(c => ({
      id: c.id,
      name: c.name,
      category: c.category,
      unit: c.unit,
      sourceLabel: 'Custom',
      sourceType: 'url',
      defaultUrl: c.url,
      effectiveUrl: c.url,
      isBuiltin: false,
      isOverridden: false,
      isHidden: false,
    })),
  ] : MACRO_INDICATORS.map(m => ({
    id: m.id, name: m.name, category: m.category, unit: m.unit,
    sourceLabel: m.source.label, sourceType: m.source.type,
    defaultUrl: m.source.url, effectiveUrl: m.source.url,
    isBuiltin: true, isOverridden: false, isHidden: false,
  }));

  const sourceTypeBadge = (t: string) => {
    const map: Record<string, string> = {
      fred: 'bg-blue-900/60 text-blue-300',
      ecb:  'bg-purple-900/60 text-purple-300',
      bls:  'bg-green-900/60 text-green-300',
      treasury: 'bg-sky-900/60 text-sky-300',
      fomc: 'bg-orange-900/60 text-orange-300',
      yahoo_price: 'bg-red-900/60 text-red-300',
      yahoo_ratio: 'bg-red-900/60 text-red-300',
      url:  'bg-gray-700/60 text-gray-300',
    };
    return map[t] ?? 'bg-gray-700/60 text-gray-300';
  };

  return (
    <div className="space-y-4">

      {/* ── Macro Indicator Sources ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 py-3 bg-bg-input border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Macro Data Sources</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Edit any URL to override where data is fetched from.
              Add custom indicators that appear directly in the Macro tab.
              The scraper handles FRED series pages, Yahoo Finance quotes,
              CSV files, JSON APIs, and HTML tables automatically.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={checkAll} disabled={checkingAll}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5 disabled:opacity-50">
              {checkingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Check all sources
            </button>
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
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white disabled:opacity-40 transition">
                Add
              </button>
              <button onClick={() => { setShowAdd(false); setNewInd(BLANK_CUSTOM); }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-400 hover:text-gray-200 transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Indicator</th>
                <th className="text-left px-3 py-2 font-semibold">Cat.</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold min-w-[260px]">Source URL</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-left px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allIndicators.map(ind => {
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
                        {ind.isHidden && (
                          <span className="text-[9px] text-gray-600 border border-gray-700 rounded px-1">hidden</span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-600 font-mono">{ind.id}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{ind.category}</td>
                    <td className="px-3 py-2">
                      <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-mono', sourceTypeBadge(ind.sourceType))}>
                        {ind.sourceType}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-[260px]">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editUrl}
                            onChange={e => setEditUrl(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitEdit(ind.id, ind.isBuiltin);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="flex-1 bg-bg border border-accent rounded px-2 py-1 text-[11px] text-gray-100 focus:outline-none font-mono"
                          />
                          <button onClick={() => commitEdit(ind.id, ind.isBuiltin)}
                            className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
                          <button onClick={() => setEditingId(null)}
                            className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <span className={clsx('font-mono text-[10px] truncate max-w-[220px]',
                            ind.isOverridden ? 'text-yellow-400' : 'text-gray-400')}>
                            {ind.effectiveUrl}
                          </span>
                          {ind.isOverridden && (
                            <span className="text-[9px] text-yellow-600 shrink-0">(overridden)</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusBadge info={st} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {!isEditing && (
                          <button onClick={() => startEdit(ind.id, ind.effectiveUrl)}
                            title="Edit URL" className="p-1 text-gray-500 hover:text-gray-200 transition">
                            <Edit2 size={12} />
                          </button>
                        )}
                        <button onClick={() => checkOne(ind.id, ind.effectiveUrl, ind.isBuiltin && !ind.isOverridden, ind.sourceType)}
                          title="Test this source" className="p-1 text-gray-500 hover:text-sky-400 transition">
                          <CheckCircle2 size={12} />
                        </button>
                        <a href={ind.effectiveUrl} target="_blank" rel="noopener noreferrer"
                          className="p-1 text-gray-500 hover:text-accent transition">
                          <ExternalLink size={12} />
                        </a>
                        {ind.isOverridden && (
                          <button onClick={() => clearOverride(ind.id)}
                            title="Reset to default" className="p-1 text-yellow-600 hover:text-yellow-400 transition text-[10px] font-semibold">
                            ↺
                          </button>
                        )}
                        {ind.isBuiltin && (
                          <button onClick={() => toggleHide(ind.id)}
                            title={ind.isHidden ? 'Show in Macro tab' : 'Hide from Macro tab'}
                            className={clsx('p-1 transition', ind.isHidden ? 'text-gray-600 hover:text-gray-300' : 'text-gray-500 hover:text-yellow-400')}>
                            {ind.isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        )}
                        {!ind.isBuiltin && (
                          <button onClick={() => deleteCustom(ind.id)}
                            title="Delete custom indicator" className="p-1 text-gray-600 hover:text-red-400 transition">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-gray-600">
          URL formats supported: FRED series pages (fred.stlouisfed.org/series/ID), Yahoo Finance quotes
          (finance.yahoo.com/quote/SYMBOL), any CSV/JSON endpoint, and HTML pages with data tables.
          Changes take effect immediately — Macro tab auto-refreshes.
        </div>
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
            <span className="text-gray-100 font-medium">Macro indicator shows no data:</span>{' '}
            Click <em>Check all sources</em> above to see which sources are failing.
            Edit the URL to a working alternative (e.g. paste the FRED series CSV URL directly).
          </li>
          <li>
            <span className="text-gray-100 font-medium">FRED blocked on Vercel:</span>{' '}
            The macro API uses DBnomics as a mirror automatically.
            If DBnomics also fails, override the URL to the direct FRED CSV:
            {' '}<code className="font-mono text-accent">https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES</code>
          </li>
          <li>
            <span className="text-gray-100 font-medium">Custom URL returns no data:</span>{' '}
            The scraper tries JSON → CSV → HTML table in order.
            Make sure the page contains a visible table with date + number columns,
            or that the URL returns a CSV/JSON directly.
          </li>
          <li>
            <span className="text-gray-100 font-medium">S&P 500 heatmap is gray:</span>{' '}
            Yahoo Finance P/E data is loaded via the /api/sp500 route (Node.js, 60s timeout).
            Refresh the General tab; it may take 15–30 s on first load.
          </li>
        </ul>
      </div>

      <p className="text-[10px] text-gray-700">
        All data is fetched from public endpoints. Not financial advice.
      </p>
    </div>
  );
}
