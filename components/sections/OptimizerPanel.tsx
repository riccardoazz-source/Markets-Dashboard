'use client';

import { useRef, useState } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DEFAULT_PARAMS, ModelParams, ACCEL_MAX } from '@/lib/rotationModel';
import { evaluate, sampleParams, precomputeFeatures, CoordStep, SweepEval, DateSlice, DEFAULT_SLICE_OPTS, BOUNDS } from '@/lib/sweepCore';

interface WireWindow { horizonDays: number; fwd: [string, number][]; winners: string[]; spxFwd: number | null }
interface WireSlice {
  asOf: string;
  inputs: DateSlice['inputs'];
  windows: WireWindow[];
}
interface SliceResp {
  ok: boolean; universeSize: number; symbolsWithData: number; dates: number; kwin: number; slices: WireSlice[];
}

// Human labels for the tunable parameters (the score-formula weights + guards).
const LABELS: Record<keyof ModelParams, string> = {
  wAcc: 'Acceleration', wVQ: 'Good volatility', wTrend: 'Direction (TRD)', wCycle: 'Cycle (CYC)',
  wLead: 'Leadership', wRegime: 'MA200 regime', wVolume: 'Volume', wMacd: 'MACD', wExt: 'Anti blow-off',
  overheatCyclical: 'Overheat cyclicals', overheatDefault: 'Overheat default', reboundWeight: 'Rebound bonus',
  cyclicalVqDiscount: 'Cyclical VQ discount', lowVqFloor: 'Low-VQ floor', lowVqWeight: 'Low-VQ penalty',
  secularLow: 'Secular (low)', secularHigh: 'Secular (high)', commodityExtWeight: 'Commodity EXT',
};
const KEYS = Object.keys(LABELS) as (keyof ModelParams)[];

const TARGETS = [50000, 1000000, 10000000];
const fmtN = (n: number) => n >= 1000000 ? `${n / 1000000}M` : n >= 1000 ? `${n / 1000}K` : `${n}`;

type Mode = 'random' | 'coord';

// Rehydrate the JSON slices (Map/Set were sent as arrays) into what evaluate() expects.
function rehydrate(wire: WireSlice[]): DateSlice[] {
  return wire.map(s => ({
    asOf: s.asOf,
    inputs: s.inputs,
    windows: s.windows.map(w => ({
      horizonDays: w.horizonDays,
      fwd: new Map(w.fwd),
      winners: new Set(w.winners),
      spxFwd: w.spxFwd,
    })),
  }));
}

export function OptimizerPanel({ stockSymbols = [] }: { stockSymbols?: string[] }) {
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode>('random');
  const [trials, setTrials] = useState(0);
  const [target, setTarget] = useState(50000);
  const [best, setBest] = useState<{ params: ModelParams; eval: SweepEval } | null>(null);
  const [baseline, setBaseline] = useState<SweepEval | null>(null);
  const [status, setStatus] = useState('');
  const [meta, setMeta] = useState<{ dates: number; symbolsWithData: number; universeSize: number } | null>(null);
  const [error, setError] = useState('');
  const [coordSteps, setCoordSteps] = useState<CoordStep[] | null>(null);
  const [coordParam, setCoordParam] = useState<string | null>(null);
  const stopRef = useRef(false);

  const loadSlices = async (): Promise<{ slices: DateSlice[]; kwin: number }> => {
    setStatus('Loading market data once…');
    const res = await fetch('/api/rotation-sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stocks: stockSymbols }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d: SliceResp = await res.json();
    setMeta({ dates: d.dates, symbolsWithData: d.symbolsWithData, universeSize: d.universeSize });
    const slices = rehydrate(d.slices);
    if (slices.length === 0 || !slices.some(s => s.windows.some(w => w.winners.size > 0))) {
      throw new Error('No market data returned by the server.');
    }
    precomputeFeatures(slices);
    return { slices, kwin: d.kwin || DEFAULT_SLICE_OPTS.kwin };
  };

  const runRandom = async () => {
    setRunning(true); setError(''); stopRef.current = false;
    setTrials(0); setBest(null); setCoordSteps(null); setCoordParam(null);
    try {
      const { slices, kwin } = await loadSlices();
      const baseEval = evaluate(slices, DEFAULT_PARAMS, kwin, ACCEL_MAX);
      setBaseline(baseEval);
      let cur = { params: DEFAULT_PARAMS, e: baseEval };
      setBest({ params: cur.params, eval: cur.e });

      let done = 0;
      const t0 = Date.now();
      const FRAME_MS = 40;

      await new Promise<void>((resolve) => {
        const runChunk = () => {
          if (stopRef.current) return resolve();
          const frameDeadline = Date.now() + FRAME_MS;
          while (done < target && Date.now() < frameDeadline) {
            const around = Math.random() < 0.4 ? cur.params : undefined;
            const p = sampleParams(around, 0.2);
            const e = evaluate(slices, p, kwin, ACCEL_MAX);
            if (e.capture > cur.e.capture || (e.capture === cur.e.capture && e.basketVsSpx > cur.e.basketVsSpx)) {
              cur = { params: p, e };
            }
            done++;
          }
          setTrials(done);
          setBest({ params: cur.params, eval: cur.e });
          const secs = (Date.now() - t0) / 1000;
          const rate = done / Math.max(0.001, secs);
          const etaSec = rate > 0 ? Math.max(0, (target - done) / rate) : 0;
          const eta = etaSec > 90 ? `${Math.ceil(etaSec / 60)}m` : `${Math.ceil(etaSec)}s`;
          setStatus(`${done.toLocaleString()} / ${target.toLocaleString()} · ${Math.round(rate).toLocaleString()}/s · ~${eta} left`);
          if (done >= target) return resolve();
          setTimeout(runChunk, 0);
        };
        runChunk();
      });

      setStatus(stopRef.current ? `Stopped at ${done.toLocaleString()} sets.` : `Done — ${done.toLocaleString()} sets tested.`);
    } catch (e) {
      setError((e as Error).message || 'Error during optimization.');
    } finally {
      setRunning(false);
    }
  };

  // Coordinate descent: scan each of the 18 params one by one, best others fixed.
  // Yields between params so the UI shows progress. ~80 steps per param × 18 = 1440 evaluations total.
  const runCoord = async () => {
    setRunning(true); setError(''); stopRef.current = false;
    setCoordSteps(null); setCoordParam(null);
    try {
      const { slices, kwin } = await loadSlices();
      const startParams = best?.params ?? DEFAULT_PARAMS;
      const baseEval = evaluate(slices, DEFAULT_PARAMS, kwin, ACCEL_MAX);
      if (!baseline) setBaseline(baseEval);

      const STEPS = 120; // steps per parameter (finer grid)
      let cur = { ...startParams };
      const steps: CoordStep[] = [];

      for (let i = 0; i < KEYS.length; i++) {
        if (stopRef.current) break;
        const k = KEYS[i];
        setCoordParam(`${i + 1}/${KEYS.length} — ${LABELS[k]}`);
        setStatus(`Scanning ${LABELS[k]} (${i + 1} of ${KEYS.length})…`);

        // Yield to UI between parameters so the browser stays responsive
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        const [lo, hi] = BOUNDS[k];
        const oldCapture = evaluate(slices, cur, kwin, ACCEL_MAX).capture;
        let bestCapture = oldCapture;
        let bestVal = cur[k];
        for (let j = 0; j <= STEPS; j++) {
          const v = lo + (j / STEPS) * (hi - lo);
          const candidate = { ...cur, [k]: v };
          if (k === 'secularLow' && candidate.secularHigh <= v + 0.05) candidate.secularHigh = Math.min(v + 0.1, 0.9);
          if (k === 'secularHigh' && v <= cur.secularLow + 0.05) continue;
          const cap = evaluate(slices, candidate, kwin, ACCEL_MAX).capture;
          if (cap > bestCapture) { bestCapture = cap; bestVal = v; }
        }
        steps.push({ key: k, oldVal: cur[k], newVal: bestVal, oldCapture, newCapture: bestCapture });
        cur = { ...cur, [k]: bestVal };
        setCoordSteps([...steps]);
        setBest({ params: cur, eval: evaluate(slices, cur, kwin, ACCEL_MAX) });
      }

      setCoordParam(null);
      setStatus(stopRef.current ? 'Stopped.' : `Done — all ${KEYS.length} parameters tuned.`);
    } catch (e) {
      setError((e as Error).message || 'Error during coordinate descent.');
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
          <h3 className="text-sm font-semibold text-violet-200">🧪 Optimizer — massive backtest</h3>
          <p className="text-[11px] text-gray-500 max-w-xl">
            Downloads the data <span className="font-medium">once</span>, then tries thousands of weight combinations of the
            <span className="font-medium"> same formula</span> right here in your browser — scored across dozens of dates
            (not just the 6 visible ones) — and keeps the one with the highest <span className="font-medium">average capture</span>.
            The live model doesn&apos;t change until you apply the result.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!running ? (
            <>
              <button onClick={mode === 'random' ? runRandom : runCoord}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-all">
                ▶ {mode === 'random' ? 'Optimize' : 'Coordinate Descent'}
              </button>
            </>
          ) : (
            <button onClick={stop} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 transition-all">
              ■ Stop
            </button>
          )}
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-bg-input rounded-lg p-1">
          <button disabled={running} onClick={() => setMode('random')}
            className={clsx('px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all',
              mode === 'random' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100')}>
            Random sweep
          </button>
          <button disabled={running} onClick={() => setMode('coord')}
            className={clsx('px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all',
              mode === 'coord' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100')}>
            Coordinate descent
          </button>
        </div>
        {mode === 'coord' && (
          <span className="text-[10px] text-gray-500">
            Tunes one parameter at a time (others fixed) — 18 passes, ~120 steps each
            {best && <span className="text-violet-300"> · starts from current best</span>}
          </span>
        )}
      </div>

      {/* Target selector — only for random mode */}
      {mode === 'random' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">Combinations:</span>
          <div className="flex gap-1 bg-bg-input rounded-lg p-1">
            {TARGETS.map(t => (
              <button key={t} disabled={running} onClick={() => setTarget(t)}
                className={clsx('px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all',
                  target === t ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100')}>
                {fmtN(t)}
              </button>
            ))}
          </div>
          {stockSymbols.length > 0 && <span className="text-[11px] text-rose-300/70">+{stockSymbols.length} active stocks</span>}
        </div>
      )}

      {running && (
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <LoadingSpinner size={14} /> {status}
          {mode === 'random' && trials > 0 && <span className="text-gray-500">· {((trials / target) * 100).toFixed(0)}%</span>}
        </div>
      )}
      {!running && status && !error && <p className="text-[11px] text-gray-500">{status}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {meta && (
        <p className="text-[10px] text-gray-600">
          {meta.symbolsWithData}/{meta.universeSize} assets with data · {meta.dates} backtest dates
        </p>
      )}

      {/* Coordinate descent live progress */}
      {mode === 'coord' && coordSteps && coordSteps.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-input p-3 space-y-1">
          <div className="text-[10px] text-gray-500 uppercase mb-1">
            Coordinate descent progress {coordParam && <span className="text-violet-300">— {coordParam}</span>}
          </div>
          <div className="grid grid-cols-1 gap-y-0.5 max-h-48 overflow-y-auto">
            {coordSteps.map((s) => {
              const gained = (s.newCapture - s.oldCapture) * 100;
              const moved = Math.abs(s.newVal - s.oldVal) > 0.001;
              return (
                <div key={s.key} className="flex items-center justify-between text-[10px] py-0.5 border-b border-border/30">
                  <span className={clsx('w-36 truncate', gained > 0.05 ? 'text-green-300 font-semibold' : 'text-gray-500')}>{LABELS[s.key]}</span>
                  <span className="tabular-nums text-gray-400">
                    {s.oldVal.toFixed(3)} → <span className={moved ? 'text-violet-200 font-semibold' : ''}>{s.newVal.toFixed(3)}</span>
                  </span>
                  <span className={clsx('w-16 text-right tabular-nums', gained > 0.05 ? 'text-green-400' : 'text-gray-600')}>
                    {gained > 0.01 ? `+${gained.toFixed(2)}pp` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {best && baseline && (
        <div className="space-y-3">
          {/* Headline: baseline vs best capture */}
          <div className={clsx('rounded-lg border p-3', improved ? 'border-green-500/40 bg-green-500/10' : 'border-border bg-bg-input')}>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Live model</div>
                <div className="font-bold text-gray-300">{(baseline.capture * 100).toFixed(1)}%</div>
              </div>
              <div className="text-gray-600">→</div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Best found</div>
                <div className={clsx('font-bold', improved ? 'text-green-300' : 'text-gray-300')}>{(best.eval.capture * 100).toFixed(1)}%</div>
              </div>
              {improved && <div className="text-green-400 font-semibold text-xs">+{capGain.toFixed(1)} pp capture</div>}
              <div className="ml-auto text-[10px] text-gray-500 text-right">
                beats S&P {(best.eval.beatSpx * 100).toFixed(0)}% of the time<br />
                basket −S&P {best.eval.basketVsSpx >= 0 ? '+' : ''}{best.eval.basketVsSpx.toFixed(1)}pp
              </div>
            </div>
          </div>

          {/* Best parameters with delta vs live */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            {KEYS.map(k => {
              const v = best.params[k];
              const dv = v - DEFAULT_PARAMS[k];
              const moved = Math.abs(dv) > 0.005;
              return (
                <div key={k} className="flex items-center justify-between text-[11px] border-b border-border/40 py-0.5">
                  <span className="text-gray-500">{LABELS[k]}</span>
                  <span className="tabular-nums">
                    <span className={moved ? 'text-violet-200 font-semibold' : 'text-gray-400'}>{v.toFixed(3)}</span>
                    {moved && <span className={clsx('ml-1 text-[9px]', dv > 0 ? 'text-green-500' : 'text-red-500')}>{dv > 0 ? '+' : ''}{dv.toFixed(3)}</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-gray-500">
            When you&apos;re happy with the result, tell me <span className="text-violet-300 font-medium">&laquo;apply&raquo;</span> and I&apos;ll make these weights the next model version (M24).
          </p>
        </div>
      )}
    </div>
  );
}
