import type { DividendEvent } from '@/lib/utils';

// Dividend maths shared by every panel that shows a distributing asset — the stocks
// tab and the sector ETFs. One copy, because two would answer the same question
// differently the first time either was touched.

// Annual dividend yield using the trailing-12-months sum / current price.
export function computeDivYield(divs: DividendEvent[], price: number): number | null {
  if (!divs.length || !price) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const ttm = divs.filter(d => new Date(d.date) >= cutoff).reduce((s, d) => s + d.amount, 0);
  return ttm > 0 ? (ttm / price) * 100 : null;
}

// CAGR over full calendar years of dividend totals. Ignores the current (partial)
// year so two partial-year halves don't skew the rate.
export function computeDivCAGR(divs: DividendEvent[]): { cagr: number; years: number } | null {
  if (divs.length < 4) return null;
  const byYear = new Map<number, number>();
  for (const d of divs) {
    const y = new Date(d.date).getFullYear();
    byYear.set(y, (byYear.get(y) ?? 0) + d.amount);
  }
  const years = Array.from(byYear.keys()).sort();
  const currentYear = new Date().getFullYear();
  const full = years.filter(y => y < currentYear && (byYear.get(y) ?? 0) > 0);
  if (full.length < 2) return null;
  const first = byYear.get(full[0])!;
  const last = byYear.get(full[full.length - 1])!;
  const n = full[full.length - 1] - full[0];
  if (first <= 0 || last <= 0 || n <= 0) return null;
  return { cagr: (Math.pow(last / first, 1 / n) - 1) * 100, years: n };
}

