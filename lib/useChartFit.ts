'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ActiveTools } from '@/components/ui/ChartTools';

// Keep an asset panel inside the window.
//
// Every tool that opens a pane — volume, RSI, MACD, momentum — pushes the panel
// taller, and past a couple of them the bottom of it (the very thing just turned
// on) ends up below the fold. Predicting the non-chart height does not work: a
// caption wraps, a legend row appears when a moving average is on, a stats grid
// gains a line. So the panel is MEASURED after it lays out, and because the chart
// heights are known, subtracting them gives the true chrome — leaving the exact
// room the charts may occupy.
//
// It lands in one step. Scaling by the overflow ratio instead would try to shrink
// the chrome too, and take a dozen re-renders of every chart to settle.

/** Panes each tool opens under the price — what the fit has to make room for. */
export function paneCountOf(t: Partial<ActiveTools> | undefined): number {
  if (!t) return 0;
  return [
    t.volume, t.rsi, t.macd,
    t.momentumDaily, t.momentumWeekly, t.momentumMonthly,
    t.stretchSigma, t.maSlope, t.drawdown,
  ].filter(Boolean).length;
}

export interface ChartFitOptions {
  /** Height of the main chart when there is room for everything. */
  base?: number;
  /** Never shrink the main chart below this — past it the chart says nothing. */
  minChart?: number;
  /**
   * Panes floor lower than you would guess (32px). With seven tools open there is
   * no height at which everything is comfortable, and a 32px strip still shows the
   * SHAPE of a line and where it crosses zero — which is what these panes are read
   * for. The alternative is not seeing the pane at all.
   */
  basePane?: number;
  minPane?: number;
}

export function useChartFit(paneCount: number, opts: ChartFitOptions = {}) {
  const { base = 200, minChart = 110, basePane = 80, minPane = 32 } = opts;
  const ref = useRef<HTMLDivElement>(null);
  // Optional end marker. Some panels continue well past the chart — the stocks tab
  // adds dividends, earnings and financials underneath — and those sections are
  // MEANT to be scrolled to. Measuring them too would shrink the price chart to
  // nothing in order to fit content nobody expects to see at once. Attach this to
  // the last element that has to be visible without scrolling, and everything
  // below it is left out of the sum.
  const endRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  const chartAt = (f: number) => Math.max(minChart, Math.round(base * f));
  const paneAt = (f: number) => Math.max(minPane, Math.round(basePane * f));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure everything the window has to hold: the panel, plus the Print row
    // above it and the modal's outer padding.
    const wrapper = (el.closest('[data-print-root]') as HTMLElement | null) ?? el;
    const outerPad = window.innerWidth >= 640 ? 48 : 16;   // p-2 / sm:p-6
    const end = endRef.current;
    const total = end
      ? end.getBoundingClientRect().bottom - wrapper.getBoundingClientRect().top + outerPad
      : wrapper.offsetHeight + outerPad;
    if (total <= 0) return;

    const charts = chartAt(fit) + paneAt(fit) * paneCount;
    const chrome = total - charts;
    // A few pixels of slack: the heights are rounded, so aiming at the exact
    // bottom edge lands a hair past it as often as on it.
    const room = window.innerHeight - chrome - 8;
    if (charts <= 0 || room <= 0) return;

    const next = Math.max(0.45, Math.min(1, fit * (room / charts)));
    // Only when it makes a visible difference, so a rounding wobble cannot start
    // an endless shrink/grow cycle.
    if (Math.abs(next - fit) > 0.01) setFit(next);
  });

  return { ref, endRef, fit, height: chartAt(fit), paneHeight: paneAt(fit) };
}
