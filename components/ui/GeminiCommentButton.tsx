'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send } from 'lucide-react';
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
  timeframe?: string;   // the period the user is viewing
  tools?: string[];     // active chart tools/indicators with their latest values
}

interface CompareContext {
  mode: 'compare';
  assets: { name: string; symbol: string; totalReturn?: number | null; cagr?: number | null }[];
  correlations?: { a: string; b: string; r: number }[];
  timeframe?: string;
  label?: string;
}

type Props = SingleContext | CompareContext;

interface Turn { role: 'user' | 'model'; text: string }

export function GeminiCommentButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const label = props.mode === 'compare'
    ? (props.label ?? 'Compare Analysis')
    : props.name;

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // Send `history` (the conversation so far) to the API and append the reply.
  const callApi = async (history: Turn[]) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gemini-comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...props, messages: history }),
      });
      const json = await res.json() as { comment?: string; error?: string; message?: string };
      if (json.comment) {
        setMessages([...history, { role: 'model', text: json.comment }]);
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

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    // First open → fetch the initial commentary (empty history).
    if (messages.length === 0 && !loading) callApi([]);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const next: Turn[] = [...messages, { role: 'user', text }];
    setMessages(next);
    callApi(next);
    // Refocus for the next question.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        title="Chat with Gemini about this asset"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-gray-400 hover:text-purple-300 hover:border-purple-500/50 transition-colors text-xs font-medium"
      >
        <Sparkles size={13} />
        AI
      </button>

      {open && (
        <div className="fixed bottom-4 right-4 z-[200] w-[380px] max-w-[calc(100vw-2rem)] h-[70vh] max-h-[560px] flex flex-col rounded-xl border border-purple-500/30 bg-[#12172a] shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 bg-purple-900/10 shrink-0">
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

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-xl rounded-br-sm bg-purple-600/25 border border-purple-500/30 px-3 py-2 text-[11px] text-gray-100 leading-relaxed'
                      : 'max-w-[90%] rounded-xl rounded-bl-sm bg-white/[0.04] border border-white/5 px-3 py-2 text-[11px] text-gray-300 leading-relaxed'
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <LoadingSpinner size={14} />
                {messages.length === 0 ? 'Searching the web & analysing…' : 'Thinking…'}
              </div>
            )}
            {error && !loading && (
              <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/5 p-2 shrink-0">
            <div className="flex items-end gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                placeholder={`Ask about ${props.mode === 'compare' ? 'this comparison' : label}…`}
                disabled={loading}
                className="flex-1 bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-gray-100 outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="p-1.5 rounded-lg bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send"
              >
                <Send size={13} />
              </button>
            </div>
            <p className="mt-1 text-[9px] text-gray-600 text-center">Chat stays on {props.mode === 'compare' ? 'these assets' : label}. Not saved.</p>
          </div>
        </div>
      )}
    </>
  );
}
