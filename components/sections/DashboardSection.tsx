'use client';

// Dashboard — the landing page.
//
// The handful of numbers that set the weather for everything else, and then whatever the
// user has pinned. Nothing here is new data: the tiles read the same endpoints the Macro and
// Currencies tabs read, and the pinned strip reads the same gist-backed pin set every
// other section writes to. The point is not more information, it is the things worth
// seeing before the rest.
//
// The tiles are GROUPED rather than laid out in one undifferentiated row, because eleven
// numbers side by side is a wall: the dollar belongs with the euro, the three policy rates
// belong with each other, and the Fed's balance sheet belongs with the yields it moves.
// Grouped, each row is one question — what is the dollar doing, what is the price of
// money, what is the Fed's mandate doing, where is liquidity — and the tiles inside it are
// the answer. Where a group's members read against each other (three policy rates, two
// yields and their spread) that comparison is the whole point of putting them on one line.

import { useState, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { Star, ArrowRight, DollarSign, Percent, Users, Landmark, type LucideIcon } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { MACRO_INDICATORS, ALL_COMPARABLE_ASSETS, type MacroUnit } from '@/lib/config';
import { usePins } from '@/lib/gist';
import { useRotationPhases } from '@/lib/useRotationPhases';
import { PhaseChip } from '@/components/ui/RotationControls';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { AssetQuickView } from '@/components/ui/AssetQuickView';
import { MajorEventsStrip } from '@/components/ui/MajorEventsStrip';
import { MacroQuickView, type QuickViewTarget } from '@/components/ui/MacroQuickView';
import { formatMacroValue } from '@/lib/macroDerived';
import { QuoteData } from '@/lib/types';

// ── What the tiles are ───────────────────────────────────────────────────────
// `macro` ids resolve against MACRO_INDICATORS, so the unit and the display name come
// from the same place the Macro tab uses and cannot drift apart from it.
type TileSpec =
  | { kind: 'macro'; id: string; label: string; hint: string; invertColour?: boolean }
  | { kind: 'fx'; pair: string; label: string; hint: string };

interface TileGroup { title: string; icon: LucideIcon; blurb: string; tiles: TileSpec[] }

const GROUPS: TileGroup[] = [
  {
    title: 'Currency', icon: DollarSign,
    blurb: 'What the dollar is worth',
    tiles: [
      { kind: 'macro', id: 'DXY', label: 'US Dollar (DXY)',
        hint: 'ICE US Dollar Index — the dollar against a basket of six currencies. It moves against almost everything else priced in dollars.' },
      { kind: 'fx', pair: 'USD/EUR', label: 'USD / EUR',
        hint: 'How many euro one dollar buys.' },
    ],
  },
  {
    title: 'Interest rate', icon: Percent,
    // Three policy rates on one line so the GAPS between them are visible: the spread
    // between what the Fed pays and what the ECB and the BoJ pay is most of the reason
    // the dollar tile above moves at all.
    blurb: 'What each central bank charges for money',
    tiles: [
      { kind: 'macro', id: 'DFEDTARU', label: 'US interest rate',
        hint: 'The Federal Reserve’s target rate, upper bound. The price of money everything else is discounted against.' },
      { kind: 'macro', id: 'ECBDFR', label: 'EU interest rate',
        hint: 'The ECB deposit facility rate — the euro-area policy rate.' },
      { kind: 'macro', id: 'IRSTCI01JPM156N', label: 'Japan interest rate',
        hint: 'Japan’s overnight call rate, the Bank of Japan’s policy rate in practice. Published monthly, so it updates later than the other two.' },
    ],
  },
  {
    title: 'Employment and Inflation', icon: Users,
    blurb: 'The two halves of the Fed’s mandate — what the rates above are set against',
    tiles: [
      { kind: 'macro', id: 'UNRATE', label: 'US unemployment', invertColour: true,
        hint: 'US unemployment rate. Half the Federal Reserve’s mandate, and the half that usually turns first. Rising is shown in red.' },
      { kind: 'macro', id: 'CPI_YOY', label: 'US inflation', invertColour: true,
        hint: 'US inflation — the change in the CPI over the last twelve months. The other half of the Federal Reserve’s mandate. Rising is shown in red.' },
    ],
  },
  {
    title: 'Money and rates', icon: Landmark,
    blurb: 'How much money there is, and what the market charges for it over time',
    tiles: [
      { kind: 'macro', id: 'WALCL', label: 'Fed Balance Sheet',
        hint: 'Total assets held by the Federal Reserve. It grows when the Fed is adding liquidity and shrinks when it is draining it.' },
      { kind: 'macro', id: 'DGS2', label: 'US 2Y Yield',
        hint: 'Two-year Treasury yield — the market’s view of the policy rate over the next two years, so it moves before the Fed does.' },
      { kind: 'macro', id: 'DGS10', label: 'US 10Y Yield',
        hint: 'Ten-year Treasury yield — the long rate most other assets are discounted against.' },
      // Placed last deliberately: it is the two tiles to its left subtracted, so it reads
      // as their conclusion rather than as a fourth independent number.
      { kind: 'macro', id: 'T10Y2Y', label: '10Y–2Y Spread',
        hint: 'The ten-year yield minus the two-year. Below zero the curve is inverted — the market is pricing lower rates ahead, which has historically preceded recessions.' },
    ],
  },
];

/** Flat list, for the loader — it fetches per tile and does not care about grouping. */
const TILES: TileSpec[] = GROUPS.flatMap(g => g.tiles);

/** What /api/currencies?mode=latest actually returns — not the CurrencyRate shape. */
interface FxRow { from: string; to: string; rate: number | null; change1d: number | null }

interface MacroLatest {
  id: string;
  latest: { date: string; value: number } | null;
  prev?: { date: string; value: number } | null;
}

interface TileData {
  value: number | null;
  prev: number | null;
  asOf: string | null;
  unit: MacroUnit;
  spark: { date: string; v: number }[];
}

const NAME_OF = new Map(ALL_COMPARABLE_ASSETS.map(a => [a.symbol, a.name]));
const GROUP_OF = new Map(ALL_COMPARABLE_ASSETS.map(a => [a.symbol, a.group]));

// The order the pinned cards appear in. Fixed rather than by when each was pinned: the
// point of a landing page is that the same thing is always in the same place, and an
// order that shuffles as things are pinned and unpinned means reading the labels every
// time instead of reaching for a position. Anything whose group is not listed — a stock,
// which is not in the comparable-asset table — sorts after the named ones.
const PIN_GROUP_ORDER = ['Commodities', 'Indexes', 'Crypto', 'Sectors', 'Stocks'];
const groupRank = (sym: string) => {
  const i = PIN_GROUP_ORDER.indexOf(GROUP_OF.get(sym) ?? 'Stocks');
  return i < 0 ? PIN_GROUP_ORDER.length : i;
};

function MacroTile({ spec, data, onOpen }: {
  spec: TileSpec;
  data: TileData | undefined;
  onOpen: () => void;
}) {
  const d = data;
  const change = d?.value != null && d?.prev != null ? d.value - d.prev : null;
  const pct = change != null && d?.prev ? (change / Math.abs(d.prev)) * 100 : null;
  // For unemployment and inflation a RISE is the bad news, so the colour is flipped.
  // Showing "up = green" on unemployment would be actively wrong.
  // A rate that did not move is neither good news nor bad. Reading `change > 0` painted
  // an unchanged policy rate red.
  const good = change == null || change === 0 ? null
    : (spec.kind === 'macro' && spec.invertColour ? change < 0 : change > 0);
  return (
    <button title={`${spec.hint}\n\nClick for the chart.`} onClick={onOpen}
      className="rounded-xl border border-border bg-bg-card p-3 flex flex-col gap-1 text-left
                 hover:border-accent/50 transition-colors">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">{spec.label}</p>
      <p className="text-xl font-bold text-white tabular-nums leading-tight">
        {d?.value == null ? '—'
          : spec.kind === 'fx' ? d.value.toFixed(4)
          : formatMacroValue(d.value, d.unit)}
      </p>
      <p className={clsx('text-[11px] font-semibold tabular-nums leading-none',
        good == null ? 'text-gray-600' : good ? 'text-up-text' : 'text-down-text')}>
        {change == null ? '—' : change === 0 ? 'unchanged' : (
          <>
            {change >= 0 ? '+' : ''}{Math.abs(change) < 1 ? change.toFixed(3) : change.toFixed(2)}
            {/* Below 0.05% a single decimal renders "-0.0%", which reads as a direction
                the number does not actually have. */}
            {pct != null && isFinite(pct) && (
              <span className="opacity-70">
                {' '}({Math.abs(pct) < 0.05 ? '~0%' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`})
              </span>
            )}
          </>
        )}
      </p>
      {d && <Sparkline points={d.spark} good={good} />}
      {d?.asOf && <p className="text-[9px] text-gray-600 leading-none">as of {d.asOf}</p>}
    </button>
  );
}

function Sparkline({ points, good }: { points: { date: string; v: number }[]; good: boolean | null }) {
  if (points.length < 3) return <div className="h-8" />;
  // Coloured by whether the move was GOOD, not by whether the line went up — otherwise
  // unemployment draws a green line under a red number, which is the reading inverted.
  const stroke = good == null ? '#64748b' : good ? '#22c55e' : '#f87171';
  // The domain is the series' own range, not zero-based: these are levels, and a rate
  // moving from 4.25 to 4.50 is invisible on an axis that starts at zero.
  return (
    <div className="h-8 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.4}
            fill={stroke} fillOpacity={0.12} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardSection({ onNavigate }: {
  /** Jump to another tab, optionally opening one thing there — the same (section, id)
   *  contract the Rotation tab already uses to hand an asset over. */
  onNavigate?: (section: string, id?: string) => void;
}) {
  const [tiles, setTiles] = useState<Record<string, TileData>>({});
  const [loading, setLoading] = useState(true);
  const { pins } = usePins();
  const pinned = useMemo(
    // Grouped in a fixed order, then alphabetically inside each group so the same pins
    // always render in the same sequence.
    () => [...pins].sort((a, b) =>
      groupRank(a) - groupRank(b) ||
      (NAME_OF.get(a) ?? a).localeCompare(NAME_OF.get(b) ?? b)),
    [pins],
  );
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [open, setOpen] = useState<{ symbol: string; name: string; group: string } | null>(null);
  const [tile, setTile] = useState<QuickViewTarget | null>(null);
  const phases = useRotationPhases(pinned);

  // ── the tiles ──
  const load = useCallback(async () => {
    const macroIds = TILES.filter(t => t.kind === 'macro').map(t => (t as { id: string }).id);
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    const fromStr = from.toISOString().slice(0, 10);
    // Two shards write here, so they write to SEPARATE maps and are merged at the end.
    // Sharing one object let whichever finished last clobber the other's fields — the
    // sparklines would appear or not depending on which request won the race.
    const level: Record<string, Omit<TileData, 'spark'>> = {};
    const sparks: Record<string, { date: string; v: number }[]> = {};

    await Promise.allSettled([
      // Latest + previous for every macro tile in ONE call — the endpoint already
      // batches ids, so the whole row costs one request rather than one each.
      (async () => {
        const res = await fetch(`/api/macro?mode=list&ids=${macroIds.join(',')}`);
        const rows = await res.json() as MacroLatest[];
        for (const r of Array.isArray(rows) ? rows : []) {
          const ind = MACRO_INDICATORS.find(m => m.id === r.id);
          level[r.id] = {
            value: r.latest?.value ?? null,
            prev: r.prev?.value ?? null,
            asOf: r.latest?.date ?? null,
            unit: ind?.unit ?? 'idx',
          };
        }
      })(),
      // A year of history per tile, for the sparkline.
      ...macroIds.map(async id => {
        try {
          const res = await fetch(`/api/macro?mode=history&id=${id}&from=${fromStr}`);
          const json = await res.json();
          // The endpoint returns {date, close} — the same shape every chart in the app
          // consumes — not {date, value} like the list mode.
          const pts = (Array.isArray(json) ? json : []) as { date: string; close: number }[];
          sparks[id] = pts.filter(p => p && isFinite(p.close)).map(p => ({ date: p.date, v: p.close }));
        } catch { /* a missing sparkline is a blank strip, not a broken tile */ }
      }),
      // A year of the FX rate too, so the tile is not the one blank strip in the row.
      ...TILES.filter(t => t.kind === 'fx').map(async t => {
        const [a, b] = (t as { pair: string }).pair.split('/');
        try {
          const res = await fetch(`/api/currencies?mode=historical&from=${a}&to=${b}&timeframe=1Y`);
          const json = await res.json() as { points?: { date: string; rate: number }[] };
          sparks[(t as { pair: string }).pair] = (json.points ?? [])
            .filter(p => p && isFinite(p.rate)).map(p => ({ date: p.date, v: p.rate }));
        } catch { /* blank strip, not a broken tile */ }
      }),
      // The one FX rate, from the same endpoint the Currencies tab uses.
      (async () => {
        const res = await fetch('/api/currencies?mode=latest');
        // The endpoint carries both directions of every pair, and reports the daily
        // move as a PERCENT (`change1d`) rather than an absolute one — so the previous
        // level is backed out of it, and every tile then computes its arrow the same way.
        const rows = await res.json() as FxRow[];
        for (const t of TILES) {
          if (t.kind !== 'fx') continue;
          const [a, b] = t.pair.split('/');
          const hit = (Array.isArray(rows) ? rows : []).find(r => r.from === a && r.to === b);
          if (!hit || hit.rate == null) continue;
          level[t.pair] = {
            value: hit.rate,
            prev: hit.change1d != null ? hit.rate / (1 + hit.change1d / 100) : null,
            asOf: null, unit: 'idx',
          };
        }
      })(),
    ]);
    const next: Record<string, TileData> = {};
    for (const key of new Set([...Object.keys(level), ...Object.keys(sparks)])) {
      next[key] = {
        ...(level[key] ?? { value: null, prev: null, asOf: null, unit: 'idx' as MacroUnit }),
        spark: sparks[key] ?? [],
      };
    }
    setTiles(next);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── the pinned strip ──
  useEffect(() => {
    if (!pinned.length) { setQuotes({}); return; }
    let cancelled = false;
    fetch(`/api/quotes?symbols=${encodeURIComponent(pinned.join(','))}`)
      .then(r => r.json())
      .then((rows: QuoteData[]) => {
        if (cancelled || !Array.isArray(rows)) return;
        setQuotes(Object.fromEntries(rows.map(q => [q.symbol, q])));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pinned.join(',')]);

  const tileValue = (t: TileSpec) => tiles[t.kind === 'macro' ? t.id : t.pair];

  return (
    <div className="space-y-4">
      {/* ── The tiles, in labelled groups ── */}
      {loading ? (
        <div className="h-28 flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-3">
          {GROUPS.map(g => (
            <div key={g.title} className="space-y-1.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <g.icon size={13} className="text-accent shrink-0" />
                  <h2 className="text-sm font-semibold text-gray-200">{g.title}</h2>
                </span>
                <span className="text-[10px] text-gray-600">{g.blurb}</span>
              </div>
              {/* The same column count for every group, so a tile is the same width
                  whether its group holds two of them or four. */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                {g.tiles.map(t => {
                  const key = t.kind === 'macro' ? t.id : t.pair;
                  return (
                    <MacroTile key={key} spec={t} data={tileValue(t)}
                      // Opens OVER this page rather than handing over to another tab:
                      // closing the detail should return you where you started, and being
                      // relocated to Macro because you glanced at the dollar is the wrong
                      // outcome. The full tab is still one click away from inside the panel.
                      onOpen={() => setTile({ kind: t.kind, key, label: t.label })} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Major events — before the pinned strip, because they are context for it ── */}
      <MajorEventsStrip />

      {/* ── Pinned ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Star size={13} className="text-amber-300 fill-amber-300" />
          <h2 className="text-sm font-semibold text-gray-200">Pinned</h2>
          <span className="text-[10px] text-gray-600">{pinned.length || 'none yet'}</span>
        </div>

        {pinned.length === 0 ? (
          <div className="rounded-xl border border-border bg-bg-card p-6 text-center space-y-2">
            <p className="text-sm text-gray-400">Nothing pinned.</p>
            <p className="text-[11px] text-gray-600">
              The ★ on any card — in Indexes, Commodities, Sectors, Crypto or Stocks — puts it here.
            </p>
            {onNavigate && (
              <button onClick={() => onNavigate('indexes')}
                className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                Go to Indexes <ArrowRight size={12} />
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {pinned.map(sym => {
              const q = quotes[sym];
              const name = NAME_OF.get(sym) ?? q?.name ?? sym;
              const group = GROUP_OF.get(sym) ?? 'Stocks';
              return (
                <button key={sym}
                  onClick={() => setOpen({ symbol: sym, name, group })}
                  className="rounded-xl border border-border bg-bg-card p-3 text-left hover:border-accent/50 transition-colors">
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">{group}</p>
                    <PhaseChip phase={phases.get(sym)} />
                  </div>
                  <p className="text-sm font-semibold text-gray-100 leading-snug truncate">{name}</p>
                  {q ? (
                    <>
                      <p className="text-lg font-bold text-white tabular-nums mt-0.5">
                        {q.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </p>
                      <div className="grid grid-cols-2 gap-x-2 mt-1">
                        {([['Day', q.changePercent], ['YTD', q.ytdChangePercent],
                           ['1Y', q.fiftyTwoWeekChangePercent]] as [string, number | null | undefined][])
                          .filter(([, v]) => v != null)
                          .map(([k, v]) => (
                            <p key={k} className={clsx('text-[10px] tabular-nums',
                              (v as number) >= 0 ? 'text-up-text' : 'text-down-text')}>
                              <span className="text-gray-500">{k}:</span> {(v as number) >= 0 ? '+' : ''}{(v as number).toFixed(1)}%
                            </p>
                          ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-600 mt-1">Loading…</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <AssetQuickView symbol={open.symbol} name={open.name} group={open.group}
          onClose={() => setOpen(null)} />
      )}

      {tile && (
        <MacroQuickView
          target={tile}
          onClose={() => setTile(null)}
          onOpenFull={() => {
            const t = tile;
            setTile(null);
            onNavigate?.(t.kind === 'macro' ? 'macro' : 'currencies', t.key);
          }}
        />
      )}
    </div>
  );
}
