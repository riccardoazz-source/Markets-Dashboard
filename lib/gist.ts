import { useState, useEffect } from 'react';
import { mergePatch, mergeSnapshots, unionByDate } from './gistMerge';

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
  /**
   * Personal entries on the forward calendar — an earnings call, a meeting, anything
   * dated. They live here rather than in localStorage so they follow the same personal
   * code every other saved thing does: one sync, not two.
   */
  calendarEvents?: PersonalCalendarEvent[];
}

/** A user-added calendar entry. `date` is an absolute instant, ISO 8601 in UTC. */
export interface PersonalCalendarEvent {
  id: string;
  title: string;
  date: string;
  /** False → shown as "All day" rather than at a time nobody set. */
  timeKnown: boolean;
  description?: string;
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
// Writes that have not reached the server yet, kept across reloads.
const PENDING_KEY = 'markets-gist-pending';

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

// ── Writes that have not landed yet ──────────────────────────────────────────
//
// The POST used to be fire-and-forget: on failure the status went to 'error' and the
// change was never sent again. On a desk that is invisible, because the request
// succeeds. On a phone on a weak signal it is the whole bug — the change is in that
// phone's localStorage, so the phone keeps showing it and looks fine, while the server
// never heard about it and no other device ever will. "I added it on the iPhone and the
// PC doesn't see it" is exactly what a dropped write looks like from the outside.
//
// So an unsent write is KEPT, on disk, and retried on the next load or focus. Everything
// queued collapses into one patch through the same merge the rest of the file uses, so
// three offline edits cost one request and the last value of any key wins.
let _pending: Partial<GistData> | null = null;

function loadPending(): Partial<GistData> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Partial<GistData>) : null;
  } catch { return null; }
}

function savePending(p: Partial<GistData> | null) {
  if (typeof window === 'undefined') return;
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
}

/** Send whatever is still owed to the server. Safe to call at any time. */
export async function flushPending(): Promise<boolean> {
  if (_pending === null) _pending = loadPending();
  const patch = _pending;
  if (!patch || Object.keys(patch).length === 0) return true;
  setSyncStatus('syncing');
  try {
    const resp = await fetch('/api/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json()) as { ok?: boolean; cloud?: boolean };
    if (!resp.cloud) {
      // No cloud configured at all — this will never land, and keeping it queued
      // forever would retry on every focus for nothing.
      _pending = null; savePending(null);
      setSyncStatus('local-only');
      return false;
    }
    if (resp.ok) {
      // Only what was actually sent is cleared: a write made WHILE this request was in
      // flight is still owed, and dropping the queue wholesale would lose it.
      _pending = subtractSent(_pending, patch);
      savePending(_pending);
      setSyncStatus('synced');
      return true;
    }
    setSyncStatus('error');
    return false;
  } catch {
    setSyncStatus('error');
    return false;
  }
}

/** What is still owed after `sent` went out: keys the queue has re-modified since. */
function subtractSent(
  queue: Partial<GistData> | null, sent: Partial<GistData>,
): Partial<GistData> | null {
  if (!queue) return null;
  const left = Object.fromEntries(
    Object.entries(queue).filter(([k, v]) => v !== (sent as Record<string, unknown>)[k]),
  ) as Partial<GistData>;
  return Object.keys(left).length > 0 ? left : null;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface GistResponse { cloud?: boolean; data?: GistData }

// Union sentiment history by date — newest reading per day wins, so no device ever loses
// history another recorded. Kept as a named export because callers outside the merge use it.
const mergeSentiments = (a: SentimentRecord[] = [], b: SentimentRecord[] = []) =>
  unionByDate<SentimentRecord>(a, b);

// Merge two whole snapshots. `winner` wins conflicts; every key in either survives.
// The implementation lives in lib/gistMerge, beside the patch merge and under the same
// checks — see the note there for what it used to do instead, and what that cost.
const mergeCloud = (other: GistData, winner: GistData): GistData =>
  mergeSnapshots<GistData, SentimentRecord>(other, winner);

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

    // Anything this device still owes goes out now — this is the moment a phone that was
    // offline when the user typed comes back and can finally deliver it. The status is
    // set BEFORE the flush, because the flush sets its own ('syncing' → 'synced'/'error')
    // and doing it after would overwrite the outcome with a stale optimistic value.
    if (!cloud) setSyncStatus('local-only');
    else { setSyncStatus('synced'); void flushPending(); }
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
  // Generic, not a key-by-key allow-list. The allow-list dropped any field nobody
  // remembered to add to it — silently, and only on the client, so the server held the
  // right data while the screen showed the old. See lib/gistMerge.
  const merged = mergePatch(cur, patch);
  _cache = merged;
  saveLocal(merged);
  notify(merged);
  // Queued first, THEN sent. If the send fails the change is still owed and will go out
  // on the next load or focus, instead of living only in this browser.
  if (_pending === null) _pending = loadPending();
  _pending = mergePatch(_pending ?? {}, patch);
  savePending(_pending);
  void flushPending();
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
/**
 * The user's own calendar entries, on the shared gist — the same store the pins use, so
 * an event added on one device shows up on the others without a second sync to set up.
 * Past entries are NOT deleted: the calendar's window hides them, and silently destroying
 * something the user typed because a date went by would be the wrong trade.
 */
export function useCalendarEvents() {
  const { data, update } = useGistData();
  const events = data.calendarEvents ?? [];
  const addEvent = (e: Omit<PersonalCalendarEvent, 'id'>) =>
    update({ calendarEvents: [...events, { ...e, id: `own_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }] });
  const removeEvent = (id: string) =>
    update({ calendarEvents: events.filter(x => x.id !== id) });
  return { events, addEvent, removeEvent };
}

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
