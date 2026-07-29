'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { FlaskConical, ChevronDown, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PHASE_META, ROTATION_PHASES, RotationPhase } from '@/lib/rotationPhase';

// Does the quadrant predict anything? This is the instrument that answers it with
// numbers instead of impressions — and the reason it lives in the app rather than
// in a spreadsheet is that every future change to the formula has to be judged the
// same way. Run it, read it, change a variable, run it again.

type Bucket = { sum: number; n: number; wins: number };
interface Stats {
  perPhase: Record<string, Record<string, Bucket>>;
  perGroup: Record<string, Record<string, Record<string, Bucket>>>;
  transitions: Record<string, Record<string, number>>;
  samples: number;
  symbolsDone: string[];
  symbolsEmpty: string[];
}

const HORIZONS = ['1', '3', '6'] as const;
const CHUNK = 6;          // symbols per request — small enough to always come back

const addBucket = (a: Bucket, b: Bucket): Bucket => ({ sum: a.sum + b.sum, n: a.n + b.n, wins: a.wins + b.wins });

function merge(a: Stats, b: Stats): Stats {
  const out: Stats = {
    perPhase: {}, perGroup: {}, transitions: {},
    samples: a.samples + b.samples,
    symbolsDone: [...a.symbolsDone, ...b.symbolsDone],
    symbolsEmpty: [...a.symbolsEmpty, ...b.symbolsEmpty],
  };
  for (const p of ROTATION_PHASES) {
    out.perPhase[p] = Object.fromEntries(HORIZONS.map(h => [
      h, addBucket(a.perPhase?.[p]?.[h] ?? { sum: 0, n: 0, wins: 0 }, b.perPhase?.[p]?.[h] ?? { sum: 0, n: 0, wins: 0 }),
    ]));
    out.transitions[p] = Object.fromEntries(ROTATION_PHASES.map(q => [
      q, (a.transitions?.[p]?.[q] ?? 0) + (b.transitions?.[p]?.[q] ?? 0),
    ]));
    const groups = new Set([...Object.keys(a.perGroup?.[p] ?? {}), ...Object.keys(b.perGroup?.[p] ?? {})]);
    if (groups.size) {
      out.perGroup[p] = {};
      for (const g of groups) {
        out.perGroup[p][g] = Object.fromEntries(HORIZONS.map(h => [
          h, addBucket(a.perGroup?.[p]?.[g]?.[h] ?? { sum: 0, n: 0, wins: 0 }, b.perGroup?.[p]?.[g]?.[h] ?? { sum: 0, n: 0, wins: 0 }),
        ]));
      }
    }
  }
  return out;
}

const mean = (b: Bucket | undefined) => (b && b.n > 0 ? b.sum / b.n : null);
const hit = (b: Bucket | undefined) => (b && b.n > 0 ? (b.wins / b.n) * 100 : null);
const fmtPct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const col = (v: number | null) => (v == null ? 'text-gray-600' : v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400');

export function PhaseLabPanel() {
  const [open, setOpen] = useState(false);
  const [years, setYears] = useState(15);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true); setError(null); setStats(null); setProgress(null);
    try {
      const uni = await fetch('/api/phase-lab').then(r => r.json()) as { universe: string[] };
      const all = uni.universe ?? [];
      if (!all.length) throw new Error('no universe');
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
      setProgress({ done: 0, total: all.length });

      let acc: Stats | null = null;
      for (const [i, c] of chunks.entries()) {
        const part = await fetch(
          `/api/phase-lab?years=${years}&symbols=${encodeURIComponent(c.join(','))}`,
        ).then(r => r.json()) as Stats;
        acc = acc ? merge(acc, part) : part;
        // Show the table filling in rather than a spinner for a minute: the numbers
        // are already meaningful after the first few assets.
        setStats(acc);
        setProgress({ done: Math.min(all.length, (i + 1) * CHUNK), total: all.length });
      }
    } catch {
      setError('Could not run the study — the data source did not answer.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-border/20 transition-colors"
      >
        {open ? <ChevronDown size={13} className="shrink-0 text-gray-600" /> : <ChevronRight size={13} className="shrink-0 text-gray-600" />}
        <FlaskConical size={13} className="text-accent shrink-0" />
        <span className="text-xs font-semibold text-gray-300">Phase Lab — does the quadrant predict?</span>
        {stats && <span className="ml-auto text-[10px] text-gray-500">{stats.samples.toLocaleString()} observations</span>}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[10px] text-gray-500 leading-snug">
            Every asset is labelled month by month with the same chain the live app uses, on that date&apos;s data only,
            then measured against what the price did over the following 1, 3 and 6 months. A working cycle model shows{' '}
            <b className="text-gray-400">Recovering ≥ Trending &gt; Fading &gt; Lagging</b>, and a transition matrix that
            actually turns.
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-gray-500">Lookback</span>
            <div className="flex gap-1 bg-bg-input rounded-lg p-1">
              {[5, 10, 15, 20].map(y => (
                <button key={y} onClick={() => setYears(y)} disabled={running}
                  className={clsx('px-2 py-0.5 text-[11px] font-semibold rounded-md transition-colors',
                    years === y ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100')}>
                  {y}Y
                </button>
              ))}
            </div>
            <button onClick={run} disabled={running}
              className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-accent text-white disabled:opacity-50 hover:bg-accent/80 transition">
              {running ? 'Running…' : 'Run study'}
            </button>
            {running && <LoadingSpinner size={14} />}
            {progress && (
              <span className="text-[10px] text-gray-500">{progress.done}/{progress.total} assets</span>
            )}
          </div>

          {error && (
            <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">⚠ {error}</p>
          )}

          {stats && (
            <>
              {/* Forward return by phase */}
              <div className="overflow-x-auto">
                <table className="text-[11px] tabular-nums w-full">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left font-semibold py-1 pr-3">Phase</th>
                      {HORIZONS.map(h => (
                        <th key={h} className="text-right font-semibold py-1 px-2">+{h}M avg</th>
                      ))}
                      {HORIZONS.map(h => (
                        <th key={`w${h}`} className="text-right font-semibold py-1 px-2">+{h}M win</th>
                      ))}
                      <th className="text-right font-semibold py-1 pl-2">obs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROTATION_PHASES.map(p => {
                      const b3 = stats.perPhase?.[p]?.['3'];
                      return (
                        <tr key={p} className="border-t border-white/5">
                          <td className="py-1 pr-3">
                            <span className={clsx('px-1.5 py-0.5 rounded text-[10px]', PHASE_META[p as RotationPhase].cls)}>{p}</span>
                          </td>
                          {HORIZONS.map(h => {
                            const m = mean(stats.perPhase?.[p]?.[h]);
                            return <td key={h} className={clsx('text-right px-2 font-semibold', col(m))}>{fmtPct(m)}</td>;
                          })}
                          {HORIZONS.map(h => {
                            const w = hit(stats.perPhase?.[p]?.[h]);
                            return <td key={`w${h}`} className="text-right px-2 text-gray-400">{w == null ? '—' : `${w.toFixed(0)}%`}</td>;
                          })}
                          <td className="text-right pl-2 text-gray-600">{b3?.n ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Transition matrix — a cycle has to turn */}
              <div className="overflow-x-auto">
                <p className="text-[10px] text-gray-500 mb-1">
                  Where each phase goes next month (row = from, % of that row)
                </p>
                <table className="text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left font-semibold py-1 pr-3">from ↓ / to →</th>
                      {ROTATION_PHASES.map(q => <th key={q} className="text-right font-semibold py-1 px-2">{q}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ROTATION_PHASES.map(p => {
                      const row = stats.transitions?.[p] ?? {};
                      const tot = ROTATION_PHASES.reduce((s, q) => s + (row[q] ?? 0), 0);
                      return (
                        <tr key={p} className="border-t border-white/5">
                          <td className="py-1 pr-3">
                            <span className={clsx('px-1.5 py-0.5 rounded text-[10px]', PHASE_META[p as RotationPhase].cls)}>{p}</span>
                          </td>
                          {ROTATION_PHASES.map(q => {
                            const v = tot > 0 ? ((row[q] ?? 0) / tot) * 100 : null;
                            const self = p === q;
                            return (
                              <td key={q} className={clsx('text-right px-2', self ? 'text-gray-500' : v != null && v > 20 ? 'text-gray-100 font-semibold' : 'text-gray-400')}>
                                {v == null ? '—' : `${v.toFixed(0)}%`}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {stats.symbolsEmpty.length > 0 && (
                <p className="text-[9px] text-gray-600">
                  Skipped for want of history: {stats.symbolsEmpty.join(', ')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
