'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useGistData } from '@/lib/gist';

// ─────────────────────────────────────────────────────────────────────────────
// "My Strategy" — the user's own rotation playbook, listed AND evaluated live
// against current data so it shows which branch is active right now.
//
//   USD/EUR < 5-year average  → USD stocks
//       · high valuation → options   · low valuation → no options
//   USD/EUR > 5-year average  → EU stocks + Emerging Markets
//   Crypto — 4-year cycle: buy when price is below ~the 200-week MA
//   Rates falling → REITs + mortgage REITs + gold + silver
//   Rates rising  → Banks + BDCs
// ─────────────────────────────────────────────────────────────────────────────

interface Signals {
  eurusd: number | null;
  eurusdAvg5y: number | null;
  btc: number | null;
  btc200w: number | null;
  rateNow: number | null;
  rate12m: number | null;
}

const fmt = (v: number | null, d = 4) => (v == null ? '—' : v.toFixed(d));

function useStrategySignals(): { s: Signals; loading: boolean } {
  const [s, setS] = useState<Signals>({ eurusd: null, eurusdAvg5y: null, btc: null, btc200w: null, rateNow: null, rate12m: null });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
    (async () => {
      const out: Signals = { eurusd: null, eurusdAvg5y: null, btc: null, btc200w: null, rateNow: null, rate12m: null };
      // EUR/USD — latest vs 5-year average
      try {
        const r = await fetch('/api/historical?symbol=EURUSD=X&timeframe=5Y').then(x => x.json());
        const rows: { close: number }[] = Array.isArray(r) ? r : [];
        const closes = rows.map(p => p.close).filter((c): c is number => typeof c === 'number' && c > 0);
        if (closes.length) {
          out.eurusd = closes[closes.length - 1];
          out.eurusdAvg5y = closes.reduce((a, b) => a + b, 0) / closes.length;
        }
      } catch { /* leave null */ }
      // Bitcoin — price vs 200-week MA
      try {
        const r = await fetch('/api/crypto?mode=markets').then(x => x.json());
        const btc = Array.isArray(r) ? r.find((c: { id?: string; symbol?: string }) => c.id === 'bitcoin' || c.symbol === 'BTC') : null;
        out.btc = num(btc?.price); out.btc200w = num(btc?.sma200w);
      } catch { /* leave null */ }
      // Fed funds — direction over the last ~12 months
      try {
        const from = new Date(); from.setMonth(from.getMonth() - 15);
        const r = await fetch(`/api/macro?mode=history&id=FEDFUNDS&from=${from.toISOString().slice(0, 10)}`).then(x => x.json());
        const rows: { date: string; value: number }[] = r?.data ?? r?.points ?? (Array.isArray(r) ? r : []);
        const pts = rows.filter(p => typeof p.value === 'number' && isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
        if (pts.length) {
          out.rateNow = pts[pts.length - 1].value;
          const target = pts[pts.length - 1].date;
          const yEarlier = new Date(target); yEarlier.setMonth(yEarlier.getMonth() - 12);
          const yStr = yEarlier.toISOString().slice(0, 10);
          let prev = pts[0];
          for (const p of pts) { if (p.date <= yStr) prev = p; else break; }
          out.rate12m = prev.value;
        }
      } catch { /* leave null */ }
      if (!cancelled) { setS(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { s, loading };
}

interface StrategyChart { id: string; label: string; symbols: string[] }

// Linked "Strategy" charts for one statement: chips that reopen the saved comparison,
// plus a picker of the charts saved from Compare's "🎯 Add to strategy" that aren't
// yet attached. Persisted per statement in the gist (strategyLinks).
function LinkChips({
  id, allCharts, linkedIds, onToggle, onCompare,
}: {
  id: string;
  allCharts: StrategyChart[];
  linkedIds: string[];
  onToggle: (statementId: string, chartId: string) => void;
  onCompare?: (symbol: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const linked = allCharts.filter(c => linkedIds.includes(c.id));
  const available = allCharts.filter(c => !linkedIds.includes(c.id));
  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-gray-600">Charts:</span>
      {linked.length === 0 && <span className="text-[10px] text-gray-600 italic">none linked</span>}
      {linked.map(c => (
        <span key={c.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300">
          <button onClick={() => c.symbols.forEach(s => onCompare?.(s))} title={`Open in Compare: ${c.symbols.join(', ')}`} className="hover:underline">
            📈 {c.label}
          </button>
          <button onClick={() => onToggle(id, c.id)} title="Unlink" className="text-gray-500 hover:text-red-400"><X size={9} /></button>
        </span>
      ))}
      {available.length > 0 && (
        picking ? (
          <select
            autoFocus
            onChange={e => { if (e.target.value) onToggle(id, e.target.value); setPicking(false); }}
            onBlur={() => setPicking(false)}
            className="text-[10px] bg-bg-input border border-border rounded px-1 py-0.5 text-gray-300"
            defaultValue=""
          >
            <option value="" disabled>link a saved chart…</option>
            {available.map(c => <option key={c.id} value={c.id}>{c.label} ({c.symbols.length})</option>)}
          </select>
        ) : (
          <button onClick={() => setPicking(true)} className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-gray-500 hover:text-gray-300 hover:border-border-light">＋ link</button>
        )
      )}
    </div>
  );
}

function Row({ id, on, label, detail, allCharts, linkedIds, onToggle, onCompare }: {
  id: string; on: boolean; label: string; detail: React.ReactNode;
  allCharts: StrategyChart[]; linkedIds: string[];
  onToggle: (statementId: string, chartId: string) => void; onCompare?: (symbol: string) => void;
}) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2', on ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-bg-input/40')}>
      <div className="flex items-center gap-2">
        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold', on ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700 text-gray-500')}>
          {on ? 'ACTIVE NOW' : 'inactive'}
        </span>
        <span className="text-xs font-semibold text-gray-200">{label}</span>
      </div>
      <div className="text-[11px] text-gray-400 mt-1 leading-snug">{detail}</div>
      <LinkChips id={id} allCharts={allCharts} linkedIds={linkedIds} onToggle={onToggle} onCompare={onCompare} />
    </div>
  );
}

export function StrategyPanel({ onCompare }: { onCompare?: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [highVal, setHighVal] = useState(false); // valuation is subjective → manual toggle
  const { s, loading } = useStrategySignals();
  const { data, update } = useGistData();

  // Charts the user saved from Compare → Notes → "🎯 Add to strategy" (category 'Strategy').
  const allCharts: StrategyChart[] = useMemo(() => {
    const out: StrategyChart[] = [];
    for (const list of Object.values(data.notes ?? {})) {
      for (const n of list) {
        if (n.category === 'Strategy' && n.view?.symbols?.length) {
          out.push({ id: n.id, label: n.text?.trim() || n.view.symbols.join(', '), symbols: n.view.symbols });
        }
      }
    }
    return out;
  }, [data.notes]);

  const links = data.strategyLinks ?? {};
  const toggleLink = (statementId: string, chartId: string) => {
    const cur = new Set(links[statementId] ?? []);
    if (cur.has(chartId)) cur.delete(chartId); else cur.add(chartId);
    update({ strategyLinks: { ...links, [statementId]: [...cur] } });
  };
  const linkProps = (id: string) => ({ id, allCharts, linkedIds: links[id] ?? [], onToggle: toggleLink, onCompare });

  const usdStrong = s.eurusd != null && s.eurusdAvg5y != null ? s.eurusd < s.eurusdAvg5y : null; // EURUSD below 5Y avg = strong dollar
  const cryptoBuy = s.btc != null && s.btc200w != null ? s.btc < s.btc200w : null;
  const ratesFalling = s.rateNow != null && s.rate12m != null ? s.rateNow < s.rate12m - 0.05 : null;
  const ratesRising = s.rateNow != null && s.rate12m != null ? s.rateNow > s.rate12m + 0.05 : null;

  const summary = useMemo(() => {
    const picks: string[] = [];
    if (usdStrong === true) picks.push(highVal ? 'USD stocks + options (high valuation)' : 'USD stocks (no options — low valuation)');
    if (usdStrong === false) picks.push('EU stocks + Emerging Markets');
    if (cryptoBuy === true) picks.push('Buy crypto (below the 200-week MA)');
    if (ratesFalling === true) picks.push('REITs + mortgage REITs + gold + silver');
    if (ratesRising === true) picks.push('Banks + BDCs');
    return picks;
  }, [usdStrong, highVal, cryptoBuy, ratesFalling, ratesRising]);

  return (
    <div className="rounded-xl border border-amber-500/25 bg-bg-card overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover/20 transition text-left">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          <span className="text-sm font-semibold text-amber-300">🎯 My Strategy — live regime</span>
        </div>
        {!open && summary.length > 0 && (
          <span className="text-[10px] text-emerald-300 hidden sm:inline truncate max-w-[55%]">Now: {summary.join(' · ')}</span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Live "what to do now" */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <p className="text-[11px] font-semibold text-emerald-300 mb-1">What the conditions say right now {loading && <span className="text-gray-500 font-normal">· loading…</span>}</p>
            {summary.length ? (
              <ul className="text-xs text-gray-200 space-y-0.5 list-disc pl-4">{summary.map((p, i) => <li key={i}>{p}</li>)}</ul>
            ) : <p className="text-xs text-gray-500">{loading ? '—' : 'No branch is clearly active (data unavailable or neutral).'}</p>}
          </div>

          {/* The rules + live evaluation */}
          <div className="space-y-2">
            <Row {...linkProps('usd-strong')} on={usdStrong === true} label="USD/EUR below its 5-year average → USD stocks"
              detail={<>EUR/USD <b className="text-gray-200">{fmt(s.eurusd)}</b> vs 5Y avg <b className="text-gray-200">{fmt(s.eurusdAvg5y)}</b>{usdStrong === true && ' → dollar strong'}.
                <span className="block mt-1">Valuation of USD stocks:
                  <button onClick={() => setHighVal(false)} className={clsx('ml-2 text-[10px] px-1.5 py-0.5 rounded border', !highVal ? 'border-accent text-accent' : 'border-border text-gray-500')}>Low → no options</button>
                  <button onClick={() => setHighVal(true)} className={clsx('ml-1 text-[10px] px-1.5 py-0.5 rounded border', highVal ? 'border-accent text-accent' : 'border-border text-gray-500')}>High → options</button>
                </span></>} />
            <Row {...linkProps('usd-weak')} on={usdStrong === false} label="USD/EUR above its 5-year average → EU stocks + Emerging Markets"
              detail={<>Weak dollar favours European equities and EM.</>} />
            <Row {...linkProps('crypto')} on={cryptoBuy === true} label="Crypto 4-year cycle → buy below the 200-week MA"
              detail={<>BTC <b className="text-gray-200">{s.btc == null ? '—' : `$${Math.round(s.btc).toLocaleString()}`}</b> vs 200W MA <b className="text-gray-200">{s.btc200w == null ? '—' : `$${Math.round(s.btc200w).toLocaleString()}`}</b>{cryptoBuy === true ? ' → below = accumulation zone' : cryptoBuy === false ? ' → above = wait' : ''}.</>} />
            <Row {...linkProps('rates-falling')} on={ratesFalling === true} label="Rates falling → REITs + mortgage REITs + gold + silver"
              detail={<>Fed funds <b className="text-gray-200">{fmt(s.rateNow, 2)}%</b> vs 12m ago <b className="text-gray-200">{fmt(s.rate12m, 2)}%</b>{ratesFalling === true && ' → easing'}.</>} />
            <Row {...linkProps('rates-rising')} on={ratesRising === true} label="Rates rising → Banks + BDCs"
              detail={<>Fed funds <b className="text-gray-200">{fmt(s.rateNow, 2)}%</b> vs 12m ago <b className="text-gray-200">{fmt(s.rate12m, 2)}%</b>{ratesRising === true && ' → tightening'}.</>} />
          </div>

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            EUR/USD 5-year average, BTC vs its 200-week MA and the Fed-funds 12-month direction are read live; the USD-stock <em>valuation</em> (high/low) is your call. To attach a chart to a rule: build the comparison in the <b>Compare</b> tab, open <b>Notes</b>, click <b>🎯 Add to strategy</b> — then it appears in the <b>＋ link</b> picker here.
          </p>
        </div>
      )}
    </div>
  );
}
