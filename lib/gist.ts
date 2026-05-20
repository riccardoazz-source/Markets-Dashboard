import { useState, useEffect } from 'react';

export interface NoteEntry {
  id: string;
  text: string;
  date: string; // YYYY-MM-DD
  category?: string;
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

export interface GistData {
  notes?: Record<string, NoteEntry[]>;
  analyses?: AnalysisEntry[];
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

// Merge `over` on top of `base` at the per-chartId level so fresh edits win
// but baseline chartIds the cache lacks are still adopted.
function mergeNotes(base: GistData, over: GistData): GistData {
  return {
    notes: { ...(base.notes ?? {}), ...(over.notes ?? {}) },
    analyses: over.analyses ?? base.analyses,
  };
}

export async function loadGistData(): Promise<GistData> {
  if (_cache) return _cache;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = fetch('/api/gist')
    .then(r => r.json())
    .then((resp: GistResponse | GistData) => {
      // New API shape is { cloud, data }; fall back to legacy flat GistData.
      const wrapped = !!resp && typeof resp === 'object' && 'data' in resp;
      const remote: GistData = wrapped
        ? ((resp as GistResponse).data ?? {})
        : (resp as GistData);
      const cloud = wrapped
        ? !!(resp as GistResponse).cloud
        : Object.keys(remote).length > 0;
      const local = loadLocal();
      const remoteHasData = Object.keys(remote).length > 0;
      const baseline = remoteHasData ? remote : local;

      // If a write landed while this fetch was in flight, _cache holds the
      // fresher state — keep it and only adopt baseline chartIds it lacks.
      _cache = _cache ? mergeNotes(baseline, _cache) : baseline;
      saveLocal(_cache);

      // Cloud configured but empty while this device has local notes:
      // seed the cloud so the existing notes are not lost.
      if (cloud && !remoteHasData && Object.keys(local).length > 0) {
        fetch('/api/gist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(local),
        }).catch(() => {});
      }

      setSyncStatus(cloud ? 'synced' : 'local-only');
      return _cache;
    })
    .catch(() => {
      _cache = _cache ?? loadLocal();
      setSyncStatus('error');
      return _cache!;
    })
    .finally(() => { _fetchPromise = null; });
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
    return () => { _listeners.delete(listener); };
  }, []);

  const update = async (patch: Partial<GistData>) => {
    await updateGistData(patch);
  };

  return { data, update };
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
