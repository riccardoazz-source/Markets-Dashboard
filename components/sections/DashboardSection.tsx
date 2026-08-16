'use client';

// Dashboard — the landing page.
//
// The handful of numbers that set the weather for everything else, and then whatever the
// user has pinned. Nothing here is new data: the tiles read the same endpoints the Macro and
// Currencies tabs read, and the pinned strip reads the same gist-backed pin set every
// other section writes to. The point is not more information, it is the things worth
// seeing before the rest.
//
// The tiles are GROUPED rather than laid out in one undifferentiated row, because a dozen
// numbers side by side is a wall: the dollar belongs with the euro, the three policy rates
// belong with each other, and the Fed's balance sheet belongs with the yields it moves.
// Grouped, each row is one question — what is the dollar doing, what is the price of
// money, what is the Fed's mandate doing, where is liquidity, what is the market itself
// paying — and the tiles inside it are the answer. Where a group's members read against
// each other (three policy rates, two yields and their spread) that comparison is the
// whole point of putting them on one line.

import { useState, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { Star, ArrowRight, DollarSign, Percent, Users, Landmark, Activity, type LucideIcon } from 'lucide-react';
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
// ── One colour rule for every tile: green when the number rose, red when it fell ─────
//
// Unemployment and inflation used to be inverted, on the reasoning that a RISE in either
// is bad news. Read one tile at a time that is defensible; read as a page it is not. Nine
// tiles said "green means the line went up" and two said the opposite, so the two looked
// like a bug rather than a judgement — and the sparkline sits right there contradicting
// its own colour. Whether a rise is welcome is a question about the reader's position,
// not about the series, and this page does not know the reader's position. Direction is
// what the tile actually knows, so direction is what it shows.
type TileSpec =
  | { kind: 'macro'; id: string; label: string; hint: string;
      /** Series that can cross zero, where a percentage change is meaningless. */
      absoluteOnly?: boolean }
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
      { kind: 'macro', id: 'UNRATE', label: 'US unemployment',
        hint: 'US unemployment rate. Half the Federal Reserve’s mandate, and the half that usually turns first.' },
      { kind: 'macro', id: 'CPI_YOY', label: 'US inflation',
        hint: 'US inflation — the change in the CPI over the last twelve months. The other half of the Federal Reserve’s mandate.' },
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
      // absoluteOnly: this one is a DIFFERENCE and sits near zero, so a percentage
      // change is arithmetic without meaning — 0.05 to 0.51 is "+920%", and a window
      // that starts on the other side of zero produces a number with no defensible
      // sign at all. The move in percentage points is the whole story here.
      { kind: 'macro', id: 'T10Y2Y', label: '10Y–2Y Spread', absoluteOnly: true,
        hint: 'The ten-year yield minus the two-year. Below zero the curve is inverted — the market is pricing lower rates ahead, which has historically preceded recessions.' },
    ],
  },
  {
    title: 'Market', icon: Activity,
    // Last, because it is the only group that is the market's own opinion rather than a
    // measurement of the economy: what it is paying to insure itself, and what it is
    // paying for a decade of earnings. Both read against the four groups above them.
    blurb: 'What the market charges for risk, and pays for earnings',
    tiles: [
      { kind: 'macro', id: 'VIX', label: 'VIX',
        hint: 'What the option market is charging to insure the S&P 500 over the next month. It rises when the market is frightened.' },
      { kind: 'macro', id: 'SHILLER_CAPE', label: 'S&P 500 Shiller CAPE',
        hint: 'Cyclically adjusted P/E — the S&P 500 price over ten years of inflation-adjusted earnings, so a single good or bad year cannot flatter it. High readings say the index is expensive against its own long-run earnings. Monthly.' },
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

// ── What a tile compares itself against ──────────────────────────────────────
// One year, always — not the previous observation.
//
// The daily change was the wrong reference for this page. Half of these series are
// monthly or set by committee, so "yesterday" is almost always the same number: the
// policy-rate tiles read "unchanged" on nearly every day of the year, which says nothing,
// while the Fed actually moved 75bp over the window the sparkline underneath was drawing.
// It also made the number and the picture disagree — a tile could print a red −0.3% over a
// sparkline that rose all year, and the eye believes the picture.
//
// So the comparison is the first point of the same one-year series the sparkline draws.
// The number, the percentage and the colour of the line then all describe the same move,
// and `refDate` records which observation it actually was — for a monthly series the
// earliest point in the window is not exactly 365 days back, and the tooltip says so
// rather than implying a precision the data does not have.
interface TileData {
  value: number | null;
  /** Value one year ago — the first point of the 1Y series. */
  ref: number | null;
  refDate: string | null;
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
  const change = d?.value != null && d?.ref != null ? d.value - d.ref : null;
  const pct = change != null && d?.ref && !(spec.kind === 'macro' && spec.absoluteOnly)
    ? (change / Math.abs(d.ref)) * 100 : null;
  // A series that did not move has no direction at all — it is grey, not red. Reading
  // `change > 0` painted an unchanged policy rate red.
  const up = change == null || change === 0 ? null : change > 0;
  const ref = d?.refDate
    ? `\n\nThe change is over one year, measured against ${d.refDate}.`
    : '';
  return (
    <button title={`${spec.hint}${ref}\n\nClick for the chart.`} onClick={onOpen}
      className="rounded-lg border border-border bg-bg-card px-2.5 py-2 flex flex-col gap-0.5 text-left
                 hover:border-accent/50 transition-colors">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 leading-none truncate">{spec.label}</p>
      <p className="text-lg font-bold text-white tabular-nums leading-tight">
        {d?.value == null ? '—'
          : spec.kind === 'fx' ? d.value.toFixed(4)
          : formatMacroValue(d.value, d.unit)}
      </p>
      {/* The change and the as-of date share a line. They were two rows, and the date is
          a footnote — giving it a row of its own cost as much height as the number it
          annotates. */}
      <div className="flex items-baseline justify-between gap-1 leading-none">
        <p className={clsx('text-[10px] font-semibold tabular-nums truncate',
          up == null ? 'text-gray-600' : up ? 'text-up-text' : 'text-down-text')}>
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
          {/* Named on every tile: an unlabelled change is read as "today", and this one
              is not. It is the same window the sparkline below it draws. */}
          <span className="text-gray-600 font-normal"> 1Y</span>
        </p>
        {d?.asOf && <span className="text-[9px] text-gray-600 shrink-0">{d.asOf}</span>}
      </div>
      {d && <Sparkline points={d.spark} up={up} />}
    </button>
  );
}

function Sparkline({ points, up }: { points: { date: string; v: number }[]; up: boolean | null }) {
  if (points.length < 3) return <div className="h-6" />;
  // Takes the tile's colour rather than deciding its own, so the line and the number
  // above it can never disagree. Both mean the same thing: the direction over the year.
  const stroke = up == null ? '#64748b' : up ? '#22c55e' : '#f87171';
  // The domain is the series' own range, not zero-based: these are levels, and a rate
  // moving from 4.25 to 4.50 is invisible on an axis that starts at zero.
  return (
    <div className="h-6 -mx-1">
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
    const level: Record<string, Omit<TileData, 'spark' | 'ref' | 'refDate'>> = {};
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
        // The endpoint carries both directions of every pair. Only the level is taken
        // from it: the comparison every tile draws comes from the one-year series, so
        // `change1d` is not read here at all.
        const rows = await res.json() as FxRow[];
        for (const t of TILES) {
          if (t.kind !== 'fx') continue;
          const [a, b] = t.pair.split('/');
          const hit = (Array.isArray(rows) ? rows : []).find(r => r.from === a && r.to === b);
          if (!hit || hit.rate == null) continue;
          level[t.pair] = { value: hit.rate, asOf: null, unit: 'idx' };
        }
      })(),
    ]);
    const next: Record<string, TileData> = {};
    for (const key of new Set([...Object.keys(level), ...Object.keys(sparks)])) {
      const spark = sparks[key] ?? [];
      next[key] = {
        ...(level[key] ?? { value: null, asOf: null, unit: 'idx' as MacroUnit }),
        spark,
        // The oldest point in the one-year window. Deliberately taken from the SAME
        // series the sparkline draws rather than from a second request, so the number
        // and the line can never describe different windows. If the history call failed
        // there is no reference and the tile shows a level with no change, which is
        // honest — better than falling back to a daily change under a "1Y" label.
        ref: spark[0]?.v ?? null,
        refDate: spark[0]?.date ?? null,
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
    <div className="space-y-3">
      {/* ── The tiles, in labelled groups ── */}
      {loading ? (
        <div className="h-28 flex items-center justify-center"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-2.5">
          {GROUPS.map(g => (
            <div key={g.title} className="space-y-1">
              {/* The blurb sits on the SAME line as the title and is dropped below `sm`.
                  It is a one-time explanation; on a phone it was costing a line of height
                  on every group, permanently, to say something the reader learns once. */}
              <div className="flex items-baseline gap-2">
                <span className="flex items-center gap-1.5 shrink-0">
                  <g.icon size={12} className="text-accent shrink-0" />
                  <h2 className="text-[13px] font-semibold text-gray-200 leading-none">{g.title}</h2>
                </span>
                <span className="hidden sm:block text-[10px] text-gray-600 truncate">{g.blurb}</span>
              </div>
              {/* The same column count for every group, so a tile is the same width
                  whether its group holds two of them or four. */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5">
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
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Star size={12} className="text-amber-300 fill-amber-300" />
          <h2 className="text-[13px] font-semibold text-gray-200 leading-none">Pinned</h2>
          <span className="text-[10px] text-gray-600">{pinned.length || 'none yet'}</span>
        </div>

        {pinned.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-card p-5 text-center space-y-1.5">
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5">
            {pinned.map(sym => {
              const q = quotes[sym];
              const name = NAME_OF.get(sym) ?? q?.name ?? sym;
              const group = GROUP_OF.get(sym) ?? 'Stocks';
              return (
                <button key={sym}
                  onClick={() => setOpen({ symbol: sym, name, group })}
                  className="rounded-lg border border-border bg-bg-card px-2.5 py-2 text-left hover:border-accent/50 transition-colors">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 leading-none truncate">{group}</p>
                    <PhaseChip phase={phases.get(sym)} />
                  </div>
                  <p className="text-[13px] font-semibold text-gray-100 leading-tight truncate mt-0.5">{name}</p>
                  {q ? (
                    <>
                      <p className="text-base font-bold text-white tabular-nums leading-tight">
                        {q.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </p>
                      {/* Wrapping row rather than a fixed two-column grid: three figures
                          in a 2×2 grid always leave one cell empty, so the card carried a
                          blank half-row. Wrapped, they take one line where there is room
                          and two where there is not. */}
                      <div className="flex flex-wrap gap-x-2 leading-tight">
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
                    <p className="text-xs text-gray-600 mt-0.5">Loading…</p>
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
