import { NextResponse } from 'next/server';
import { INDEXES, COMMODITIES, CRYPTO_IDS, CRYPTO_YAHOO_SYMBOLS, SECTORS } from '@/lib/config';
import { fetchYahooChart } from '@/lib/yahoo';
import { classifyPhase, ROTATION_PHASES } from '@/lib/rotationPhase';
import { fmt, priceAsOf, type Hist, type BtMeta } from '@/lib/backtestCore';
import { trendAxesSeries } from '@/lib/rotationPhase';
import { subYears, addMonths } from 'date-fns';

// Yahoo answers the edge network but blocks the Node serverless IPs.
export const runtime = 'edge';
export const maxDuration = 25;

// ── Phase Lab ────────────────────────────────────────────────────────────────
// Does the quadrant actually PREDICT anything?
//
// The labels claim a cycle: Recovering is the entry, Fading is the exit. That is a
// testable claim, and until it is tested the four colours are decoration. This
// endpoint walks history day by day, labels every asset with the SAME chain the
// live app uses (trendAxesSeries → classifyPhase) on every daily bar, using only data
// available on that date, and then looks at what the price did over the following
// 1, 3 and 6 months.
//
// Two things come out:
//   • forward return per phase — a working cycle model shows
//     Recovering ≥ Trending > Fading > Lagging
//   • the transition matrix — a cycle has to actually TURN. If Recovering leads to
//     Lagging as often as to Trending, there is no cycle, only noise with names.
//
// Everything it returns is additive counters, so the client can run it a handful of
// symbols at a time and sum the results. That keeps each request inside the
// platform's budget no matter how long the history.

const BASE_UNIVERSE: BtMeta[] = [
  ...INDEXES.map(i => ({ symbol: i.symbol, name: i.name, group: 'Indexes' })),
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, group: 'Commodities' })),
  ...CRYPTO_IDS.map(e => ({ symbol: CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, name: e.name, group: 'Crypto' })),
  ...SECTORS.map(s => ({ symbol: s.symbol, name: s.name, group: 'Sectors' })),
];
const META = new Map(BASE_UNIVERSE.map(m => [m.symbol, m]));

const HORIZONS = [1, 3, 6] as const;
type Bucket = { sum: number; n: number; wins: number };
const emptyBucket = (): Bucket => ({ sum: 0, n: 0, wins: 0 });

export interface PhaseStats {
  /** phase → horizon (months) → forward-return bucket */
  perPhase: Record<string, Record<string, Bucket>>;
  /** phase → group → horizon → bucket, so a class can be read on its own */
  perGroup: Record<string, Record<string, Record<string, Bucket>>>;
  /** from-phase → to-phase → count, each time the call actually CHANGES */
  transitions: Record<string, Record<string, number>>;
  samples: number;
  symbolsDone: string[];
  symbolsEmpty: string[];
}

function blankStats(): PhaseStats {
  const perPhase: PhaseStats['perPhase'] = {};
  const transitions: PhaseStats['transitions'] = {};
  for (const p of ROTATION_PHASES) {
    perPhase[p] = Object.fromEntries(HORIZONS.map(h => [String(h), emptyBucket()]));
    transitions[p] = Object.fromEntries(ROTATION_PHASES.map(q => [q, 0]));
  }
  return { perPhase, perGroup: {}, transitions, samples: 0, symbolsDone: [], symbolsEmpty: [] };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const years = Math.max(1, Math.min(25, Number(searchParams.get('years') ?? 15)));
  const symbols = [...new Set(
    (searchParams.get('symbols') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  )];
  if (!symbols.length) {
    // No symbols: hand back the work list so the client can chunk it.
    return NextResponse.json({ universe: BASE_UNIVERSE.map(m => m.symbol) });
  }

  const now = new Date();
  // Extra history in front of the window: the FIRST labelled date still needs its
  // own trailing year to be scored, exactly as any other date does.
  const from = subYears(now, years + 2);

  const stats = blankStats();

  for (const symbol of symbols) {
    const meta = META.get(symbol) ?? { symbol, name: symbol, group: 'Stocks' };
    const hist: Hist = await fetchYahooChart(symbol, from, now, '1d').catch(() => [] as Hist);
    if (hist.length < 400) { stats.symbolsEmpty.push(symbol); continue; }
    const histMap = new Map<string, Hist>([[symbol, hist]]);
    const firstDate = hist[0].date;

    // The model is computed on EVERY daily bar — one pass, the same code the panel
    // draws from. It used to be re-derived once a month, and with calls that last about
    // seventeen days that meant most of them were never observed at all: the table was
    // measuring the sampling as much as the model.
    const axes = trendAxesSeries(hist);
    const startStr = fmt(subYears(now, years));

    // Observations are taken WEEKLY. Daily would count the same call twenty times over
    // and say nothing new; monthly skipped whole calls. And every CHANGE of call is
    // counted, wherever it falls in the week — the transition matrix is about what the
    // next call turns out to be, which is the question worth asking, and reading it off
    // a monthly grid answered a different one.
    let prevPhase: string | null = null;
    let lastSampled = -Infinity;
    for (let i = 0; i < hist.length; i++) {
      const dateStr = hist[i].date;
      if (dateStr < startStr || dateStr <= firstDate) continue;
      const ax = axes[i];
      const phase = ax ? classifyPhase(ax.macroGap, ax.momentum) : null;
      if (!phase) { prevPhase = null; continue; }

      if (prevPhase && phase !== prevPhase) stats.transitions[prevPhase][phase] += 1;
      prevPhase = phase;

      const t = Date.parse(`${dateStr}T00:00:00Z`);
      if (t - lastSampled < 7 * 86_400_000) continue;
      lastSampled = t;

      const px0 = hist[i].close;
      if (!(px0 > 0)) continue;
      stats.samples += 1;

      for (const h of HORIZONS) {
        const fwdDate = fmt(addMonths(new Date(t), h));
        // Only count a horizon that has actually elapsed — otherwise the most
        // recent months would contribute a truncated, flattering return.
        if (fwdDate > fmt(now)) continue;
        const px1 = priceAsOf(hist, fwdDate);
        if (px1 == null || px1 <= 0) continue;
        const ret = (px1 / px0 - 1) * 100;
        const b = stats.perPhase[phase][String(h)];
        b.sum += ret; b.n += 1; if (ret > 0) b.wins += 1;

        const g = (stats.perGroup[phase] ??= {});
        const gg = (g[meta.group] ??= Object.fromEntries(HORIZONS.map(x => [String(x), emptyBucket()])));
        const gb = gg[String(h)];
        gb.sum += ret; gb.n += 1; if (ret > 0) gb.wins += 1;
      }
    }
    stats.symbolsDone.push(symbol);
  }

  return NextResponse.json(stats);
}
