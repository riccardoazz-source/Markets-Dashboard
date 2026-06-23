'use client';

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface SingleContext {
  mode?: 'single';
  name: string;
  symbol: string;
  assetClass: string;
  price?: number | null;
  dayPct?: number | null;
  r1m?: number | null;
  r3m?: number | null;
  r6m?: number | null;
  r1y?: number | null;
}

interface CompareContext {
  mode: 'compare';
  assets: { name: string; symbol: string; totalReturn?: number | null; cagr?: number | null }[];
  correlations?: { a: string; b: string; r: number }[];
  timeframe?: string;
  label?: string;
}

type Props = SingleContext | CompareContext;

export function GeminiCommentButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label = props.mode === 'compare'
    ? (props.label ?? 'Compare Analysis')
    : props.name;

  const handleClick = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (comment || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gemini-comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(props),
      });
      const json = await res.json() as { comment?: string; error?: string; message?: string };
      if (json.comment) {
        setComment(json.comment);
      } else if (json.error === 'missing_key') {
        setError('Gemini API key not configured. Add GEMINI_API_KEY to your environment.');
      } else {
        setError(json.message ?? `Error: ${json.error ?? 'unknown'}`);
      }
    } catch {
      setError('Network error — could not reach Gemini.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        title="Get AI commentary from Gemini"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-purple-300 hover:border-purple-500/50 transition-colors text-xs font-medium"
      >
        <Sparkles size={13} />
        AI
      </button>

      {open && (
        <div className="fixed bottom-4 right-4 z-[200] w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-purple-500/30 bg-[#12172a] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 bg-purple-900/10">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles size={12} className="text-purple-400 shrink-0" />
              <span className="text-[11px] font-semibold text-purple-300 truncate">
                Gemini · {label}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors shrink-0"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-3 py-3 max-h-[60vh] overflow-y-auto">
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <LoadingSpinner size={14} />
                Searching the web &amp; analysing…
              </div>
            )}
            {error && !loading && (
              <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>
            )}
            {comment && !loading && (
              <p className="text-[11px] text-gray-300 leading-relaxed">{comment}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
