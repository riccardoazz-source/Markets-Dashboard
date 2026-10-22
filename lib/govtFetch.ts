// The fetching half of lib/govtBonds, split for the reason lib/curveParse was split from
// lib/treasuryCurve: the check harness compiles with a bare tsc that does not know Next's
// fetch options, so anything with a fetch in it cannot be covered. The parsing, the
// symbol scheme and the spread arithmetic live next door and are.

import { dbnomicsUrls, parseDbnomics, type GovtTenor, type YieldPoint } from './govtBonds';

const UA = 'Mozilla/5.0 (compatible; MarketPulse/1.0)';

export interface FetchedSeries {
  points: YieldPoint[];
  /** Which candidate answered, so diag can say. Null when none did. */
  source: string | null;
  trace: string[];
}

/**
 * The first candidate series that answers wins.
 *
 * Several are listed per tenor because these keys could not be verified from the machine
 * that wrote them — the sandbox reaches no external host. Trying them in order means a
 * key that has moved costs one tenor, not the country, and the trace says which one was
 * used so a wrong guess is visible rather than silent.
 */
export async function fetchGovtSeries(tenor: GovtTenor, timeoutMs = 9_000): Promise<FetchedSeries> {
  const trace: string[] = [];
  for (const path of tenor.sources) {
    for (const url of dbnomicsUrls(path)) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          next: { revalidate: 3600 },
        });
        if (!res.ok) { trace.push(`${path}: HTTP ${res.status}`); continue; }
        const points = parseDbnomics(await res.json());
        trace.push(`${path}: ${points.length} points`);
        if (points.length > 0) return { points, source: path, trace };
      } catch (e) {
        trace.push(`${path}: ${(e as Error).message}`);
      }
    }
  }
  return { points: [], source: null, trace };
}
