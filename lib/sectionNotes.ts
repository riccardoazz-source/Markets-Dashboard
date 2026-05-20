import {
  INDEXES, COMMODITIES, SECTORS, MACRO_INDICATORS, CURRENCY_PAIRS, CRYPTO_IDS,
} from '@/lib/config';

/** Sections that support per-asset chart notes. */
export type NotesSection =
  | 'indexes' | 'currencies' | 'crypto'
  | 'commodities' | 'sectors' | 'macro' | 'stock';

export const NOTE_SECTIONS: NotesSection[] = [
  'indexes', 'currencies', 'crypto', 'commodities', 'sectors', 'macro', 'stock',
];

export function isNotesSection(s: string): s is NotesSection {
  return (NOTE_SECTIONS as string[]).includes(s);
}

/**
 * Given a section and a note's `chartId`, return the asset's display name if
 * the chartId belongs to that section, or null otherwise. Used to gather every
 * note written in a section regardless of which asset it was attached to.
 */
export function resolveNoteName(section: NotesSection, chartId: string): string | null {
  switch (section) {
    case 'indexes':
      return INDEXES.find(i => i.symbol === chartId)?.name ?? null;
    case 'currencies':
      return CURRENCY_PAIRS.some(c => `${c.from}/${c.to}` === chartId) ? chartId : null;
    case 'crypto': {
      if (!chartId.startsWith('crypto:')) return null;
      const id = chartId.slice('crypto:'.length);
      return CRYPTO_IDS.find(c => c.id === id)?.name ?? id;
    }
    case 'commodities':
      return COMMODITIES.find(c => c.symbol === chartId)?.name ?? null;
    case 'sectors':
      return SECTORS.find(s => s.symbol === chartId)?.name ?? null;
    case 'macro':
      return MACRO_INDICATORS.find(m => m.id === chartId)?.name ?? null;
    case 'stock': {
      if (!chartId.startsWith('stock:')) return null;
      return chartId.slice('stock:'.length);
    }
  }
}
