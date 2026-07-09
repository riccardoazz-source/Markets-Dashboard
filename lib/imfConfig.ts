// ─────────────────────────────────────────────────────────────────────────────
// Macro World — self-contained, removable feature.
//
// To DISABLE: set MACRO_WORLD_ENABLED = false (nav tab + page render both gate on
// it — nothing else changes). To REMOVE entirely: delete this file,
// components/sections/MacroWorldSection.tsx and app/api/worldbank/route.ts, then
// drop the flag-guarded 'macroworld' lines in Navbar.tsx and app/page.tsx.
//
// Data source: World Bank Indicators API (free, no key, ~200 countries, annual,
// CORS-friendly and not IP-blocked — unlike the IMF DataMapper, which refuses
// datacenter IPs and sends no CORS headers).
//   https://api.worldbank.org/v2/country/{ISO3}/indicator/{CODE}?format=json
// ─────────────────────────────────────────────────────────────────────────────

export const MACRO_WORLD_ENABLED = true;

export type ImfUnit = '%' | 'USD' | 'USD bn' | '% of GDP' | 'M people';

export interface ImfIndicator {
  code: string;    // World Bank indicator code
  name: string;    // display name
  unit: ImfUnit;
  category: string;
  higherBetter: boolean;
  /** Divide the raw World Bank value by this (e.g. nominal GDP US$ → billions). */
  scale?: number;
}

// Curated cross-country indicators (World Bank codes).
export const IMF_INDICATORS: ImfIndicator[] = [
  { code: 'NY.GDP.MKTP.KD.ZG', name: 'Real GDP Growth',     unit: '%',        category: 'Growth',   higherBetter: true  },
  { code: 'NY.GDP.PCAP.CD',    name: 'GDP per Capita',      unit: 'USD',      category: 'Growth',   higherBetter: true  },
  { code: 'NY.GDP.MKTP.CD',    name: 'GDP (nominal)',       unit: 'USD bn',   category: 'Growth',   higherBetter: true,  scale: 1e9 },
  { code: 'FP.CPI.TOTL.ZG',    name: 'Inflation (CPI)',     unit: '%',        category: 'Prices',   higherBetter: false },
  { code: 'SL.UEM.TOTL.ZS',    name: 'Unemployment Rate',   unit: '%',        category: 'Labor',    higherBetter: false },
  { code: 'GC.DOD.TOTL.GD.ZS', name: 'Govt Debt',           unit: '% of GDP', category: 'Fiscal',   higherBetter: false },
  { code: 'GC.NLD.TOTL.GD.ZS', name: 'Fiscal Balance',      unit: '% of GDP', category: 'Fiscal',   higherBetter: true  },
  { code: 'BN.CAB.XOKA.GD.ZS', name: 'Current Account',     unit: '% of GDP', category: 'External', higherBetter: true  },
  { code: 'SP.POP.TOTL',       name: 'Population',           unit: 'M people', category: 'People',    higherBetter: true,  scale: 1e6 },
];

export const IMF_INDICATOR_BY_CODE = new Map(IMF_INDICATORS.map(i => [i.code, i]));

// ─────────────────────────────────────────────────────────────────────────────
// Compare integration. The Compare section can't enumerate ~200 live countries,
// so we expose a curated set of major economies + aggregates as ready-made
// comparable assets ("WB:<ISO3>:<indicatorCode>"). These feed the Compare search
// box and a "Macro World" quick-add asset class (one subcategory per indicator,
// bulk-loading the same indicator across the major economies for an instant
// cross-country chart). Removing the feature removes these with the file.
// ─────────────────────────────────────────────────────────────────────────────
export const IMF_COMPARE_PLACES: { code: string; name: string }[] = [
  { code: 'WLD', name: 'World' },
  { code: 'EUU', name: 'European Union' },
  { code: 'EMU', name: 'Euro area' },
  { code: 'USA', name: 'United States' },
  { code: 'CHN', name: 'China' },
  { code: 'JPN', name: 'Japan' },
  { code: 'DEU', name: 'Germany' },
  { code: 'IND', name: 'India' },
  { code: 'GBR', name: 'United Kingdom' },
  { code: 'FRA', name: 'France' },
  { code: 'ITA', name: 'Italy' },
  { code: 'BRA', name: 'Brazil' },
  { code: 'CAN', name: 'Canada' },
  { code: 'RUS', name: 'Russia' },
  { code: 'KOR', name: 'South Korea' },
  { code: 'ESP', name: 'Spain' },
  { code: 'AUS', name: 'Australia' },
  { code: 'MEX', name: 'Mexico' },
  { code: 'IDN', name: 'Indonesia' },
  { code: 'TUR', name: 'Turkey' },
  { code: 'SAU', name: 'Saudi Arabia' },
  { code: 'CHE', name: 'Switzerland' },
  { code: 'NLD', name: 'Netherlands' },
  { code: 'ZAF', name: 'South Africa' },
  { code: 'ARG', name: 'Argentina' },
];

// A handful of headline economies used for the quick-add cross-country subcategories.
const IMF_COMPARE_MAJORS = ['USA', 'CHN', 'JPN', 'DEU', 'IND'];

export interface ImfCompareAsset { symbol: string; name: string; category: string; type: 'index'; group: string }

/** All curated country × indicator combinations, as searchable comparable assets. */
export function imfCompareAssets(): ImfCompareAsset[] {
  const out: ImfCompareAsset[] = [];
  for (const p of IMF_COMPARE_PLACES) {
    for (const ind of IMF_INDICATORS) {
      out.push({
        symbol: `WB:${p.code}:${ind.code}`,
        name: `${p.name} · ${ind.name}`,
        category: 'Macro World',
        type: 'index',
        group: 'Macro World',
      });
    }
  }
  return out;
}

/** One quick-add subcategory per indicator, bulk-loading the major economies. */
export function imfCompareClass(): { key: string; label: string; subcats: { label: string; symbols: string[] }[] } {
  return {
    key: 'Macro World',
    label: 'Macro World',
    subcats: IMF_INDICATORS.map(ind => ({
      label: ind.name,
      symbols: IMF_COMPARE_MAJORS.map(c => `WB:${c}:${ind.code}`),
    })),
  };
}

// Format a value for its unit.
export function fmtImf(v: number | null | undefined, unit: ImfUnit): string {
  if (v == null || !isFinite(v)) return '—';
  switch (unit) {
    case '%':
    case '% of GDP': return `${v.toFixed(2)}%`;
    case 'USD':      return v >= 1000 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(0)}`;
    case 'USD bn':   return v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${v.toFixed(1)}B`;
    case 'M people': return v >= 1 ? `${v.toFixed(1)}M` : `${(v * 1000).toFixed(0)}k`;
  }
}
