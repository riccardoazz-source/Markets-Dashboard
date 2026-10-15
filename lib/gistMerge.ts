// ── Applying a patch to the saved-data cache ─────────────────────────────────
//
// Extracted from lib/gist.ts so it can be tested: gist.ts imports React, and the check
// harness compiles these files standalone.
//
// It exists as its own function because the previous version was an explicit allow-list —
// one line per key, `...(patch.pins !== undefined ? { pins: patch.pins } : {})` and so on.
// That fails SILENTLY for any key nobody remembered to add: the patch is posted to the
// server, the server stores it correctly, and the local cache drops it, so the feature
// looks broken while the data is actually fine. Adding personal calendar events hit
// exactly that.
//
// So: everything is carried through generically, and `notes` — the one key that must
// MERGE rather than replace, because notes for one chart must not wipe another's — is the
// single special case.

// ── What this device has that the server has never seen ─────────────────────
//
// The gap that stranded a whole watchlist on one phone.
//
// On load the app merged the server's snapshot with this device's local one and showed
// the union — so the phone looked complete. It then uploaded the local copy only when the
// server was COMPLETELY empty. Once the server held anything at all, even a single list
// of pins, the upload never fired again: the phone kept merging its own notes in for
// display, kept saving them back to its own disk, and never told the server. Another
// device fetching the same account saw pins and nothing else, which is exactly what it
// had been given.
//
// This returns the part of `local` the server does not have, so it can be sent. It is
// deliberately ADDITIVE: a key present on the server is never included, so an upload
// built from this can add to the server but can never overwrite it. `notes` is compared
// per chart for the same reason — a chart the server already knows about is left alone,
// and only charts it has never heard of go up.
//
// What it does NOT do is make deletions propagate. If something was deleted on one device
// while another still holds it locally, the one holding it will put it back. That is the
// existing union-shaped design of this file, not something introduced here, and fixing it
// needs tombstones rather than a bigger merge.
export function missingFromRemote<T extends { notes?: Record<string, unknown[]> }>(
  local: T, remote: T,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(local)) {
    if (k === 'notes' || v === undefined) continue;
    if (!(k in remote)) out[k] = v;
  }
  const localNotes = local.notes;
  if (localNotes) {
    const remoteNotes = remote.notes ?? {};
    const charts: Record<string, unknown[]> = {};
    for (const [chartId, list] of Object.entries(localNotes)) {
      if (!(chartId in remoteNotes)) charts[chartId] = list;
    }
    if (Object.keys(charts).length > 0) out.notes = charts;
  }
  return out as Partial<T>;
}

export function mergePatch<T extends { notes?: Record<string, unknown[]> }>(
  current: T,
  patch: Partial<T>,
): T {
  // A key explicitly set to undefined means "not part of this patch", not "delete it".
  // Spreading it raw would overwrite a real value with undefined.
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

  const merged = { ...current, ...defined } as T;
  if (patch.notes !== undefined) {
    merged.notes = { ...(current.notes ?? {}), ...patch.notes };
  }
  return merged;
}

// ── Merging two whole snapshots ──────────────────────────────────────────────
//
// The READ side of the same problem, and it had the same bug for longer: this used to
// rebuild the snapshot from a hand-written list of seven key names, so any key nobody
// added to that list was destroyed on every load. Personal calendar entries were exactly
// that. Adding one worked — the screen updated and the server stored it correctly — and
// then the next load, including the one that fires when the tab regains focus, rebuilt
// the object without it. The event vanished on the same device and never reached another,
// while the data sat intact on the server the whole time.
//
// So both directions are generic now, and they share a function. `winner` is authoritative
// for conflicts; every key present in either survives.
//
// Only two keys need a rule of their own:
//   • `notes` — a map that must MERGE, or notes for one chart wipe another's (in mergePatch).
//   • `sentiments` — history that must be UNIONED, so no device ever loses a day another
//     device recorded.
export function mergeSnapshots<
  T extends { notes?: Record<string, unknown[]>; sentiments?: S[] },
  S extends { date: string; generatedAt?: string },
>(other: T, winner: T, cap = 120): T {
  const merged = mergePatch(other, winner);
  const sentiments = unionByDate<S>(other.sentiments, winner.sentiments, cap);
  // Assigned only when there is history, so a snapshot that never had the key does not
  // acquire an empty array — `undefined` and `[]` read the same on screen but not to a
  // merge that treats a present key as authoritative.
  if (sentiments.length > 0) merged.sentiments = sentiments;
  return merged;
}

/**
 * Newest reading per date wins, most recent first, capped.
 *
 * Recency is judged on `generatedAt`, not on arrival: two devices writing the same day
 * must converge on the same answer whichever of them loads first.
 */
export function unionByDate<S extends { date: string; generatedAt?: string }>(
  a: S[] = [], b: S[] = [], cap = 120,
): S[] {
  const byDate = new Map<string, S>();
  for (const r of [...a, ...b]) {
    const prev = byDate.get(r.date);
    if (!prev || (r.generatedAt ?? '') > (prev.generatedAt ?? '')) byDate.set(r.date, r);
  }
  return [...byDate.values()]
    .sort((x, y) => (y.generatedAt ?? '').localeCompare(x.generatedAt ?? ''))
    .slice(0, cap);
}
