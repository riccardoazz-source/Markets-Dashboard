import { useState, useEffect } from 'react';

export interface NoteEntry {
  id: string;
  text: string;
  date: string; // YYYY-MM-DD
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

const LOCAL_KEY = 'markets-gist-cache';

// Module-level cache so all components share one fetch
let _cache: GistData | null = null;
let _fetchPromise: Promise<GistData> | null = null;
const _listeners = new Set<(d: GistData) => void>();

function notify(d: GistData) { _listeners.forEach(l => l(d)); }

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

export async function loadGistData(): Promise<GistData> {
  if (_cache) return _cache;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = fetch('/api/gist')
    .then(r => r.json() as Promise<GistData>)
    .then(remote => {
      const local = loadLocal();
      _cache = Object.keys(remote).length > 0 ? remote : local;
      saveLocal(_cache);
      return _cache;
    })
    .catch(() => {
      _cache = loadLocal();
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
  fetch('/api/gist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
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
