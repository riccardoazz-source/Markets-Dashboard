// Each sector ETF in the SECTORS config is mapped to a GICS filter. The actual
// company list and the per-sub-industry layers are then derived dynamically
// from the live S&P 500 constituents (which auto-refresh daily from the
// datasets/s-and-p-500-companies GitHub CSV). Companies move in/out as S&P
// rebalances; sub-industries (== layers) rebuild automatically.
//
// Two kinds of filter:
//   - `gicsSector`       — the ETF tracks a whole GICS sector (most SPDR XL*).
//   - `subIndustryMatch` — thematic ETFs (AIQ, CIBR, SOXX, ...) need a fuzzy
//     sub-industry match. Each entry is a list of *substrings*; a stock is
//     included if any of its sub-industry name contains any of the substrings
//     (case-insensitive). Substring matching is more robust than equality
//     against the exact GICS taxonomy names.

export interface SectorFilter {
  gicsSector?: string;
  subIndustryMatch?: string[];
  /** Hint shown in the panel header. */
  description?: string;
}

export const SECTOR_FILTERS: Record<string, SectorFilter> = {
  // SPDR sector ETFs — clean 1:1 to a GICS sector
  XLK:  { gicsSector: 'Information Technology', description: 'All S&P 500 IT companies, layered by GICS sub-industry' },
  XLV:  { gicsSector: 'Health Care' },
  XLF:  { gicsSector: 'Financials' },
  XLY:  { gicsSector: 'Consumer Discretionary' },
  XLP:  { gicsSector: 'Consumer Staples' },
  XLE:  { gicsSector: 'Energy' },
  XLI:  { gicsSector: 'Industrials' },
  XLB:  { gicsSector: 'Materials' },
  XLRE: { gicsSector: 'Real Estate' },
  XLU:  { gicsSector: 'Utilities' },

  // Thematic ETFs — fuzzy sub-industry match against S&P 500
  SOXX: { subIndustryMatch: ['semiconductor'], description: 'Semiconductor value chain (chip designers, foundries, equipment)' },
  AIQ:  { subIndustryMatch: ['semiconductor', 'software', 'interactive media', 'it consulting', 'internet services'], description: 'AI value chain (silicon, software, cloud, services)' },
  WCLD: { subIndustryMatch: ['software', 'it consulting', 'internet services'], description: 'Cloud / SaaS value chain' },
  CIBR: { subIndustryMatch: ['software', 'communications equipment', 'it consulting'], description: 'Cybersecurity value chain' },
  XBI:  { subIndustryMatch: ['biotechnology', 'pharmaceutical', 'life sciences'], description: 'Biotech & pharma value chain' },
  NLR:  { subIndustryMatch: ['electric utilit', 'independent power', 'multi-utilit'], description: 'Nuclear & power generation value chain' },
  ICLN: { subIndustryMatch: ['renewable', 'independent power', 'heavy electrical', 'electrical components'], description: 'Clean energy value chain' },
  ITA:  { subIndustryMatch: ['aerospace', 'defense'], description: 'Defense & aerospace value chain' },
  BOTZ: { subIndustryMatch: ['industrial machinery', 'semiconductor', 'software', 'electronic equipment'], description: 'Robotics & automation value chain' },
  DRIV: { subIndustryMatch: ['automobile', 'auto parts', 'electrical components', 'semiconductor'], description: 'Electric vehicle value chain' },
};

/** Display name shown in the layer header — strip noisy GICS suffixes. */
export function tidyLayerName(subIndustry: string): string {
  return subIndustry
    .replace(/&\s*/g, '& ')
    .replace(/\s+/g, ' ')
    .trim();
}
