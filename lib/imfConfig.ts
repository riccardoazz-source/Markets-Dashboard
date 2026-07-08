// ─────────────────────────────────────────────────────────────────────────────
// Macro World (IMF) — self-contained, removable feature.
//
// To DISABLE the whole feature: set MACRO_WORLD_ENABLED = false (the nav tab and
// the page render both gate on it — nothing else changes).
// To REMOVE it entirely: delete this file, components/sections/MacroWorldSection.tsx
// and app/api/imf/route.ts, then drop the 'macroworld' references in Navbar.tsx and
// app/page.tsx (all guarded by MACRO_WORLD_ENABLED, so they no-op when false).
//
// Data source: IMF DataMapper API (free, no key) — annual World Economic Outlook
// series per country, with the IMF's own forecasts for the next few years.
//   https://www.imf.org/external/datamapper/api/v1/{INDICATOR}/{COUNTRY}
// ─────────────────────────────────────────────────────────────────────────────

export const MACRO_WORLD_ENABLED = true;

export type ImfUnit = '%' | 'USD' | 'USD bn' | '% of GDP' | 'M people';

export interface ImfIndicator {
  code: string;    // IMF DataMapper indicator code (WEO)
  name: string;    // display name
  unit: ImfUnit;
  category: string;
  /** Sort direction for the "good/bad" tint on the grid: true → higher is better. */
  higherBetter: boolean;
}

// Curated set of the most useful cross-country WEO indicators.
export const IMF_INDICATORS: ImfIndicator[] = [
  { code: 'NGDP_RPCH',   name: 'Real GDP Growth',      unit: '%',        category: 'Growth',   higherBetter: true  },
  { code: 'NGDPDPC',     name: 'GDP per Capita',       unit: 'USD',      category: 'Growth',   higherBetter: true  },
  { code: 'NGDPD',       name: 'GDP (nominal)',        unit: 'USD bn',   category: 'Growth',   higherBetter: true  },
  { code: 'PCPIPCH',     name: 'Inflation (CPI avg)',  unit: '%',        category: 'Prices',   higherBetter: false },
  { code: 'LUR',         name: 'Unemployment Rate',    unit: '%',        category: 'Labor',    higherBetter: false },
  { code: 'GGXWDG_NGDP', name: 'Govt Gross Debt',      unit: '% of GDP', category: 'Fiscal',   higherBetter: false },
  { code: 'GGXCNL_NGDP', name: 'Fiscal Balance',       unit: '% of GDP', category: 'Fiscal',   higherBetter: true  },
  { code: 'BCA_NGDPD',   name: 'Current Account',      unit: '% of GDP', category: 'External', higherBetter: true  },
  { code: 'LP',          name: 'Population',           unit: 'M people', category: 'People',    higherBetter: true  },
];

export const IMF_INDICATOR_BY_CODE = new Map(IMF_INDICATORS.map(i => [i.code, i]));

// Format an IMF value for its unit.
export function fmtImf(v: number | null | undefined, unit: ImfUnit): string {
  if (v == null || !isFinite(v)) return '—';
  switch (unit) {
    case '%':
    case '% of GDP': return `${v >= 0 ? '' : ''}${v.toFixed(2)}%`;
    case 'USD':      return v >= 1000 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(0)}`;
    case 'USD bn':   return v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${v.toFixed(1)}B`;
    case 'M people': return v >= 1 ? `${v.toFixed(1)}M` : `${(v * 1000).toFixed(0)}k`;
  }
}
