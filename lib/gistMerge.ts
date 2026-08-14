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
