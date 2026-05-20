// Persistent custom data-source configuration stored in localStorage.
// Built-in indicators (MACRO_INDICATORS) can have their fetch URL overridden;
// completely new indicators can be added under "custom".
// Built-in indicators can also be hidden from the Macro tab via "hidden".

export type MacroUnit = '%' | 'K' | 'idx' | 'B$';

export interface CustomSource {
  id: string;           // unique (e.g. "custom_1716000000_abc12")
  name: string;
  category: string;
  unit: MacroUnit;
  url: string;          // the URL the scraper will fetch
}

export interface SourcesConfig {
  // Per built-in indicator (keyed by MACRO_INDICATOR.id): override the fetch URL.
  // When set, /api/scrape?url=... is used instead of /api/macro.
  overrides: Record<string, string>;
  // Completely new indicators the user added.
  custom: CustomSource[];
  // IDs of built-in indicators hidden from the Macro tab.
  hidden: string[];
}

const KEY = 'mkt-sources-v2';
const EMPTY: SourcesConfig = { overrides: {}, custom: [], hidden: [] };

export function loadSourcesConfig(): SourcesConfig {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SourcesConfig>;
    // Backward-compat: older stored configs may lack `hidden`
    return {
      overrides: parsed.overrides ?? {},
      custom: parsed.custom ?? [],
      hidden: parsed.hidden ?? [],
    };
  } catch {
    return EMPTY;
  }
}

export function saveSourcesConfig(cfg: SourcesConfig): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
}

export function generateId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// Dispatch a browser event so any mounted component can react to source changes.
export function notifySourcesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mkt-sources-changed'));
  }
}

// Encode config into the URL hash so it survives Vercel preview URL changes.
// Hash fragments are never sent to the server, so any length is fine.
// Bookmarking the URL is enough to persist config across deploys and devices.

export function saveToHash(cfg: SourcesConfig): void {
  if (typeof window === 'undefined') return;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(cfg));
    const b64 = btoa(String.fromCharCode(...bytes));
    window.history.replaceState(null, '', `#cfg=${b64}`);
  } catch {}
}

export function loadFromHash(): SourcesConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const m = window.location.hash.match(/[#&]?cfg=([A-Za-z0-9+/=]+)/);
    if (!m) return null;
    const bytes = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SourcesConfig>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      overrides: (typeof parsed.overrides === 'object' && parsed.overrides !== null)
        ? (parsed.overrides as Record<string, string>) : {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch { return null; }
}
