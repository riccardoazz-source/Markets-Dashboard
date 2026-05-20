import { useState, useRef, useCallback } from 'react';

interface ChartEvent { activeLabel?: string }

export interface DragRange { left: string; right: string }

/**
 * Shared click-and-drag period selection for Recharts charts.
 * Wire `handlers` onto the chart, render a ReferenceArea from `area`,
 * and read `range` (committed selection) to show change stats.
 */
export function useChartDragSelect() {
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [range, setRange] = useState<DragRange | null>(null);
  const startRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    setDragStart(null);
    setDragEnd(null);
    setIsDragging(false);
    setRange(null);
  }, []);

  const onMouseDown = useCallback((e: ChartEvent | null) => {
    if (!e?.activeLabel) return;
    startRef.current = e.activeLabel;
    setDragStart(e.activeLabel);
    setDragEnd(null);
    setIsDragging(true);
    setRange(null);
  }, []);

  const onMouseMove = useCallback((e: ChartEvent | null) => {
    if (!isDragging || !e?.activeLabel) return;
    setDragEnd(e.activeLabel);
  }, [isDragging]);

  const onMouseUp = useCallback((e: ChartEvent | null) => {
    if (!isDragging) return;
    setIsDragging(false);
    const start = startRef.current;
    const end = e?.activeLabel ?? dragEnd;
    if (!start || !end || start === end) { clear(); return; }
    const [left, right] = start < end ? [start, end] : [end, start];
    setDragStart(left);
    setDragEnd(right);
    setRange({ left, right });
  }, [isDragging, dragEnd, clear]);

  const area: DragRange | null = dragStart && dragEnd
    ? {
        left:  dragStart < dragEnd ? dragStart : dragEnd,
        right: dragStart < dragEnd ? dragEnd : dragStart,
      }
    : null;

  return {
    handlers: { onMouseDown, onMouseMove, onMouseUp },
    range,
    area,
    clear,
    isDragging,
  };
}

/** Value of `key` at-or-after `date` (left edge) — first non-null value at or after date. */
export function valueAtOrAfter(
  data: ReadonlyArray<{ date: string }>, date: string, key: string,
): number | null {
  for (const row of data) {
    if (row.date < date) continue;
    const v = (row as Record<string, unknown>)[key];
    if (typeof v === 'number' && isFinite(v)) return v;
  }
  return null;
}

/** Value of `key` at-or-before `date` (right edge) — last non-null value at or before date. */
export function valueAtOrBefore(
  data: ReadonlyArray<{ date: string }>, date: string, key: string,
): number | null {
  let result: number | null = null;
  for (const row of data) {
    if (row.date > date) break;
    const v = (row as Record<string, unknown>)[key];
    if (typeof v === 'number' && isFinite(v)) result = v;
  }
  return result;
}
