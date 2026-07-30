'use client';

import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useGistData, SentimentRecord, QuadrantPoint, makeId } from '@/lib/gist';
import { QuadrantChart, QuadrantAsset } from '@/components/charts/QuadrantChart';
import { MODEL_VERSIONS } from '@/lib/modelVersions';
import { paceMonthly } from '@/lib/rotationPhase';

interface SnapshotMover {
  name: string; group: string;
  dayPct: number | null;
  r1m: number | null; r3m: number | null; r6m: number | null; r1y: number | null;
}

export interface SentimentSnapshot {
  date: string;
  table: SnapshotMover[]; // the full on-screen table
  accelerating: { name: string; group: string }[];
  levels: Record<string, number | null>;
}

interface SentimentData {
  headline?: string;
  drivers?: string; // the real news/events moving markets today (event → effect)
  regime_now?: string;
  regime_next?: string;
  macro_note?: string;
  macro_backdrop?: string;
  outlook_note?: string;
  rotation_note?: string;
  risk_note?: string;
  /** Upcoming catalysts: "asset — event (timing): impact", pipe-separated. */
  catalysts?: string;
  /** '1' when the brief was produced WITHOUT live web search (fallback run). */
  no_live_search?: string;
  confidence?: string;
  // Per-asset-class notes
  indexes_note?: string;
  crypto_note?: string;
  commodities_note?: string;
  sectors_note?: string;
  stocks_note?: string;
  // Fear & Greed index (CNN, fetched server-side and injected)
  fear_greed_score?: string;
  fear_greed_label?: string;
}

// Per-asset-class note key → display label + emoji.
const CLASS_NOTES: { key: keyof SentimentData; label: string }[] = [
  { key: 'indexes_note',     label: '📈 Indexes'     },
  { key: 'crypto_note',      label: '🪙 Crypto'      },
  { key: 'commodities_note', label: '🛢️ Commodities' },
  { key: 'sectors_note',     label: '🏭 Sectors'     },
  { key: 'stocks_note',      label: '🏷️ Stocks'      },
];

// Fear & Greed score → colour bucket.
function fgColor(score: number): string {
  if (score <= 25) return 'border-red-500/50 bg-red-500/10 text-red-300';
  if (score <= 45) return 'border-orange-500/50 bg-orange-500/10 text-orange-300';
  if (score <= 55) return 'border-gray-500/50 bg-gray-500/10 text-gray-300';
  if (score <= 75) return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300';
  return 'border-emerald-600/50 bg-emerald-600/15 text-emerald-200';
}

// Regime → colour. Unknown labels fall back to neutral.
const REGIME_CLS: Record<string, string> = {
  'Risk-On':          'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  'Reflation':        'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  'Goldilocks':       'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  'Soft Landing':     'border-sky-500/50 bg-sky-500/10 text-sky-300',
  'Transition':       'border-yellow-500/50 bg-yellow-500/10 text-yellow-300',
  'Stagflation Risk': 'border-orange-500/50 bg-orange-500/10 text-orange-300',
  'Risk-Off':         'border-red-500/50 bg-red-500/10 text-red-300',
};
function regimeCls(r?: string): string {
  return (r && REGIME_CLS[r]) || 'border-gray-600 bg-bg-input text-gray-200';
}

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtDay(date: string): string {
  try {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return date; }
}

// The full read of one sentiment record (latest card + each history entry share this).
function SentimentBody({ d, compact }: { d: SentimentData; compact?: boolean }) {
  const classNotes = CLASS_NOTES.filter(c => d[c.key]);
  return (
    <div className="space-y-3">
      {/* The grounded run failed and this came from the fallback: no live web
          access, so nothing here reflects today's news. Say so — an unmarked
          ungrounded brief is what produced invented event dates. */}
      {d.no_live_search === '1' && (
        <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
          ⚠ Written without live web search — treat as a read of the table only, not of today&apos;s news.
        </p>
      )}
      {d.headline && (
        <p className={clsx('font-semibold text-gray-100 leading-snug', compact ? 'text-xs' : 'text-sm')}>{d.headline}</p>
      )}

      {d.drivers && (
        <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-2.5">
          <p className="text-[9px] uppercase tracking-widest text-accent/70 mb-1">⚡ Why markets are moving today</p>
          <p className={clsx('text-gray-200 leading-relaxed', compact ? 'text-[11px]' : 'text-xs')}>{d.drivers}</p>
        </div>
      )}

      <div className={clsx('grid gap-2', d.fear_greed_score ? 'grid-cols-3' : 'grid-cols-2')}>
        <div className={clsx('rounded-lg border p-2.5', regimeCls(d.regime_now))}>
          <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">Now</p>
          <p className={clsx('font-black leading-tight', compact ? 'text-sm' : 'text-base')}>{d.regime_now ?? '—'}</p>
        </div>
        <div className={clsx('rounded-lg border p-2.5', regimeCls(d.regime_next))}>
          <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">Next ~month</p>
          <p className={clsx('font-black leading-tight', compact ? 'text-sm' : 'text-base')}>{d.regime_next ?? '—'}</p>
        </div>
        {d.fear_greed_score && (
          <div className={clsx('rounded-lg border p-2.5', fgColor(Number(d.fear_greed_score)))}>
            <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">Fear &amp; Greed</p>
            <p className={clsx('font-black leading-tight tabular-nums', compact ? 'text-sm' : 'text-base')}>{d.fear_greed_score}</p>
            {d.fear_greed_label && <p className="text-[9px] opacity-70 leading-tight mt-0.5">{d.fear_greed_label}</p>}
          </div>
        )}
      </div>

      <div className="space-y-2 text-xs leading-relaxed">
        {d.macro_note && (
          <p className="text-gray-300"><span className="text-gray-500 font-medium">Today: </span>{d.macro_note}</p>
        )}
        {d.macro_backdrop && (
          <p className="text-gray-300"><span className="text-gray-500 font-medium">Macro: </span>{d.macro_backdrop}</p>
        )}
        {d.outlook_note && (
          <p className="text-gray-300"><span className="text-gray-500 font-medium">Next month: </span>{d.outlook_note}</p>
        )}
        {d.rotation_note && (
          <p className="text-gray-300"><span className="text-gray-500 font-medium">Rotation: </span>{d.rotation_note}</p>
        )}
      </div>

      {classNotes.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-input/40 p-2.5 space-y-1.5">
          <p className="text-[9px] uppercase tracking-widest text-gray-600">By asset class</p>
          {classNotes.map(c => (
            <p key={c.key} className="text-xs text-gray-300 leading-relaxed">
              <span className="text-gray-400 font-medium">{c.label}: </span>{d[c.key]}
            </p>
          ))}
        </div>
      )}

      {/* Upcoming catalysts — events that have NOT happened yet, one per row so a
          scheduled vote or meeting is scannable at a glance. */}
      {d.catalysts && d.catalysts.trim().toLowerCase() !== 'n/a' && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/[0.06] p-2.5 space-y-1">
          <p className="text-[9px] uppercase tracking-widest text-violet-300/70">🗓️ Potential catalysts ahead</p>
          {d.catalysts.split('|').map(s => s.trim()).filter(Boolean).map((c, i) => (
            <p key={i} className={clsx('text-gray-200 leading-relaxed', compact ? 'text-[11px]' : 'text-xs')}>
              <span className="text-violet-300/60 mr-1">▸</span>{c}
            </p>
          ))}
        </div>
      )}

      {d.risk_note && (
        <p className="text-xs text-amber-300/90 leading-relaxed">
          <span className="text-amber-500/80 font-medium">Key risk: </span>{d.risk_note}
        </p>
      )}

      {d.confidence && (
        <p className="text-[10px] text-gray-600">Confidence: {d.confidence}</p>
      )}
    </div>
  );
}

// Re-draws a saved Rotation Quadrant from stored points. Collapsed by default so
// the history stays scannable; expand to see that day's full rotation picture.
function SavedQuadrant({ points, modelId, onAssetClick }: {
  points: QuadrantPoint[];
  modelId?: number;
  /** Opening an asset works here exactly as on the live quadrant. */
  onAssetClick?: (asset: QuadrantAsset) => void;
}) {
  const [open, setOpen] = useState(false);
  // Snapshots saved before the axes became "trend gap vs momentum" stored the old
  // pair (3M return, acceleration). They are redrawn from exactly what they stored —
  // the 3M return converted to a monthly pace so it sits on a comparable scale —
  // rather than being silently dropped or recomputed from today's history, which
  // would no longer be the picture that was saved.
  const assets = useMemo<QuadrantAsset[]>(
    () => points.map(p => ({
      ...p,
      trendGap: p.trendGap ?? (p.r3m != null ? paceMonthly(p.r3m, 3) : 0),
      momentum: p.momentum ?? p.accel ?? 0,
      isSelected: p.isPinned ?? false,
    })),
    [points],
  );
  const currentModelId = MODEL_VERSIONS.find(v => v.current)?.id;
  const modelLabel = modelId != null
    ? modelId === currentModelId
      ? `M${modelId} (current model)`
      : `M${modelId} — current is M${currentModelId ?? '?'}`
    : null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-input/30 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-border/20 transition-colors"
      >
        {open ? <ChevronDown size={12} className="shrink-0 text-gray-600" /> : <ChevronRight size={12} className="shrink-0 text-gray-600" />}
        <span className="text-[11px] font-medium text-gray-400">🧭 Rotation Quadrant — that day</span>
        {modelLabel && (
          <span className={clsx(
            'ml-auto text-[9px] px-1.5 py-0.5 rounded border leading-none',
            modelId === currentModelId
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-400',
          )}>
            {modelLabel}
          </span>
        )}
      </button>
      {open && (
        <div className="px-1.5 pb-2">
          <QuadrantChart assets={assets} onAssetClick={onAssetClick} />
        </div>
      )}
    </div>
  );
}

export function SentimentPanel({ buildSnapshot, getQuadrant, ready, onBeforeRun, onAssetClick }: {
  buildSnapshot: () => SentimentSnapshot;
  getQuadrant?: () => QuadrantPoint[];
  ready: boolean;
  onBeforeRun?: () => void;
  /** Click an asset on a SAVED quadrant to open it, same as on the live one. */
  onAssetClick?: (asset: QuadrantAsset) => void;
}) {
  const { data: gistData, update } = useGistData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const [showLatest, setShowLatest] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // History = the saved "database", newest first.
  const history = useMemo(
    () => [...(gistData.sentiments ?? [])].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
    [gistData.sentiments],
  );
  const latest = history[0];

  const run = async () => {
    // Reset the table to All + Day first so the view matches exactly what Gemini
    // is fed, then snapshot it on the next frame.
    onBeforeRun?.();
    setLoading(true);
    setError(null);
    setSecs(0);
    timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
    await new Promise(r => requestAnimationFrame(() => r(null)));
    try {
      const res = await fetch('/api/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSnapshot()),
      });
      const json = await res.json();
      if (json.error) {
        setError(
          json.error === 'missing_key'
            ? 'Sentiment needs a GEMINI_API_KEY set in the deployment environment.'
            : json.error === 'timeout'
              ? 'Timed out — the web search took too long. Try again.'
              : json.error === 'upstream'
                ? `Gemini error (${json.status ?? '?'})${json.message ? ': ' + json.message : ''}. Try again.`
                : json.error === 'unparsed'
                  // Name the actual cause: MAX_TOKENS means the model spent the
                  // budget thinking and never wrote the brief.
                  ? `Could not read sentiment${json.finishReason ? ` (${json.finishReason}` : ''}${json.thinkingTokens ? `, ${json.thinkingTokens} thinking tokens` : ''}${json.finishReason ? ')' : ''}. Try again.`
                  : 'Could not read sentiment. Try again.'
        );
        return;
      }
      // Save to the gist database, one record per day (a same-day refresh replaces it).
      const today = new Date().toISOString().slice(0, 10);
      const quadrant = getQuadrant?.();
      const activeModelId = MODEL_VERSIONS.find(v => v.current)?.id;
      const record: SentimentRecord = {
        id: makeId(),
        date: today,
        generatedAt: json.generatedAt ?? new Date().toISOString(),
        data: json.data,
        ...(quadrant && quadrant.length ? { quadrant } : {}),
        ...(activeModelId != null ? { modelId: activeModelId } : {}),
      };
      const prior = (gistData.sentiments ?? []).filter(r => r.date !== today);
      const nextList = [record, ...prior]
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .slice(0, 120);
      await update({ sentiments: nextList });
      setShowLatest(true);
    } catch {
      setError('Request failed. Try again.');
    } finally {
      setLoading(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const d = latest?.data as SentimentData | undefined;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">🧭 Market Sentiment</h3>
          <p className="text-[11px] text-gray-500 max-w-xl">
            Searches today&apos;s real market-moving news + reads the live leaderboard for a regime call — what&apos;s happening now, why, and the next month. Saved by date.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {latest && <span className="text-[10px] text-gray-500">{fmtWhen(latest.generatedAt)}</span>}
          {d && !loading && (
            <button
              onClick={() => setShowLatest(v => !v)}
              className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg hover:bg-border transition-colors"
              title={showLatest ? "Collapse" : "Expand last report"}
            >
              {showLatest ? '▲ Collapse' : '▼ Show last'}
            </button>
          )}
          <button
            onClick={run}
            disabled={loading || !ready}
            className={clsx('px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white transition-all', (loading || !ready) && 'opacity-50 cursor-not-allowed')}
            title={!ready ? "Waiting for leaderboard data to load" : "Read today's sentiment"}
          >
            {loading ? `Reading... ${secs}s` : latest ? '↻ Refresh' : '▶ Read sentiment'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5">
          <p className="text-[11px] text-red-300">{error}</p>
        </div>
      )}

      {loading && !d && (
        <div className="flex flex-col items-center justify-center h-28 gap-2">
          <LoadingSpinner size={24} />
          <span className="text-[11px] text-gray-500">Searching the web &amp; reading the tape...</span>
        </div>
      )}

      {d && showLatest && (
        <div className={clsx(loading && 'opacity-50')}>
          <SentimentBody d={d} />
          {latest?.quadrant && latest.quadrant.length > 0 && <SavedQuadrant points={latest.quadrant} modelId={latest.modelId} onAssetClick={onAssetClick} />}
          <p className="mt-3 text-[10px] text-gray-600 italic text-right">AI + web search — not financial advice.</p>
        </div>
      )}

      {/* History — the saved database, browsable by date */}
      {history.length > 0 && (
        <div className="border-t border-border pt-2">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            History ({history.length} day{history.length !== 1 ? 's' : ''})
          </button>
          {showHistory && (
            <div className="mt-2 space-y-1">
              {history.map(rec => {
                const isOpen = openId === rec.id;
                const rd = rec.data as SentimentData;
                return (
                  <div key={rec.id} className="rounded-lg border border-border bg-bg-input/30 overflow-hidden">
                    <button
                      onClick={() => setOpenId(isOpen ? null : rec.id)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-border/20 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? <ChevronDown size={12} className="shrink-0 text-gray-600" /> : <ChevronRight size={12} className="shrink-0 text-gray-600" />}
                        <span className="text-[11px] font-medium text-gray-300 shrink-0">{fmtDay(rec.date)}</span>
                        <span className="text-[11px] text-gray-500 truncate hidden sm:inline">{rd.headline}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={clsx('text-[9px] px-1.5 py-0.5 rounded border', regimeCls(rd.regime_now))}>{rd.regime_now ?? '—'}</span>
                        <span className="text-[9px] text-gray-600">→</span>
                        <span className={clsx('text-[9px] px-1.5 py-0.5 rounded border', regimeCls(rd.regime_next))}>{rd.regime_next ?? '—'}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-2.5 pb-2.5 pt-1 border-t border-border">
                        <SentimentBody d={rd} compact />
                        {rec.quadrant && rec.quadrant.length > 0 && <SavedQuadrant points={rec.quadrant} modelId={rec.modelId} onAssetClick={onAssetClick} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
