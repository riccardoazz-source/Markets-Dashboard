'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export interface SentimentSnapshot {
  date: string;
  leaders: { name: string; group: string; r1m: number | null; r3m: number | null; r1y: number | null }[];
  laggards: { name: string; group: string; r1m: number | null; r3m: number | null; r1y: number | null }[];
  accelerating: { name: string; group: string }[];
  levels: Record<string, number | null>;
}

interface SentimentData {
  headline?: string;
  regime_now?: string;
  regime_next?: string;
  macro_note?: string;
  outlook_note?: string;
  rotation_note?: string;
  risk_note?: string;
  confidence?: string;
}

interface Stored { data: SentimentData; generatedAt: string }

const LS_KEY = 'rotation-sentiment-v1';

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

export function SentimentPanel({ buildSnapshot, ready }: { buildSnapshot: () => SentimentSnapshot; ready: boolean }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setStored(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    setSecs(0);
    timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
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
                ? `Anthropic error (${json.status ?? '?'}). Try again.`
                : 'Could not read sentiment. Try again.'
        );
        return;
      }
      const next: Stored = { data: json.data, generatedAt: json.generatedAt };
      setStored(next);
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    } catch {
      setError('Request failed. Try again.');
    } finally {
      setLoading(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const d = stored?.data;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">🧭 Market Sentiment</h3>
          <p className="text-[11px] text-gray-500 max-w-xl">
            Reads the live leaderboard on this page + searches today&apos;s macro headlines for a regime call — now and the next month.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stored && <span className="text-[10px] text-gray-500">{fmtWhen(stored.generatedAt)}</span>}
          <button
            onClick={run}
            disabled={loading || !ready}
            className={clsx('px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white transition-all', (loading || !ready) && 'opacity-50 cursor-not-allowed')}
            title={!ready ? 'Waiting for leaderboard data to load' : 'Read today’s sentiment'}
          >
            {loading ? `Reading… ${secs}s` : stored ? '↻ Refresh' : '▶ Read sentiment'}
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
          <span className="text-[11px] text-gray-500">Searching the web &amp; reading the tape…</span>
        </div>
      )}

      {d && (
        <div className={clsx('space-y-3', loading && 'opacity-50')}>
          {d.headline && (
            <p className="text-sm font-semibold text-gray-100 leading-snug">{d.headline}</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className={clsx('rounded-lg border p-2.5', regimeCls(d.regime_now))}>
              <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">Now</p>
              <p className="text-base font-black leading-tight">{d.regime_now ?? '—'}</p>
            </div>
            <div className={clsx('rounded-lg border p-2.5', regimeCls(d.regime_next))}>
              <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">Next ~month</p>
              <p className="text-base font-black leading-tight">{d.regime_next ?? '—'}</p>
            </div>
          </div>

          <div className="space-y-2 text-xs leading-relaxed">
            {d.macro_note && (
              <p className="text-gray-300"><span className="text-gray-500 font-medium">Today: </span>{d.macro_note}</p>
            )}
            {d.outlook_note && (
              <p className="text-gray-300"><span className="text-gray-500 font-medium">Next month: </span>{d.outlook_note}</p>
            )}
            {d.rotation_note && (
              <p className="text-gray-300"><span className="text-gray-500 font-medium">Rotation: </span>{d.rotation_note}</p>
            )}
            {d.risk_note && (
              <p className="text-amber-300/90"><span className="text-amber-500/80 font-medium">Key risk: </span>{d.risk_note}</p>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-gray-600">
            {d.confidence && <span>Confidence: {d.confidence}</span>}
            <span className="italic">AI + web search — not financial advice.</span>
          </div>
        </div>
      )}
    </div>
  );
}
