'use client';

// The CSV behind the chart.
//
// The Phase Lab can tell us whether a definition of the cycle predicts anything;
// it cannot tell us WHICH variables to build that definition from. For that we need
// the raw series — price, MACD, RSI, momentum, volume, moving averages — date by
// date, in a file we can actually study. Exporting exactly the tools that are
// switched on means the file always contains what the chart is showing, no more and
// no less.
//
// Rather than thread a data prop through ten panels, the chart PUBLISHES its
// computed rows here and the export button reads them. Only one detail panel is
// open at a time, so last-write-wins is the correct behaviour, not a compromise —
// and a chart that publishes nothing simply leaves the button disabled.

export type ExportRow = Record<string, string | number | null>;

interface Published { title: string; rows: ExportRow[]; owner: symbol; ts: number }
let current: Published | null = null;

/**
 * `owner` is a token unique to the chart instance. Without it, a panel that
 * publishes nothing would happily export whatever the PREVIOUS panel left behind —
 * a file full of the wrong asset's numbers, with the right filename on it. A chart
 * clears the slot on unmount, but only if it still owns it.
 */
export function publishChartRows(title: string, rows: ExportRow[], owner: symbol) {
  current = { title, rows, owner, ts: Date.now() };
}

export function clearChartRows(owner?: symbol) {
  if (!owner || current?.owner === owner) current = null;
}

export function getChartRows(): Published | null {
  return current && current.rows.length ? current : null;
}

/** RFC-4180 enough: quote anything containing a comma, a quote or a newline. */
function cell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: ExportRow[]): string {
  if (!rows.length) return '';
  // Union of every key, in first-seen order: a column that only exists on some rows
  // (a moving average that needs 200 bars) still gets its place, left blank early on.
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => cell(r[c])).join(','));
  return lines.join('\n');
}

export function downloadCsv(fileName: string, csv: string) {
  // A BOM so Excel opens UTF-8 correctly instead of mangling any accented name.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
