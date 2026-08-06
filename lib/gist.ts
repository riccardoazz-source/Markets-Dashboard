import { useState, useEffect } from 'react';

// Snapshot of the chart view captured when a note is created, so clicking "restore"
// returns to exactly the same setup (active tools + toggles, timeframe, custom range).
export interface NoteView {
  tools?: Record<string, boolean>;              // ActiveTools snapshot (chips + weekly/full modifiers)
  timeframe?: string;                           // e.g. '1D','1Y','MAX'
  customRange?: { from: string; to: string } | null;
  symbols?: string[];                           // Compare: the set of compared symbols
  // Tiny normalized (% change) thumbnail of each compared series, captured at save
  // time so the Rotation → My Strategy panel can DRAW the linked chart inline
  // without re-fetching/re-resolving every symbol.
  preview?: { label: string; color: string; pts: number[] }[];
  // Correlation matrix of the compared assets at save time (shown in My Strategy).
  correlation?: { labels: string[]; matrix: (number | null)[][] };
  // Compare-only extra state, so "Restore view" brings back the FULL setup.
  spreads?: { a: string; b: string }[];         // spread pairs (A − B)
  normalized?: boolean;                         // % Change (true) vs Absolute price (false)
  alignStart?: boolean;                         // Aligned start (true) vs Full history (false)
  logScale?: boolean;                           // log scale (absolute mode)
  showStack?: boolean;                          // technical-analysis stack panel open
  stackAssetIdx?: number;                       // which asset the stack panel shows
}

export interface NoteEntry {
  id: string;
  text: string;
  date: string; // YYYY-MM-DD
  category?: string;
  view?: NoteView; // optional saved chart state
}

export interface AnalysisEntry {
  id: string;
  var1: string;
  var1Name?: string;
  var2: string;
  var2Name?: string;
  result: string;
  date: string;
}

// One dot of a saved Rotation Quadrant — enough to faithfully re-render the chart
// for a past day. Stored instead of a raster screenshot: tiny, crisp, interactive.
export interface QuadrantPoint {
  symbol: string;
  name: string;
  group: string;
  macroGap?: number; // x-axis: cycle depth in monthly volatilities (≤ 0)
  momentum?: number; // y-axis: the current leg, signed, in monthly volatilities
  r3m: number | null; // 3M return %, kept for the tooltip
  /** @deprecated X was the 3M return and Y the acceleration before the axes became
   *  the trend gap and momentum. Kept so older snapshots still load. */
  accel?: number;
  /** @deprecated Y used to be a cross-sectional percentile. Kept so snapshots
   *  saved before the axis became absolute still load; new ones do not write it. */
  accScore?: number;
  r1m: number | null;
  r1y: number | null;
  isAccel: boolean;   // was it on the Accelerating shortlist that day
  isPinned?: boolean; // was it in the user's pinned list at save time
}

export interface SentimentRecord {
  id: string;
  date: string;        // YYYY-MM-DD
  generatedAt: string; // ISO timestamp of the reading
  data: Record<string, string>;
  quadrant?: QuadrantPoint[]; // snapshot of the Rotation Quadrant at reading time
  modelId?: number;    // rotation model version active at generation time (for the quadrant label)
}

export interface GistData {
  notes?: Record<string, NoteEntry[]>;
  analyses?: AnalysisEntry[];
  sentiments?: SentimentRecord[];
  pins?: string[]; // Rotation "remember to check" symbols
  rotationStockLists?: string[]; // Stock watchlist categories activated in Rotation
  strategyLinks?: Record<string, string[]>; // My Strategy: statement id → linked "Strategy" note ids
  strategyCustom?: { id: string; label: string }[]; // My Strategy: user-added statements
}

/**
 * The stock symbols that join the rotation universe: every `stock:SYM` note filed
 * under one of the watchlist categories switched on in Rotation.
 *
 * An asset's quadrant Y is its percentile against the universe, so WHO is in the
 * universe changes the answer. Rotation and the per-asset Quadrant view therefore
 * have to rank over the same set — this one function is that set, so they cannot
 * drift apart.
 */
export function rotationStockSymbols(data: GistData): string[] {
  const active = (data.rotationStockLists ?? []).map(l => l.toLowerCase());
  if (active.length === 0) return [];
  const notes = data.notes ?? {};
  const syms: string[] = [];
  for (const [chartId, list] of Object.entries(notes)) {
    if (!chartId.startsWith('stock:')) continue;
    if (list.some(n => n.category && active.includes(n.category.toLowerCase()))) {
      const sym = chartId.slice('stock:'.length);
      if (!syms.includes(sym)) syms.push(sym);
    }
  }
  return syms;
}

/**
 * idle       — before the first load completes
 * syncing    — a write is in flight to cloud storage
 * synced     — cloud storage is configured and up to date
 * error      — could not reach cloud storage (kept locally, will retry)
 * local-only — no cloud storage configured; notes live only in this browser
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'local-only';

const LOCAL_KEY = 'markets-gist-cache';

// Module-level cache so all components share one fetch
let _cache: GistData | null = null;
let _fetchPromise: Promise<GistData> | null = null;
let _syncStatus: SyncStatus = 'idle';
const _listeners = new Set<(d: GistData) => void>();
const _statusListeners = new Set<(s: SyncStatus) => void>();

function notify(d: GistData) { _listeners.forEach(l => l(d)); }

function setSyncStatus(s: SyncStatus) {
  _syncStatus = s;
  _statusListeners.forEach(l => l(s));
}

function loadLocal(): GistData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as GistData) : {};
  } catch { return {}; }
}

function saveLocal(d: GistData) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch {}
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface GistResponse { cloud?: boolean; data?: GistData }

// Union sentiment history by date — newest reading per day wins. This guarantees
// no device ever loses macro history, and a fresher reading on one device replaces
// an older same-day reading on another.
function mergeSentiments(a: SentimentRecord[] = [], b: SentimentRecord[] = []): SentimentRecord[] {
  const byDate = new Map<string, SentimentRecord>();
  for (const r of [...a, ...b]) {
    const prev = byDate.get(r.date);
    if (!prev || (r.generatedAt ?? '') > (prev.generatedAt ?? '')) byDate.set(r.date, r);
  }
  return [...byDate.values()]
    .sort((x, y) => (y.generatedAt ?? '').localeCompare(x.generatedAt ?? ''))
    .slice(0, 120);
}

// Merge two snapshots. `winner` is authoritative for conflicts; keys present only
// in `other` are preserved; sentiment history is always unioned by recency.
// For notes, the per-chartId map merges with the winner's chartIds taking priority.
function mergeCloud(other: GistData, winner: GistData): GistData {
  return {
    notes: { ...(other.notes ?? {}), ...(winner.notes ?? {}) },
    analyses: winner.analyses ?? other.analyses,
    sentiments: mergeSentiments(other.sentiments, winner.sentiments),
    pins: winner.pins ?? other.pins,
    rotationStockLists: winner.rotationStockLists ?? other.rotationStockLists,
    strategyLinks: winner.strategyLinks ?? other.strategyLinks,
    strategyCustom: winner.strategyCustom ?? other.strategyCustom,
  };
}

// Shared fetch+merge. `preferCacheOnConflict` keeps any write made during an
// initial in-flight load (true), or lets the freshly-fetched remote win on an
// explicit refresh so cross-device changes propagate (false).
async function fetchAndMerge(preferCacheOnConflict: boolean): Promise<GistData> {
  try {
    const resp = await fetch('/api/gist').then(r => r.json()) as GistResponse | GistData;
    // New API shape is { cloud, data }; fall back to legacy flat GistData.
    const wrapped = !!resp && typeof resp === 'object' && 'data' in resp;
    const remote: GistData = wrapped ? ((resp as GistResponse).data ?? {}) : (resp as GistData);
    const cloud = wrapped ? !!(resp as GistResponse).cloud : Object.keys(remote).length > 0;
    const local = loadLocal();
    const remoteHasData = Object.keys(remote).length > 0;

    // Server is authoritative: remote wins over on-disk local on conflicts, but
    // local-only keys (and sentiment history) are preserved.
    const baseline = remoteHasData ? mergeCloud(local, remote) : local;

    // Reconcile with the in-memory cache.
    if (!_cache) {
      _cache = baseline;
    } else if (preferCacheOnConflict) {
      _cache = mergeCloud(baseline, _cache); // a write landed during load → keep it
    } else {
      _cache = mergeCloud(_cache, baseline); // explicit refresh → remote wins
    }
    saveLocal(_cache);
    notify(_cache);

    // Cloud configured but empty while this device has local notes: seed the cloud.
    if (cloud && !remoteHasData && Object.keys(local).length > 0) {
      fetch('/api/gist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(local),
      }).catch(() => {});
    }

    setSyncStatus(cloud ? 'synced' : 'local-only');
    return _cache;
  } catch {
    _cache = _cache ?? loadLocal();
    setSyncStatus('error');
    return _cache!;
  }
}

export async function loadGistData(): Promise<GistData> {
  if (_cache) return _cache;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = fetchAndMerge(true).finally(() => { _fetchPromise = null; });
  return _fetchPromise;
}

// Force a re-fetch even when a cache exists — used when the app regains focus so
// changes made on another device are pulled in. Remote wins on conflicts.
export async function refreshGistData(): Promise<GistData> {
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = fetchAndMerge(false).finally(() => { _fetchPromise = null; });
  return _fetchPromise;
}

export async function updateGistData(patch: Partial<GistData>): Promise<GistData> {
  const cur = _cache ?? loadLocal();
  const merged: GistData = {
    ...cur,
    ...(patch.notes !== undefined
      ? { notes: { ...(cur.notes ?? {}), ...patch.notes } }
      : {}),
    ...(patch.analyses !== undefined ? { analyses: patch.analyses } : {}),
    ...(patch.sentiments !== undefined ? { sentiments: patch.sentiments } : {}),
    ...(patch.pins !== undefined ? { pins: patch.pins } : {}),
    ...(patch.rotationStockLists !== undefined ? { rotationStockLists: patch.rotationStockLists } : {}),
    ...(patch.strategyLinks !== undefined ? { strategyLinks: patch.strategyLinks } : {}),
    ...(patch.strategyCustom !== undefined ? { strategyCustom: patch.strategyCustom } : {}),
  };
  _cache = merged;
  saveLocal(merged);
  notify(merged);
  // Persist async
  setSyncStatus('syncing');
  fetch('/api/gist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
    .then(r => r.json())
    .then((resp: { ok?: boolean; cloud?: boolean }) => {
      if (!resp.cloud) setSyncStatus('local-only');
      else setSyncStatus(resp.ok ? 'synced' : 'error');
    })
    .catch(() => setSyncStatus('error'));
  return merged;
}

export function useGistData() {
  const [data, setData] = useState<GistData>(() => {
    if (typeof window === 'undefined') return {};
    return _cache ?? loadLocal();
  });

  useEffect(() => {
    loadGistData().then(d => setData({ ...d }));
    const listener = (d: GistData) => setData({ ...d });
    _listeners.add(listener);
    // Pull changes made on other devices whenever the app regains focus or
    // becomes visible again (e.g. switching back to the tab / reopening on mobile).
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshGistData();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      _listeners.delete(listener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const update = async (patch: Partial<GistData>) => {
    await updateGistData(patch);
  };

  return { data, update };
}

// Shared pin store — the SAME gist-backed set the Rotation tab uses, so pinning an
// asset anywhere (Rotation or its own section) reflects everywhere. Returns the set
// of pinned symbols + a toggle.
export function usePins() {
  const { data, update } = useGistData();
  const pins = new Set<string>(data.pins ?? []);
  const togglePin = (symbol: string) => {
    const next = new Set(pins);
    if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
    update({ pins: [...next] });
  };
  return { pins, togglePin };
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(_syncStatus);
  useEffect(() => {
    setStatus(_syncStatus);
    const l = (s: SyncStatus) => setStatus(s);
    _statusListeners.add(l);
    return () => { _statusListeners.delete(l); };
  }, []);
  return status;
}
