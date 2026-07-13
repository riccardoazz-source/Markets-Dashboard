'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, X, Plus, Trash2 } from 'lucide-react';
import { useGistData, makeId } from '@/lib/gist';
import { ALL_COMPARABLE_ASSETS } from '@/lib/config';

// ─────────────────────────────────────────────────────────────────────────────
// "My Strategy" — the user's own rotation playbook, evaluated live against
// current data. Charts are NOT auto-generated: the user builds them in Compare,
// saves them with "🎯 Add to strategy", and links them to a rule. A linked chart
// is drawn inline by FETCHING its symbols live, so it renders regardless of when
// it was saved. Extra rules can be added by hand.
// ─────────────────────────────────────────────────────────────────────────────

interface Signals {
  eurusd: number | null;
  eurusdAvg5y: number | null;
  btc: number | null;
  btc200w: number | null;
  rateNow: number | null;
  rate12m: number | null;
  cape: number | null;
  capeAvg5y: number | null;
}

const EMPTY: Signals = {
  eurusd: null, eurusdAvg5y: null, btc: null, btc200w: null,
  rateNow: null, rate12m: null, cape: null, capeAvg5y: null,
};

const fmt = (v: number | null, d = 4) => (v == null ? '—' : v.toFixed(d));
const usd = (v: number | null) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);

// ── Live fetch of a compared symbol (mirrors CompareSection's resolver) ──────
const ASSET_TYPE = new Map(ALL_COMPARABLE_ASSETS.map(a => [a.symbol, a.type]));
const ASSET_NAME = new Map(ALL_COMPARABLE_ASSETS.map(a => [a.symbol, a.name]));
const PALETTE = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#facc15', '#4ade80'];
const COIN_MAP: Record<string, string> = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  xrp: 'ripple', ada: 'cardano', avax: 'avalanche-2', link: 'chainlink',
};

function tfFrom(tf: string): string {
  const d = new Date();
  switch (tf) {
    case '1D': case '1W': d.setMonth(d.getMonth() - 1); break;
    case '1M': d.setMonth(d.getMonth() - 1); break;
    case '3M': d.setMonth(d.getMonth() - 3); break;
    case '6M': d.setMonth(d.getMonth() - 6); break;
    case 'YTD': d.setMonth(0, 1); break;
    case '3Y': d.setFullYear(d.getFullYear() - 3); break;
    case '5Y': d.setFullYear(d.getFullYear() - 5); break;
    case '10Y': d.setFullYear(d.getFullYear() - 10); break;
    case 'MAX': d.setFullYear(d.getFullYear() - 30); break;
    default: d.setFullYear(d.getFullYear() - 1); break; // 1Y
  }
  return d.toISOString().slice(0, 10);
}

const asPoints = (r: unknown): { date: string; close: number }[] =>
  (Array.isArray(r) ? r : []).filter(
    (p): p is { date: string; close: number } =>
      !!p && typeof (p as { close?: unknown }).close === 'number' && isFinite((p as { close: number }).close) && !!(p as { date?: unknown }).date,
  );

async function fetchSeries(symbol: string, tf: string): Promise<{ date: string; close: number }[]> {
  const type = ASSET_TYPE.get(symbol);
  try {
    if (symbol.startsWith('WB:') || symbol.startsWith('WBX:')) return []; // Macro World — skip
    if (type === 'crypto') {
      const base = symbol.replace('-USD', '').toLowerCase();
      const id = COIN_MAP[base] ?? base;
      const daysMap: Record<string, number> = { '1D': 3, '1W': 7, '1M': 30, '3M': 90, '6M': 180, YTD: 365, '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650, MAX: 3650 };
      const days = daysMap[tf] ?? 365;
      let d = asPoints(await fetch(`/api/crypto?mode=historical&id=${id}&days=${days}`).then(x => x.json()));
      if (!d.length) d = asPoints(await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`).then(x => x.json()));
      return d;
    }
    if (type === 'macro') {
      return asPoints(await fetch(`/api/macro?mode=history&id=${encodeURIComponent(symbol)}&from=${tfFrom(tf)}`).then(x => x.json()));
    }
    if (type === 'currency') {
      return asPoints(await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`).then(x => x.json()));
    }
    // stocks / indexes / ETFs / sectors
    const sr = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`).then(x => x.json());
    let d = asPoints(sr?.prices);
    if (!d.length) d = asPoints(await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`).then(x => x.json()));
    return d;
  } catch { return []; }
}

interface Line { label: string; color: string; pts: (number | null)[] }

// Fetch every symbol of a linked chart, normalise each to % change and align by
// the union of dates so the comparison reads exactly like Compare (normalized mode).
async function buildLines(symbols: string[], tf: string): Promise<Line[]> {
  const series = await Promise.all(symbols.map(s => fetchSeries(s, tf)));
  const dateSet = new Set<string>();
  series.forEach(s => s.forEach(p => dateSet.add(p.date)));
  const dates = [...dateSet].sort();
  if (dates.length < 2) return [];
  const step = dates.length > 140 ? (dates.length - 1) / 139 : 1;
  const idx = dates.length > 140 ? Array.from({ length: 140 }, (_, i) => Math.round(i * step)) : dates.map((_, i) => i);
  return series.map((s, i) => {
    const m = new Map(s.map(p => [p.date, p.close]));
    let last: number | null = null;
    const filled = dates.map(d => { const v = m.get(d); if (v != null) last = v; return last; });
    const base = filled.find(v => v != null && v > 0) ?? null;
    const norm: (number | null)[] = base ? filled.map(v => (v == null ? null : (v / base - 1) * 100)) : filled.map(() => null);
    return { label: ASSET_NAME.get(symbols[i]) ?? symbols[i], color: PALETTE[i % PALETTE.length], pts: idx.map(j => norm[j]) };
  }).filter(l => l.pts.some(v => v != null));
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
    (async () => {
      const out: Signals = { ...EMPTY };
      try {
        const c = asPoints(await fetch('/api/historical?symbol=EURUSD=X&timeframe=5Y').then(x => x.json())).map(p => p.close).filter(v => v > 0);
        if (c.length) { out.eurusd = c[c.length - 1]; out.eurusdAvg5y = c.reduce((a, b) => a + b, 0) / c.length; }
      } catch { /* leave null */ }
      try {
        const r = await fetch('/api/crypto?mode=markets').then(x => x.json());
        const btc = Array.isArray(r) ? r.find((c: { id?: string; symbol?: string }) => c.id === 'bitcoin' || c.symbol === 'BTC') : null;
        out.btc = num(btc?.price); out.btc200w = num(btc?.sma200w);
      } catch { /* leave null */ }
      try {
        const from = new Date(); from.setFullYear(from.getFullYear() - 2);
        const pts = asPoints(await fetch(`/api/macro?mode=history&id=FEDFUNDS&from=${from.toISOString().slice(0, 10)}`).then(x => x.json())).sort((a, b) => a.date.localeCompare(b.date));
        if (pts.length) {
          out.rateNow = pts[pts.length - 1].close;
          const yE = new Date(pts[pts.length - 1].date); yE.setMonth(yE.getMonth() - 12);
          const yStr = yE.toISOString().slice(0, 10);
          let prev = pts[0];
          for (const p of pts) { if (p.date <= yStr) prev = p; else break; }
          out.rate12m = prev.close;
        }
      } catch { /* leave null */ }
      try {
        const from = new Date(); from.setFullYear(from.getFullYear() - 5);
        const c = asPoints(await fetch(`/api/macro?mode=history&id=SHILLER_CAPE&from=${from.toISOString().slice(0, 10)}`).then(x => x.json())).map(p => p.close);
        if (c.length) { out.cape = c[c.length - 1]; out.capeAvg5y = c.reduce((a, b) => a + b, 0) / c.length; }
      } catch { /* leave null */ }
      if (!cancelled) { setS(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [active]);
  return { s, loading };
}

// ── Inline multi-line % chart ────────────────────────────────────────────────
function LineChart({ lines, height = 64 }: { lines: Line[]; height?: number }) {
  const all = lines.flatMap(l => l.pts).filter((v): v is number => v != null && isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const n = Math.max(...lines.map(l => l.pts.length));
  const W = 320, H = height, pad = 3;
  const px = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * pad));
  const py = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad);
  const path = (pts: (number | null)[]) => {
    let d = '', pen = false;
    pts.forEach((v, i) => { if (v == null || !isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)} `; pen = true; });
    return d.trim();
  };
  const zeroY = min < 0 && max > 0 ? py(0) : null;
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {zeroY != null && <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#4b5563" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {lines.map((l, i) => <path key={i} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {lines.map((l, i) => {
          const lastVal = [...l.pts].reverse().find(v => v != null);
          return (
            <span key={i} className="inline-flex items-center gap-1 text-[9px] text-gray-400">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: l.color }} />
              {l.label}{lastVal != null && <b className="text-gray-300 ml-0.5">{lastVal >= 0 ? '+' : ''}{lastVal.toFixed(1)}%</b>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface StrategyChart { id: string; label: string; symbols: string[]; timeframe: string; preview?: Line[] }

// One linked chart: fetches its symbols live (falls back to the saved thumbnail).
function LinkedChartCard({ chart, active, onOpen, onUnlink }: {
  chart: StrategyChart; active: boolean; onOpen: () => void; onUnlink: () => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(chart.preview ?? null);
  const [loading, setLoading] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (!active || done.current) return;
    done.current = true;
    let cancelled = false;
    setLoading(true);
    buildLines(chart.symbols, chart.timeframe || '1Y').then(l => {
      if (cancelled) return;
      if (l.length) setLines(l);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, chart.symbols, chart.timeframe]);
  return (
    <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onOpen} title={`Open in Compare: ${chart.symbols.join(', ')}`} className="text-[11px] font-semibold text-sky-300 hover:underline truncate">📈 {chart.label}</button>
        <button onClick={onUnlink} title="Unlink chart" className="text-gray-500 hover:text-red-400 shrink-0"><X size={12} /></button>
      </div>
      {lines && lines.length ? <LineChart lines={lines} />
        : loading ? <p className="text-[10px] text-gray-500 italic mt-1">loading chart…</p>
        : <p className="text-[10px] text-gray-600 italic mt-1">Couldn’t draw this one — click the title to open it in Compare.</p>}
    </div>
  );
}

function LinkedCharts({ id, allCharts, linkedIds, active, onToggle, onCompare }: {
  id: string; allCharts: StrategyChart[]; linkedIds: string[]; active: boolean;
  onToggle: (statementId: string, chartId: string) => void; onCompare?: (symbol: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const linked = allCharts.filter(c => linkedIds.includes(c.id));
  const available = allCharts.filter(c => !linkedIds.includes(c.id));
  return (
    <div className="mt-2 space-y-2">
      {linked.map(c => (
        <LinkedChartCard key={c.id} chart={c} active={active}
          onOpen={() => c.symbols.forEach(sym => onCompare?.(sym))}
          onUnlink={() => onToggle(id, c.id)} />
      ))}
      <div className="flex items-center gap-1.5">
        {available.length > 0 ? (
          picking ? (
            <select autoFocus onChange={e => { if (e.target.value) onToggle(id, e.target.value); setPicking(false); }} onBlur={() => setPicking(false)}
              className="text-[10px] bg-bg-input border border-border rounded px-1 py-0.5 text-gray-300" defaultValue="">
              <option value="" disabled>link a saved chart…</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.label} ({c.symbols.length})</option>)}
            </select>
          ) : (
            <button onClick={() => setPicking(true)} className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-gray-500 hover:text-gray-300 hover:border-border-light">＋ link a chart</button>
          )
        ) : linked.length === 0 ? (
          <span className="text-[10px] text-gray-600 italic">No saved charts yet — build one in Compare → Notes → 🎯 Add to strategy.</span>
        ) : null}
      </div>
    </div>
  );
}

function Row({ id, on, unknown, label, detail, onDelete, active, allCharts, linkedIds, onToggle, onCompare }: {
  id: string; on: boolean; unknown?: boolean; label: string; detail?: React.ReactNode; onDelete?: () => void; active: boolean;
  allCharts: StrategyChart[]; linkedIds: string[];
  onToggle: (statementId: string, chartId: string) => void; onCompare?: (symbol: string) => void;
}) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2', on ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-bg-input/40')}>
      <div className="flex items-center gap-2">
        {!unknown && (
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold', on ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700 text-gray-500')}>
            {on ? 'ACTIVE NOW' : 'inactive'}
          </span>
        )}
        <span className="text-xs font-semibold text-gray-200 flex-1">{label}</span>
        {onDelete && <button onClick={onDelete} title="Remove this point" className="text-gray-600 hover:text-red-400 shrink-0"><Trash2 size={12} /></button>}
      </div>
      {detail && <div className="text-[11px] text-gray-400 mt-1 leading-snug">{detail}</div>}
      <LinkedCharts id={id} allCharts={allCharts} linkedIds={linkedIds} active={active} onToggle={onToggle} onCompare={onCompare} />
    </div>
  );
}

export function StrategyPanel({ onCompare }: { onCompare?: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [newPoint, setNewPoint] = useState('');
  const { s, loading } = useStrategySignals(open);
  const { data, update } = useGistData();

  const allCharts: StrategyChart[] = useMemo(() => {
    const out: StrategyChart[] = [];
    for (const list of Object.values(data.notes ?? {})) {
      for (const n of list) {
        if (n.category === 'Strategy' && n.view?.symbols?.length) {
          out.push({ id: n.id, label: n.text?.trim() || n.view.symbols.join(', '), symbols: n.view.symbols, timeframe: n.view.timeframe || '1Y', preview: n.view.preview });
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
  const linkProps = (id: string) => ({ id, allCharts, linkedIds: links[id] ?? [], onToggle: toggleLink, onCompare, active: open });

  const custom = data.strategyCustom ?? [];
  const addPoint = () => {
    const label = newPoint.trim();
    if (!label) return;
    update({ strategyCustom: [...custom, { id: makeId(), label }] });
    setNewPoint('');
  };
  const removePoint = (id: string) => {
    update({ strategyCustom: custom.filter(p => p.id !== id) });
    if (links[id]) { const { [id]: _drop, ...rest } = links; update({ strategyLinks: rest }); }
  };

  const usdStocks = s.eurusd != null && s.eurusdAvg5y != null ? s.eurusd > s.eurusdAvg5y : null;
  const capeHigh = s.cape != null && s.capeAvg5y != null ? s.cape > s.capeAvg5y : null;
  const cryptoBuy = s.btc != null && s.btc200w != null ? s.btc < s.btc200w : null;
  const ratesFalling = s.rateNow != null && s.rate12m != null ? s.rateNow < s.rate12m - 0.05 : null;
  const ratesRising = s.rateNow != null && s.rate12m != null ? s.rateNow > s.rate12m + 0.05 : null;

  const summary = useMemo(() => {
    const picks: string[] = [];
    if (usdStocks === true) picks.push(capeHigh === true ? 'USD stocks + options (CAPE rich)' : capeHigh === false ? 'USD stocks, no options (CAPE cheap)' : 'USD stocks');
    if (usdStocks === false) picks.push('Emerging Markets');
    if (cryptoBuy === true) picks.push('Buy crypto (below the 200-week MA)');
    if (ratesFalling === true) picks.push('REITs + mortgage REITs + gold + silver');
    if (ratesRising === true) picks.push('Banks + BDCs');
    return picks;
  }, [usdStocks, capeHigh, cryptoBuy, ratesFalling, ratesRising]);

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
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <p className="text-[11px] font-semibold text-emerald-300 mb-1">What the conditions say right now {loading && <span className="text-gray-500 font-normal">· loading…</span>}</p>
            {summary.length ? (
              <ul className="text-xs text-gray-200 space-y-0.5 list-disc pl-4">{summary.map((p, i) => <li key={i}>{p}</li>)}</ul>
            ) : <p className="text-xs text-gray-500">{loading ? '—' : 'No branch is clearly active (data unavailable or neutral).'}</p>}
          </div>

          <div className="space-y-2">
            <Row {...linkProps('usd-strong')} on={usdStocks === true} unknown={usdStocks === null}
              label="EUR/USD above its 5-year average → USD stocks"
              detail={<>EUR/USD <b className="text-gray-200">{fmt(s.eurusd)}</b> vs 5Y avg <b className="text-gray-200">{fmt(s.eurusdAvg5y)}</b>{usdStocks === true ? ' → above = USD stocks' : usdStocks === false ? ' → below = not this branch' : ''}.
                <span className="block mt-1">Valuation (Shiller CAPE <b className="text-gray-200">{fmt(s.cape, 1)}</b> vs 5Y avg <b className="text-gray-200">{fmt(s.capeAvg5y, 1)}</b>):{' '}
                  {capeHigh === true ? <b className="text-amber-300">rich → buy options</b> : capeHigh === false ? <b className="text-emerald-300">cheap → no options</b> : <span className="text-gray-500">no CAPE data</span>}.
                </span></>} />
            <Row {...linkProps('usd-weak')} on={usdStocks === false} unknown={usdStocks === null}
              label="EUR/USD below its 5-year average → Emerging Markets"
              detail={<>Weak dollar (EUR/USD below its 5Y average) favours Emerging Markets.</>} />
            <Row {...linkProps('crypto')} on={cryptoBuy === true} unknown={cryptoBuy === null}
              label="Crypto 4-year cycle → buy below the 200-week MA"
              detail={<>BTC <b className="text-gray-200">{usd(s.btc)}</b> vs 200W MA <b className="text-gray-200">{usd(s.btc200w)}</b>{cryptoBuy === true ? ' → below = accumulation zone' : cryptoBuy === false ? ' → above = wait' : ''}.</>} />
            <Row {...linkProps('rates-falling')} on={ratesFalling === true} unknown={ratesFalling === null}
              label="Rates falling → REITs + mortgage REITs + gold + silver"
              detail={<>Fed funds <b className="text-gray-200">{fmt(s.rateNow, 2)}%</b> vs 12m ago <b className="text-gray-200">{fmt(s.rate12m, 2)}%</b>{ratesFalling === true ? ' → easing' : ''}.</>} />
            <Row {...linkProps('rates-rising')} on={ratesRising === true} unknown={ratesRising === null}
              label="Rates rising → Banks + BDCs"
              detail={<>Fed funds <b className="text-gray-200">{fmt(s.rateNow, 2)}%</b> vs 12m ago <b className="text-gray-200">{fmt(s.rate12m, 2)}%</b>{ratesRising === true ? ' → tightening' : ''}.</>} />

            {custom.map(p => (
              <Row key={p.id} {...linkProps(p.id)} on={false} unknown label={p.label} onDelete={() => removePoint(p.id)} />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input value={newPoint} onChange={e => setNewPoint(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPoint(); }}
              placeholder="Add your own strategy point…"
              className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-accent" />
            <button onClick={addPoint} disabled={!newPoint.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-40 hover:bg-accent/80 transition shrink-0">
              <Plus size={12} /> Add
            </button>
          </div>

          <p className="text-[10px] text-gray-600 leading-snug px-1">
            To attach a chart to any rule: build the comparison yourself in <b>Compare</b>, open <b>Notes</b>, click <b>🎯 Add to strategy</b>, then link it with <b>＋ link a chart</b> here — it’s fetched live and drawn inline. You can link more than one chart per rule.
          </p>
        </div>
      )}
    </div>
  );
}
