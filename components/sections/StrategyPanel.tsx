'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useGistData } from '@/lib/gist';

// ─────────────────────────────────────────────────────────────────────────────
// "My Strategy" — the user's own rotation playbook, listed AND evaluated live
// against current data, with the actual chart drawn inline under each rule so the
// regime (dollar strong/weak, rates falling/rising, crypto cycle, valuation) is
// visible, not just asserted.
//
//   EUR/USD above 5-year average  → USD stocks   (the user's "USD/EUR < avg")
//       · CAPE above its 5Y avg → options   · CAPE below → no options
//   EUR/USD below 5-year average  → EU stocks + Emerging Markets
//   Crypto — 4-year cycle: buy when price is below the 200-week MA
//   Rates falling → REITs + mortgage REITs + gold + silver
//   Rates rising  → Banks + BDCs
// ─────────────────────────────────────────────────────────────────────────────

interface Signals {
  eurusd: number | null;
  eurusdAvg5y: number | null;
  eurusdSeries: number[];
  btc: number | null;
  btc200w: number | null;
  btcSeries: number[];
  btcMaSeries: (number | null)[];
  rateNow: number | null;
  rate12m: number | null;
  rateSeries: number[];
  cape: number | null;
  capeAvg5y: number | null;
  capeSeries: number[];
}

const EMPTY: Signals = {
  eurusd: null, eurusdAvg5y: null, eurusdSeries: [],
  btc: null, btc200w: null, btcSeries: [], btcMaSeries: [],
  rateNow: null, rate12m: null, rateSeries: [],
  cape: null, capeAvg5y: null, capeSeries: [],
};

const fmt = (v: number | null, d = 4) => (v == null ? '—' : v.toFixed(d));
const usd = (v: number | null) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);

// Trailing simple moving average over `w` samples; null until the window fills.
function trailingSMA(vals: number[], w: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= w) sum -= vals[i - w];
    if (i >= w - 1) out[i] = sum / w;
  }
  return out;
}

// Evenly thin an array to at most `max` points (keeps first & last).
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

function useStrategySignals(active: boolean): { s: Signals; loading: boolean } {
  const [s, setS] = useState<Signals>(EMPTY);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);
  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    let cancelled = false;
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
    const histCloses = (r: unknown): { date: string; close: number }[] =>
      (Array.isArray(r) ? r : []).filter(
        (p): p is { date: string; close: number } =>
          !!p && typeof (p as { close?: unknown }).close === 'number' && isFinite((p as { close: number }).close),
      );
    (async () => {
      const out: Signals = { ...EMPTY };
      // EUR/USD — 5-year line + 5-year average
      try {
        const r = await fetch('/api/historical?symbol=EURUSD=X&timeframe=5Y').then(x => x.json());
        const closes = histCloses(r).map(p => p.close).filter(c => c > 0);
        if (closes.length) {
          out.eurusd = closes[closes.length - 1];
          out.eurusdAvg5y = closes.reduce((a, b) => a + b, 0) / closes.length;
          out.eurusdSeries = downsample(closes, 240);
        }
      } catch { /* leave null */ }
      // Bitcoin — full-history price + trailing 200-week (≈1400-day) MA
      try {
        const r = await fetch('/api/historical?symbol=BTC-USD&timeframe=MAX').then(x => x.json());
        const closes = histCloses(r).map(p => p.close).filter(c => c > 0);
        if (closes.length) {
          const ma = trailingSMA(closes, 1400);
          out.btc = closes[closes.length - 1];
          out.btc200w = ma[ma.length - 1];
          // downsample price & MA together so they stay aligned
          const idx = downsample(closes.map((_, i) => i), 260);
          out.btcSeries = idx.map(i => closes[i]);
          out.btcMaSeries = idx.map(i => ma[i]);
        }
      } catch { /* leave null */ }
      // Fall back to the markets endpoint for the latest 200w MA if history lacked it
      if (out.btc200w == null || out.btc == null) {
        try {
          const r = await fetch('/api/crypto?mode=markets').then(x => x.json());
          const btc = Array.isArray(r) ? r.find((c: { id?: string; symbol?: string }) => c.id === 'bitcoin' || c.symbol === 'BTC') : null;
          out.btc = out.btc ?? num(btc?.price);
          out.btc200w = out.btc200w ?? num(btc?.sma200w);
        } catch { /* leave null */ }
      }
      // Fed funds — ~4-year line to read the direction visually
      try {
        const from = new Date(); from.setFullYear(from.getFullYear() - 4);
        const r = await fetch(`/api/macro?mode=history&id=FEDFUNDS&from=${from.toISOString().slice(0, 10)}`).then(x => x.json());
        const pts = histCloses(r).sort((a, b) => a.date.localeCompare(b.date));
        if (pts.length) {
          out.rateSeries = pts.map(p => p.close);
          out.rateNow = pts[pts.length - 1].close;
          const yEarlier = new Date(pts[pts.length - 1].date); yEarlier.setMonth(yEarlier.getMonth() - 12);
          const yStr = yEarlier.toISOString().slice(0, 10);
          let prev = pts[0];
          for (const p of pts) { if (p.date <= yStr) prev = p; else break; }
          out.rate12m = prev.close;
        }
      } catch { /* leave null */ }
      // Shiller CAPE — latest vs its 5-year average (drives the valuation branch)
      try {
        const from = new Date(); from.setFullYear(from.getFullYear() - 5);
        const r = await fetch(`/api/macro?mode=history&id=SHILLER_CAPE&from=${from.toISOString().slice(0, 10)}`).then(x => x.json());
        const pts = histCloses(r).sort((a, b) => a.date.localeCompare(b.date)).map(p => p.close);
        if (pts.length) {
          out.cape = pts[pts.length - 1];
          out.capeAvg5y = pts.reduce((a, b) => a + b, 0) / pts.length;
          out.capeSeries = downsample(pts, 240);
        }
      } catch { /* leave null */ }
      if (!cancelled) { setS(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [active]);
  return { s, loading };
}

// ── Inline mini-chart ────────────────────────────────────────────────────────
// One or more index-aligned series on a shared y-scale. A dashed line marks a
// reference (average / MA); this is what makes the regime *visible* in the panel.
function MiniChart({ lines, height = 52 }: {
  lines: { vals: (number | null)[]; color: string; dash?: boolean }[];
  height?: number;
}) {
  const all = lines.flatMap(l => l.vals).filter((v): v is number => v != null && isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const n = Math.max(...lines.map(l => l.vals.length));
  const W = 320, H = height, pad = 3;
  const px = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * pad));
  const py = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad);
  const toPath = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => {
      if (v == null || !isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full mt-2" style={{ height }}>
      {lines.map((l, i) => (
        <path key={i} d={toPath(l.vals)} fill="none" stroke={l.color} strokeWidth={1.4}
          strokeDasharray={l.dash ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

interface StrategyChart { id: string; label: string; symbols: string[] }

// Optional links to saved "Strategy" Compare charts (secondary to the live chart above).
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
      <span className="text-[10px] text-gray-600">Saved charts:</span>
      {linked.length === 0 && <span className="text-[10px] text-gray-600 italic">none</span>}
      {linked.map(c => (
        <span key={c.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300">
          <button onClick={() => c.symbols.forEach(sym => onCompare?.(sym))} title={`Open in Compare: ${c.symbols.join(', ')}`} className="hover:underline">
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

function Row({ id, on, unknown, label, detail, chart, allCharts, linkedIds, onToggle, onCompare }: {
  id: string; on: boolean; unknown?: boolean; label: string; detail: React.ReactNode; chart?: React.ReactNode;
  allCharts: StrategyChart[]; linkedIds: string[];
  onToggle: (statementId: string, chartId: string) => void; onCompare?: (symbol: string) => void;
}) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2', on ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-bg-input/40')}>
      <div className="flex items-center gap-2">
        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold',
          unknown ? 'bg-gray-700 text-gray-400' : on ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700 text-gray-500')}>
          {unknown ? 'no data' : on ? 'ACTIVE NOW' : 'inactive'}
        </span>
        <span className="text-xs font-semibold text-gray-200">{label}</span>
      </div>
      <div className="text-[11px] text-gray-400 mt-1 leading-snug">{detail}</div>
      {chart}
      <LinkChips id={id} allCharts={allCharts} linkedIds={linkedIds} onToggle={onToggle} onCompare={onCompare} />
    </div>
  );
}

export function StrategyPanel({ onCompare }: { onCompare?: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const { s, loading } = useStrategySignals(open);
  const { data, update } = useGistData();

  // Charts saved from Compare → Notes → "🎯 Add to strategy" (category 'Strategy').
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

  // EUR/USD ABOVE its 5Y average → USD stocks (the user's "USD/EUR below avg").
  const usdStocks = s.eurusd != null && s.eurusdAvg5y != null ? s.eurusd > s.eurusdAvg5y : null;
  const capeHigh = s.cape != null && s.capeAvg5y != null ? s.cape > s.capeAvg5y : null; // valuation
  const cryptoBuy = s.btc != null && s.btc200w != null ? s.btc < s.btc200w : null;
  const ratesFalling = s.rateNow != null && s.rate12m != null ? s.rateNow < s.rate12m - 0.05 : null;
  const ratesRising = s.rateNow != null && s.rate12m != null ? s.rateNow > s.rate12m + 0.05 : null;

  const summary = useMemo(() => {
    const picks: string[] = [];
    if (usdStocks === true) {
      picks.push(capeHigh === true ? 'USD stocks + options (CAPE rich)'
        : capeHigh === false ? 'USD stocks, no options (CAPE cheap)'
        : 'USD stocks');
    }
    if (usdStocks === false) picks.push('EU stocks + Emerging Markets');
    if (cryptoBuy === true) picks.push('Buy crypto (below the 200-week MA)');
    if (ratesFalling === true) picks.push('REITs + mortgage REITs + gold + silver');
    if (ratesRising === true) picks.push('Banks + BDCs');
    return picks;
  }, [usdStocks, capeHigh, cryptoBuy, ratesFalling, ratesRising]);

  const eurusdChart = s.eurusdSeries.length > 1 && s.eurusdAvg5y != null ? (
    <MiniChart lines={[
      { vals: s.eurusdSeries, color: '#38bdf8' },
      { vals: s.eurusdSeries.map(() => s.eurusdAvg5y!), color: '#9ca3af', dash: true },
    ]} />
  ) : null;
  const rateChart = s.rateSeries.length > 1 ? (
    <MiniChart lines={[{ vals: s.rateSeries, color: ratesFalling ? '#34d399' : ratesRising ? '#f87171' : '#38bdf8' }]} />
  ) : null;

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

          {/* The rules + live evaluation + inline chart */}
          <div className="space-y-2">
            <Row {...linkProps('usd-strong')} on={usdStocks === true} unknown={usdStocks === null}
              label="EUR/USD above its 5-year average → USD stocks"
              detail={<>EUR/USD <b className="text-gray-200">{fmt(s.eurusd)}</b> vs 5Y avg <b className="text-gray-200">{fmt(s.eurusdAvg5y)}</b>{usdStocks === true ? ' → above = USD stocks' : usdStocks === false ? ' → below = not this branch' : ''}.
                <span className="block mt-1">Valuation (Shiller CAPE <b className="text-gray-200">{fmt(s.cape, 1)}</b> vs 5Y avg <b className="text-gray-200">{fmt(s.capeAvg5y, 1)}</b>):{' '}
                  {capeHigh === true ? <b className="text-amber-300">rich → buy options</b>
                    : capeHigh === false ? <b className="text-emerald-300">cheap → no options</b>
                    : <span className="text-gray-500">no CAPE data</span>}.
                </span></>}
              chart={eurusdChart} />
            <Row {...linkProps('usd-weak')} on={usdStocks === false} unknown={usdStocks === null}
              label="EUR/USD below its 5-year average → EU stocks + Emerging Markets"
              detail={<>Weak dollar (EUR/USD below its 5Y average) favours European equities and EM.</>}
              chart={eurusdChart} />
            <Row {...linkProps('crypto')} on={cryptoBuy === true} unknown={cryptoBuy === null}
              label="Crypto 4-year cycle → buy below the 200-week MA"
              detail={<>BTC <b className="text-gray-200">{usd(s.btc)}</b> vs 200W MA <b className="text-gray-200">{usd(s.btc200w)}</b>{cryptoBuy === true ? ' → below = accumulation zone' : cryptoBuy === false ? ' → above = wait' : ''}.</>}
              chart={s.btcSeries.length > 1 ? (
                <MiniChart lines={[
                  { vals: s.btcSeries, color: '#f59e0b' },
                  { vals: s.btcMaSeries, color: '#9ca3af', dash: true },
                ]} />
              ) : null} />
            <Row {...linkProps('rates-falling')} on={ratesFalling === true} unknown={ratesFalling === null}
              label="Rates falling → REITs + mortgage REITs + gold + silver"
              detail={<>Fed funds <b className="text-gray-200">{fmt(s.rateNow, 2)}%</b> vs 12m ago <b className="text-gray-200">{fmt(s.rate12m, 2)}%</b>{ratesFalling === true ? ' → easing' : ''}.</>}
              chart={rateChart} />
            <Row {...linkProps('rates-rising')} on={ratesRising === true} unknown={ratesRising === null}
              label="Rates rising → Banks + BDCs"
              detail={<>Fed funds <b className="text-gray-200">{fmt(s.rateNow, 2)}%</b> vs 12m ago <b className="text-gray-200">{fmt(s.rate12m, 2)}%</b>{ratesRising === true ? ' → tightening' : ''}.</>}
              chart={rateChart} />
          </div>

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            All four signals are read live and drawn above each rule — EUR/USD vs its 5-year average, Shiller CAPE vs its 5-year average (valuation), BTC vs its 200-week MA, and the Fed-funds path (falling/rising). You can also attach a saved <b>Compare</b> chart to any rule: build it in <b>Compare</b>, open <b>Notes</b>, click <b>🎯 Add to strategy</b>, then link it with <b>＋</b> here.
          </p>
        </div>
      )}
    </div>
  );
}
