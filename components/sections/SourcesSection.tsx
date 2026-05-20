'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, CheckCircle2, XCircle, Loader2, Trash2, Plus, Edit2, Check, X, Eye, EyeOff, Download, Upload, Link2, FlaskConical } from 'lucide-react';
import { MACRO_INDICATORS } from '@/lib/config';
import { useGistData, AnalysisEntry, todayStr, makeId } from '@/lib/gist';
import {
  loadSourcesConfig, saveSourcesConfig, generateId, notifySourcesChanged,
  saveToHash, loadFromHash,
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
    <span className="flex items-start gap-1 text-red-400 text-[11px] max-w-[220px]" title={info.message}>
      <XCircle size={13} className="shrink-0 mt-px" />
      <span className="leading-tight">{info.message || 'Error'}</span>
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
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Hash takes priority: lets users share/bookmark a URL that contains their full config.
    // Falls back to localStorage for backward compat.
    const fromHash = loadFromHash();
    const cfg = fromHash ?? loadSourcesConfig();
    setConfig(cfg);
    if (fromHash) {
      // Sync hash config to localStorage so it's available without the hash
      saveSourcesConfig(fromHash);
    } else {
      // Encode current localStorage config into the URL hash for future bookmarking
      saveToHash(cfg);
    }
  }, []);

  // ── Save helpers ──────────────────────────────────────────────────────────

  const persist = useCallback((next: SourcesConfig) => {
    setConfig(next);
    saveSourcesConfig(next);
    saveToHash(next);
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

  // ── Export / Import config ────────────────────────────────────────────────
  // localStorage is domain-scoped: each Vercel preview URL gets its own storage.
  // Export/import lets users back up and restore their custom indicators.

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'macro-sources.json';
    a.click();
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
      } catch { /* invalid file, ignore */ }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset input so same file can be re-imported
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

  // How each indicator is tested:
  // - built-ins without an override → /api/macro (same pipeline the Macro tab
  //   uses; FRED goes through the JSON API key, which works — scraping the FRED
  //   website does not, since it blocks server-side requests)
  // - overridden/custom URLs → /api/scrape with the effective URL
  const checkOne = useCallback(async (id: string, url: string, isBuiltinNoOverride: boolean) => {
    setStatuses(s => ({ ...s, [id]: { status: 'loading', message: '', pts: 0 } }));
    const from18 = new Date(); from18.setMonth(from18.getMonth() - 18);
    const fromStr = from18.toISOString().slice(0, 10);
    try {
      if (isBuiltinNoOverride) {
        // FRED, ECB, BLS, Treasury, FOMC, Yahoo, computed: use /api/macro native pipeline
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
      checkOne(ind.id, ind.effectiveUrl, ind.isBuiltin && !ind.isOverridden)
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
          <div className="flex gap-2 flex-wrap">
            <button onClick={checkAll} disabled={checkingAll}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5 disabled:opacity-50">
              {checkingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Check all
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href).then(() => {
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2500);
                });
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5"
              title="Copy a URL that contains your config — bookmark or save it to restore after any deployment">
              {linkCopied ? <Check size={12} className="text-emerald-400" /> : <Link2 size={12} />}
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
            <button onClick={handleExport}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5"
              title="Download your custom sources as JSON — use Import to restore after a URL change">
              <Download size={12} /> Export
            </button>
            <label className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-300 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5 cursor-pointer"
              title="Restore a previously exported sources config">
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
                        <button onClick={() => checkOne(ind.id, ind.effectiveUrl, ind.isBuiltin && !ind.isOverridden)}
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

        {mounted && (config.custom.length > 0 || Object.keys(config.overrides).length > 0) && (
          <div className="px-4 py-2 border-t border-border bg-amber-950/20 text-[10px] text-amber-400/80 flex items-center gap-1.5">
            <Link2 size={11} className="shrink-0" />
            Your config is encoded in the current URL.{' '}
            <button
              className="underline hover:text-amber-300 transition"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href).then(() => {
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2500);
                });
              }}>
              {linkCopied ? 'Copied!' : 'Bookmark or copy this link'}
            </button>
            {' '}to preserve custom indicators across Vercel deployments.
          </div>
        )}
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

      {/* ── Analysis Notes ─────────────────────────────────────────────── */}
      <AnalysisTable />

      <p className="text-[10px] text-gray-700">
        All data is fetched from public endpoints. Not financial advice.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis table — save observations linking two macro indicators
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_ANALYSIS = { var1: '', var2: '', result: '' };

function AnalysisTable() {
  const { data, update } = useGistData();
  const analyses: AnalysisEntry[] = data.analyses ?? [];
  const [form, setForm] = useState<{ var1: string; var2: string; result: string }>(BLANK_ANALYSIS);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(BLANK_ANALYSIS);

  const indicatorOptions = MACRO_INDICATORS.map(m => ({ value: m.id, label: `${m.name} (${m.id})` }));

  const saveNew = async () => {
    if (!form.var1 || !form.result.trim()) return;
    const entry: AnalysisEntry = {
      id: makeId(),
      var1: form.var1,
      var2: form.var2,
      result: form.result.trim(),
      date: todayStr(),
    };
    await update({ analyses: [...analyses, entry] });
    setForm(BLANK_ANALYSIS);
  };

  const deleteEntry = async (id: string) => {
    await update({ analyses: analyses.filter(a => a.id !== id) });
  };

  const startEdit = (a: AnalysisEntry) => {
    setEditId(a.id);
    setEditForm({ var1: a.var1, var2: a.var2, result: a.result });
  };

  const commitEdit = async () => {
    if (!editId) return;
    const updated = analyses.map(a =>
      a.id === editId ? { ...a, ...editForm, result: editForm.result.trim(), date: todayStr() } : a
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
          <p className="text-[11px] text-gray-500 mt-0.5">
            Save your observations linking two indicators. Synced to GitHub Gist.
          </p>
        </div>
      </div>

      {/* New entry form */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Variable 1 *</label>
            <select
              value={form.var1}
              onChange={e => setForm(v => ({ ...v, var1: e.target.value }))}
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent w-52"
            >
              <option value="">— select indicator —</option>
              {indicatorOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Variable 2</label>
            <select
              value={form.var2}
              onChange={e => setForm(v => ({ ...v, var2: e.target.value }))}
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent w-52"
            >
              <option value="">— none —</option>
              {indicatorOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Observation / Result *</label>
            <input
              value={form.result}
              onChange={e => setForm(v => ({ ...v, result: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') saveNew(); }}
              placeholder="e.g. Strong negative correlation when rates rise above 5%"
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-full focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={saveNew}
            disabled={!form.var1 || !form.result.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition shrink-0"
          >
            <Plus size={12} /> Save
          </button>
        </div>
        <p className="text-[10px] text-gray-600">Date is set automatically to today when saved or edited.</p>
      </div>

      {/* Saved entries */}
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
                const ind1 = MACRO_INDICATORS.find(m => m.id === a.var1);
                const ind2 = a.var2 ? MACRO_INDICATORS.find(m => m.id === a.var2) : null;
                return (
                  <tr key={a.id} className="border-t border-border align-top hover:bg-bg-hover/20">
                    <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">{a.date}</td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select
                          value={editForm.var1}
                          onChange={e => setEditForm(v => ({ ...v, var1: e.target.value }))}
                          className="bg-bg border border-accent rounded px-1.5 py-1 text-[11px] text-gray-100 focus:outline-none w-44"
                        >
                          <option value="">—</option>
                          {indicatorOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <div>
                          <p className="font-medium text-gray-100">{ind1?.name ?? a.var1}</p>
                          <p className="text-[10px] text-gray-600 font-mono">{a.var1}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select
                          value={editForm.var2}
                          onChange={e => setEditForm(v => ({ ...v, var2: e.target.value }))}
                          className="bg-bg border border-accent rounded px-1.5 py-1 text-[11px] text-gray-100 focus:outline-none w-44"
                        >
                          <option value="">— none —</option>
                          {indicatorOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : a.var2 ? (
                        <div>
                          <p className="font-medium text-gray-100">{ind2?.name ?? a.var2}</p>
                          <p className="text-[10px] text-gray-600 font-mono">{a.var2}</p>
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      {isEditing ? (
                        <input
                          value={editForm.result}
                          onChange={e => setEditForm(v => ({ ...v, result: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                          className="bg-bg border border-accent rounded px-2 py-1 text-[11px] text-gray-100 focus:outline-none w-full"
                          autoFocus
                        />
                      ) : (
                        <p className="text-gray-200 leading-relaxed">{a.result}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={commitEdit} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
                            <button onClick={() => setEditId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(a)} className="p-1 text-gray-500 hover:text-gray-300"><Edit2 size={12} /></button>
                            <button onClick={() => deleteEntry(a.id)} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                          </>
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
