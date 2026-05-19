// S&P 500 constituents from the datasets/s-and-p-500-companies GitHub repo.
// That CSV is auto-updated by the maintainers when the index rebalances, so the
// list stays current without us editing code.
const SP500_CSV = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv';
const TTL = 24 * 60 * 60_000; // refresh daily

export interface Sp500Constituent {
  symbol: string;       // Yahoo-compatible (BRK.B → BRK-B)
  name: string;
  sector: string;       // GICS sector
  subIndustry: string;  // GICS sub-industry
}

let cache: Sp500Constituent[] | null = null;
let cacheTs = 0;
let inflight: Promise<Sp500Constituent[]> | null = null;

// CSV uses commas with quoted fields containing commas. Simple parser sufficient for this file.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export async function fetchSp500(): Promise<Sp500Constituent[]> {
  if (cache && Date.now() - cacheTs < TTL) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(SP500_CSV, { cache: 'no-store' });
      if (!res.ok) {
        console.warn(`[sp500] HTTP ${res.status} — using stale cache`);
        return cache ?? [];
      }
      const text = await res.text();
      const lines = text.split('\n').slice(1).filter(Boolean);
      const out: Sp500Constituent[] = [];
      for (const line of lines) {
        const cols = splitCsvLine(line);
        const sym = cols[0]?.trim();
        if (!sym) continue;
        out.push({
          // Yahoo uses '-' instead of '.' (BRK.B → BRK-B, BF.B → BF-B)
          symbol: sym.replace('.', '-'),
          name: cols[1]?.trim() ?? sym,
          sector: cols[2]?.trim() ?? '',
          subIndustry: cols[3]?.trim() ?? '',
        });
      }
      if (out.length < 400) {
        console.warn(`[sp500] parsed only ${out.length} rows — keeping prior cache`);
        return cache ?? out;
      }
      cache = out;
      cacheTs = Date.now();
      return out;
    } catch (e) {
      console.warn('[sp500] fetch failed:', (e as Error).message);
      return cache ?? [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
