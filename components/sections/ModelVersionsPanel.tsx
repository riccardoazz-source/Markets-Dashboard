'use client';

import clsx from 'clsx';
import {
  MODEL_VERSIONS, PERIOD_ORDER, PERIOD_LABELS, computeReliability,
  type PeriodKey, type PeriodResult, type ModelVersion,
} from '@/lib/modelVersions';

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function pctColor(v: number | null | undefined): string {
  if (v == null) return 'text-gray-600';
  if (v > 0) return 'text-green-400';
  if (v < 0) return 'text-red-400';
  return 'text-gray-500';
}

// Compact per-period cell: basket return (bold, coloured) over SPX (muted) + pick count.
function PeriodCell({ r }: { r: PeriodResult | undefined }) {
  if (!r || r.basket == null) return <span className="text-gray-700">—</span>;
  const alpha = r.spx != null ? r.basket - r.spx : null;
  return (
    <div className="leading-tight">
      <div className={clsx('text-[11px] font-bold tabular-nums', pctColor(r.basket))}>{fmtPct(r.basket)}</div>
      <div className="text-[9px] tabular-nums text-gray-500">vs {fmtPct(r.spx)}</div>
      <div className="text-[9px] tabular-nums text-gray-600">
        {r.picks != null ? `${r.picks} pick` : ''}
        {alpha != null && (
          <span className={alpha >= 0 ? 'text-green-500' : 'text-red-500'}> · α{alpha >= 0 ? '+' : ''}{alpha.toFixed(0)}</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  // Live results for the CURRENT model, keyed by period — auto-filled into its row.
  liveResults?: Partial<Record<PeriodKey, PeriodResult>>;
}

export function ModelVersionsPanel({ liveResults }: Props) {
  // Merge live results into the current version's row so it always reflects the
  // latest backtest run without manual transcription.
  const versions: ModelVersion[] = MODEL_VERSIONS.map(v =>
    v.current && liveResults ? { ...v, results: { ...v.results, ...liveResults } } : v
  );

  const withRel = versions.map(v => ({ v, rel: computeReliability(v.results) }));
  // Best reliability among versions that have data — highlighted as the leader.
  const best = withRel
    .filter(x => x.rel != null)
    .sort((a, b) => (b.rel!.reliability) - (a.rel!.reliability))[0];

  return (
    <details className="rounded-lg border border-border bg-bg-input/40 text-xs group">
      <summary className="cursor-pointer select-none px-3 py-2 text-gray-300 font-medium hover:text-gray-100 flex items-center gap-2">
        <span className="transition-transform group-open:rotate-90">▶</span>
        📊 Model versions &amp; backtest results
        {best?.rel && (
          <span className="ml-auto text-[10px] text-gray-500">
            best: <span className="text-green-300 font-semibold">Model {best.v.id}</span> (rel {best.rel.reliability.toFixed(1)})
          </span>
        )}
      </summary>

      <div className="px-3 pb-3 pt-1 space-y-3">
        <p className="text-[10px] text-gray-500 leading-relaxed">
          The <span className="text-gray-300">current model</span> row auto-fills from the last backtest you run — no manual transcription needed.
          Each cell shows <span className="text-gray-300">basket %</span> · <span className="text-gray-500">vs S&amp;P 500</span> · picks · α (alpha vs SPX).
          <span className="text-gray-300">Reliability</span> gives <span className="text-gray-300">priority to capturing real winners</span> (Capt column) and
          penalises underperformance vs S&amp;P with increasing severity by horizon:
          1D irrelevant · 1M acceptable · <span className="text-red-300">5Y below S&amp;P = garbage</span> (penalty ×5).
          Few picks or few real winners caught further lower the score.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-[10px] text-gray-600">
                <th className="px-2 py-1.5 text-left">Modello</th>
                {PERIOD_ORDER.map(k => (
                  <th key={k} className="px-2 py-1.5 text-right">{PERIOD_LABELS[k]}</th>
                ))}
                <th className="px-2 py-1.5 text-right" title="Weighted average alpha vs S&P 500 (raw)">α w.</th>
                <th className="px-2 py-1.5 text-right" title="% of periods where the basket beat SPX">Hit</th>
                <th className="px-2 py-1.5 text-right" title="Weighted avg % of real top performers caught by the model">Capt</th>
                <th className="px-2 py-1.5 text-right" title="Media picks">Picks</th>
                <th className="px-2 py-1.5 text-right" title="Reliability ratio">Rel.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {withRel.map(({ v, rel }) => {
                const isBest = best && rel && best.v.id === v.id && rel.reliability > 0;
                return (
                  <tr key={v.id} className={clsx(v.current && 'bg-accent/5')}>
                    <td className="px-2 py-2 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-gray-200">M{v.id}</span>
                        {v.current && <span className="text-[8px] px-1 py-0.5 rounded bg-accent/20 text-accent-foreground text-accent leading-none">CURRENT</span>}
                        {isBest && <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/20 text-green-300 leading-none">★ best</span>}
                      </div>
                      <div className="text-[9px] text-gray-500 mt-0.5 max-w-[140px]">{v.name}</div>
                    </td>
                    {PERIOD_ORDER.map(k => (
                      <td key={k} className="px-2 py-2 text-right align-top"><PeriodCell r={v.results[k]} /></td>
                    ))}
                    <td className={clsx('px-2 py-2 text-right align-top text-[11px] font-bold tabular-nums', rel ? pctColor(rel.weightedAlpha) : 'text-gray-700')}>
                      {rel ? `${rel.weightedAlpha >= 0 ? '+' : ''}${rel.weightedAlpha.toFixed(1)}` : '—'}
                    </td>
                    <td className="px-2 py-2 text-right align-top text-[11px] tabular-nums text-gray-300">
                      {rel ? `${Math.round(rel.hitRate * 100)}%` : '—'}
                    </td>
                    <td className={clsx('px-2 py-2 text-right align-top text-[11px] tabular-nums', rel && rel.hasCapture ? 'text-gray-200 font-semibold' : 'text-gray-600')}>
                      {rel && rel.hasCapture ? `${Math.round(rel.captureRate * 100)}%` : '—'}
                    </td>
                    <td className="px-2 py-2 text-right align-top text-[11px] tabular-nums text-gray-300">
                      {rel ? rel.avgPicks.toFixed(1) : '—'}
                    </td>
                    <td className={clsx('px-2 py-2 text-right align-top text-sm font-bold tabular-nums', rel ? (rel.reliability > 0 ? 'text-green-300' : 'text-red-300') : 'text-gray-700')}>
                      {rel ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span>{rel.reliability.toFixed(1)}</span>
                          {rel.worst5y && <span className="text-[8px] px-1 rounded bg-red-500/20 text-red-300 leading-none mt-0.5" title="5Y below S&P 500 — garbage">🗑 5Y&lt;SPX</span>}
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Per-version formula reference */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-gray-400">Formulas</p>
          {versions.map(v => (
            <details key={v.id} className="rounded border border-border/60 bg-black/20">
              <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] text-gray-300 hover:text-gray-100">
                Model {v.id} — {v.name}{v.current ? ' (current)' : v.recordedAt ? ` · ${v.recordedAt}` : ''}
              </summary>
              <pre className="px-2 pb-2 pt-1 font-mono text-[10px] leading-relaxed text-gray-400 overflow-x-auto whitespace-pre">
{v.formula.join('\n')}
              </pre>
            </details>
          ))}
        </div>
      </div>
    </details>
  );
}
