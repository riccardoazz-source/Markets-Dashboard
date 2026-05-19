// Persistent custom data-source configuration stored in localStorage.
// Built-in indicators (MACRO_INDICATORS) can have their fetch URL overridden;
// completely new indicators can be added under "custom".

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
}

const KEY = 'mkt-sources-v2';
const EMPTY: SourcesConfig = { overrides: {}, custom: [] };

export function loadSourcesConfig(): SourcesConfig {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SourcesConfig) : EMPTY;
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
