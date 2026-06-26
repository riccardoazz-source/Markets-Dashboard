'use client';

import { useRef, useState } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DEFAULT_PARAMS, ModelParams } from '@/lib/rotationModel';

interface SweepEval { capture: number; beatSpx: number; basketVsSpx: number; nDates: number }
interface SweepResp {
  ok: boolean; dataReady: boolean; universeSize: number; symbolsWithData: number;
  dates: number; fetchMs: number; trials: number;
  baseline: SweepEval; best: { params: ModelParams; eval: SweepEval };
}

// Human labels for the tunable parameters (the score-formula weights + guards).
const LABELS: Record<keyof ModelParams, string> = {
  wAcc: 'Accelerazione', wVQ: 'Volatilità buona', wTrend: 'Direzione (TRD)', wCycle: 'Ciclo (CYC)',
  wLead: 'Leadership', wRegime: 'Regime MA200', wVolume: 'Volume', wMacd: 'MACD', wExt: 'Anti blow-off',
  overheatCyclical: 'Overheat ciclici', overheatDefault: 'Overheat default', reboundWeight: 'Bonus rebound',
  cyclicalVqDiscount: 'Sconto VQ ciclici', lowVqFloor: 'Soglia low-VQ', lowVqWeight: 'Penalità low-VQ',
  secularLow: 'Secolare (low)', secularHigh: 'Secolare (high)', commodityExtWeight: 'EXT commodity',
};
const KEYS = Object.keys(LABELS) as (keyof ModelParams)[];

const TARGETS = [1000, 3000, 10000];

export function OptimizerPanel({ stockSymbols = [] }: { stockSymbols?: string[] }) {
  const [running, setRunning] = useState(false);
  const [trials, setTrials] = useState(0);
  const [target, setTarget] = useState(3000);
  const [best, setBest] = useState<{ params: ModelParams; eval: SweepEval } | null>(null);
  const [baseline, setBaseline] = useState<SweepEval | null>(null);
  const [status, setStatus] = useState('');
  const [meta, setMeta] = useState<{ dates: number; symbolsWithData: number; universeSize: number } | null>(null);
  const [error, setError] = useState('');
  const stopRef = useRef(false);

  const stockKey = [...stockSymbols].sort().join(',');

  const optimize = async () => {
    setRunning(true); setError(''); stopRef.current = false;
    setTrials(0); setBest(null);
    let carry: ModelParams | undefined;
    let total = 0;
    let warmAttempts = 0;
    try {
      while (!stopRef.current && total < target) {
        setStatus(carry ? 'Provo nuove combinazioni…' : 'Scarico i dati sul server (una volta)…');
        const res = await fetch('/api/rotation-sweep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stocks: stockSymbols, best: carry }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d: SweepResp = await res.json();
        setBaseline(d.baseline);
        setMeta({ dates: d.dates, symbolsWithData: d.symbolsWithData, universeSize: d.universeSize });
        if (!d.dataReady) {
          // Cold instance spent its budget fetching — retry against the now-warm cache.
          if (++warmAttempts > 6) throw new Error('Il server non riesce a scaricare i dati di mercato.');
          setStatus('Preparazione dati sul server… riprovo');
          continue;
        }
        carry = d.best.params;
        setBest(d.best);
        total += d.trials;
        setTrials(total);
        setStatus(`${total.toLocaleString()} combinazioni provate`);
      }
      setStatus(stopRef.current ? 'Fermato.' : 'Completato.');
    } catch (e) {
      setError((e as Error).message || 'Errore durante l’ottimizzazione.');
    } finally {
      setRunning(false);
    }
  };

  const stop = () => { stopRef.current = true; };

  const capGain = best && baseline ? (best.eval.capture - baseline.capture) * 100 : 0;
  const improved = capGain > 0.05;

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.04] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-violet-200">🧪 Ottimizzatore — backtest massivo</h3>
          <p className="text-[11px] text-gray-500 max-w-xl">
            Prova migliaia di combinazioni di pesi della <span className="font-medium">stessa formula</span>, valutate
            su decine di date (non solo le 6 visibili), e tiene quella con la <span className="font-medium">capture media</span> più alta.
            Il modello live non cambia finché non applichi il risultato.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!running ? (
            <button onClick={optimize} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-all">
              ▶ Ottimizza
            </button>
          ) : (
            <button onClick={stop} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 transition-all">
              ■ Ferma
            </button>
          )}
        </div>
      </div>

      {/* Target selector */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500">Combinazioni:</span>
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          {TARGETS.map(t => (
            <button key={t} disabled={running} onClick={() => setTarget(t)}
              className={clsx('px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all',
                target === t ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100')}>
              {t.toLocaleString()}
            </button>
          ))}
        </div>
        {stockSymbols.length > 0 && <span className="text-[11px] text-rose-300/70">+{stockSymbols.length} azioni attive</span>}
      </div>

      {running && (
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <LoadingSpinner size={14} /> {status}
          {trials > 0 && <span className="text-gray-500">· {((trials / target) * 100).toFixed(0)}%</span>}
        </div>
      )}
      {!running && status && !error && <p className="text-[11px] text-gray-500">{status}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {meta && (
        <p className="text-[10px] text-gray-600">
          {meta.symbolsWithData}/{meta.universeSize} asset con dati · {meta.dates} date di backtest
        </p>
      )}

      {best && baseline && (
        <div className="space-y-3">
          {/* Headline: baseline vs best capture */}
          <div className={clsx('rounded-lg border p-3', improved ? 'border-green-500/40 bg-green-500/10' : 'border-border bg-bg-input')}>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Modello live</div>
                <div className="font-bold text-gray-300">{(baseline.capture * 100).toFixed(1)}%</div>
              </div>
              <div className="text-gray-600">→</div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Migliore trovato</div>
                <div className={clsx('font-bold', improved ? 'text-green-300' : 'text-gray-300')}>{(best.eval.capture * 100).toFixed(1)}%</div>
              </div>
              {improved && <div className="text-green-400 font-semibold text-xs">+{capGain.toFixed(1)} pp capture</div>}
              <div className="ml-auto text-[10px] text-gray-500 text-right">
                batte S&P {(best.eval.beatSpx * 100).toFixed(0)}% volte<br />
                basket −S&P {best.eval.basketVsSpx >= 0 ? '+' : ''}{best.eval.basketVsSpx.toFixed(1)}pp
              </div>
            </div>
          </div>

          {/* Best parameters with delta vs live */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            {KEYS.map(k => {
              const v = best.params[k];
              const d = v - DEFAULT_PARAMS[k];
              const moved = Math.abs(d) > 0.005;
              return (
                <div key={k} className="flex items-center justify-between text-[11px] border-b border-border/40 py-0.5">
                  <span className="text-gray-500">{LABELS[k]}</span>
                  <span className="tabular-nums">
                    <span className={moved ? 'text-violet-200 font-semibold' : 'text-gray-400'}>{v.toFixed(3)}</span>
                    {moved && <span className={clsx('ml-1 text-[9px]', d > 0 ? 'text-green-500' : 'text-red-500')}>{d > 0 ? '+' : ''}{d.toFixed(3)}</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-gray-500">
            Quando sei soddisfatto, dimmi <span className="text-violet-300 font-medium">«applica»</span> e rendo questi pesi la prossima versione del modello (M24).
          </p>
        </div>
      )}
    </div>
  );
}
