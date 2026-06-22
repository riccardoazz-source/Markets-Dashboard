'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface Pick {
  symbol: string; name: string; group: string;
  r1m: number | null; r3m: number | null; r6m: number | null; r1y: number | null;
  stage: 'trend' | 'rebound' | 'neutral';
  fwd: number | null;
}

interface Scenario {
  key: string; label: string; asOf: string;
  picks: Pick[];
  basketFwd: number | null; universeFwd: number | null; spxFwd: number | null;
  nPicks: number; nBeatSpx: number;
}

interface Payload { generatedAt: string; scenarios: Scenario[] }

const GROUP_COLORS: Record<string, string> = {
  Indexes: '#3b82f6', Crypto: '#f97316', Commodities: '#f59e0b', Sectors: '#8b5cf6',
};

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function pctColor(v: number | null): string {
  if (v == null) return 'text-gray-500';
  if (v > 0) return 'text-green-400';
  if (v < 0) return 'text-red-400';
  return 'text-gray-500';
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('it-IT', { month: 'short', year: 'numeric' });
}

export function BacktestPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState('24m');

  const run = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/rotation-backtest');
      if (!res.ok) throw new Error();
      const d: Payload = await res.json();
      setData(d);
      setActive(d.scenarios[0]?.key ?? '24m');
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const scenario = data?.scenarios.find(s => s.key === active) ?? null;
  const beat = !!scenario && scenario.basketFwd != null && scenario.spxFwd != null && scenario.basketFwd > scenario.spxFwd;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">🔬 Backtest — macchina del tempo</h3>
          <p className="text-[11px] text-gray-500 max-w-xl">
            Torna indietro nel tempo, fa girare il modello con i <span className="font-medium">soli dati di allora</span>, e mostra cosa avrebbe consigliato di comprare — e quanto avrebbe reso da allora a oggi.
          </p>
        </div>
        {!data && (
          <button
            onClick={run}
            disabled={loading}
            className={clsx('shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white transition-all', loading && 'opacity-50 cursor-not-allowed')}
          >
            {loading ? 'Calcolo…' : '▶ Esegui backtest'}
          </button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <LoadingSpinner size={28} />
          <span className="text-[11px] text-gray-500">Scarico ~3 anni di storia per tutti gli asset…</span>
        </div>
      )}
      {error && <p className="text-sm text-gray-500">Backtest non riuscito. Riprova.</p>}

      {data && scenario && (
        <>
          {/* As-of date selector */}
          <div className="flex gap-1 bg-bg-input rounded-lg p-1 w-fit">
            {data.scenarios.map(s => (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={clsx(
                  'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                  active === s.key ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-border'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Verdict */}
          <div className={clsx('rounded-lg border p-3', scenario.basketFwd == null ? 'border-border bg-bg-input' : beat ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-500/10')}>
            <p className={clsx('text-sm font-semibold', scenario.basketFwd == null ? 'text-gray-300' : beat ? 'text-green-300' : 'text-red-300')}>
              {scenario.basketFwd == null
                ? 'Dati insufficienti per questo periodo'
                : beat
                  ? '✓ Il modello avrebbe avuto ragione'
                  : '✗ Il modello NON avrebbe battuto l’S&P 500'}
            </p>
            {scenario.basketFwd != null && (
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                Le scelte di <span className="font-medium">{fmtDate(scenario.asOf)}</span> avrebbero reso{' '}
                <span className={clsx('font-bold', pctColor(scenario.basketFwd))}>{fmtPct(scenario.basketFwd)}</span>{' '}
                da allora a oggi, contro{' '}
                <span className={clsx('font-bold', pctColor(scenario.spxFwd))}>{fmtPct(scenario.spxFwd)}</span> dell’S&P 500 e{' '}
                <span className={clsx('font-bold', pctColor(scenario.universeFwd))}>{fmtPct(scenario.universeFwd)}</span> della media di tutti gli asset.
              </p>
            )}
            {scenario.nPicks > 0 && (
              <p className="text-[11px] text-gray-400 mt-1">
                {scenario.nBeatSpx}/{scenario.nPicks} scelte hanno battuto l’S&P 500.
              </p>
            )}
          </div>

          {/* Picks */}
          {scenario.picks.length === 0 ? (
            <p className="text-xs text-gray-500">
              Il modello non avrebbe selezionato nulla a {fmtDate(scenario.asOf)} — nessun asset passava i gate. (A volte la cosa giusta è non comprare.)
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] text-gray-600">
                    <th className="px-2 py-1.5 text-left w-6">#</th>
                    <th className="px-2 py-1.5 text-left">Avrebbe comprato</th>
                    <th className="px-2 py-1.5 text-right">1M allora</th>
                    <th className="px-2 py-1.5 text-right">Da allora → oggi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scenario.picks.map((p, i) => (
                    <tr key={p.symbol}>
                      <td className="px-2 py-1.5 text-[11px] text-gray-600 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: GROUP_COLORS[p.group] ?? '#888' }} />
                          <span className="truncate text-xs font-medium text-gray-200">{p.name}</span>
                          {p.stage === 'rebound' && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 leading-none">↩ rebound</span>
                          )}
                          {p.stage === 'trend' && (
                            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-300 leading-none">✓ trend</span>
                          )}
                        </div>
                      </td>
                      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums', pctColor(p.r1m))}>{fmtPct(p.r1m)}</td>
                      <td className={clsx('px-2 py-1.5 text-right text-xs tabular-nums font-bold', pctColor(p.fwd))}>{fmtPct(p.fwd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-gray-600 leading-relaxed">
            Caveat onesti: universo = i 71 asset che abbiamo <span className="italic">oggi</span> in config (survivorship bias), prezzi di chiusura, nessun costo/tassa/slippage, ribilanciamento perfetto. ~3 anni di storia = pochi cicli. È un'indicazione della bontà del segnale, non una garanzia di rendimenti futuri.
          </p>
        </>
      )}
    </div>
  );
}
