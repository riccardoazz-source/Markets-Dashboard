// Universal data-source scraper.
// Accepts any URL and attempts to extract a time-series of (date, value) pairs.
// Smart dispatch:
//   fred.stlouisfed.org/series/ID  →  DBnomics mirror (FRED proxy)
//   finance.yahoo.com/quote/SYM    →  Yahoo v8 chart
//   other URL                      →  fetch + parse (JSON / CSV / HTML tables)
//
// Called by MacroSection for overridden built-in indicators and custom indicators.
// Also called by SourcesSection for live status checks.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 30 * 60_000;

type DP = { date: string; value: number };
interface ScrapeResult {
  success: boolean;
  data: DP[];
  message: string;
  sourceType: string;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

// Resolve as soon as any promise returns a non-empty array; fall back to [] if all fail.
function raceSuccess(promises: Array<Promise<DP[]>>): Promise<DP[]> {
  return new Promise(resolve => {
    let remaining = promises.length;
    if (!remaining) { resolve([]); return; }
    for (const p of promises) {
      p.then(arr => {
        if (arr.length > 0) resolve(arr);
        else if (--remaining === 0) resolve([]);
      }).catch(() => { if (--remaining === 0) resolve([]); });
    }
  });
}

// ─── URL pattern helpers ───────────────────────────────────────────────────

function fredId(url: string): string | null {
  const m = url.match(/fred\.stlouisfed\.org\/(?:series|graph\/fredgraph\.(?:csv|txt))[?/](?:id=)?([A-Z0-9_.]+)/i);
  return m ? m[1].toUpperCase() : null;
}

function yahooSym(url: string): string | null {
  const m = url.match(/finance\.yahoo\.com\/quote\/([^/?&#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── Date normalization ────────────────────────────────────────────────────

const MON: Record<string, string> = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
};

function expandYear(yy: string): string {
  const n = parseInt(yy, 10);
  return (n >= 70 ? 1900 + n : 2000 + n).toString();
}

function normalizeDate(s: string): string | null {
  s = s.trim().replace(/ /g, ' '); // strip non-breaking spaces
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');

  // XX/XX/YYYY — if first number > 12 it must be day (DD/MM/YYYY), else US (MM/DD/YYYY)
  const slash4 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash4) {
    const a = parseInt(slash4[1]);
    if (a > 12) return `${slash4[3]}-${slash4[2].padStart(2,'0')}-${slash4[1].padStart(2,'0')}`;
    return `${slash4[3]}-${slash4[1].padStart(2,'0')}-${slash4[2].padStart(2,'0')}`;
  }

  // XX/XX/YY (2-digit year) — same DD/MM disambiguation
  const slash2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (slash2) {
    const a = parseInt(slash2[1]);
    const year = expandYear(slash2[3]);
    if (a > 12) return `${year}-${slash2[2].padStart(2,'0')}-${slash2[1].padStart(2,'0')}`;
    return `${year}-${slash2[1].padStart(2,'0')}-${slash2[2].padStart(2,'0')}`;
  }

  // DD.MM.YYYY or DD-MM-YYYY
  const dmy4 = s.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})$/);
  if (dmy4) return `${dmy4[3]}-${dmy4[2].padStart(2,'0')}-${dmy4[1].padStart(2,'0')}`;

  // "January 15, 2024" / "Jan 15, 2024" / "Jan 15 2024"
  const mdy2 = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy2) { const m = MON[mdy2[1].toLowerCase().slice(0,3)]; if (m) return `${mdy2[3]}-${m}-${mdy2[2].padStart(2,'0')}`; }

  // "15 January 2024" / "15 Jan 2024"
  const dmy2 = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dmy2) { const m = MON[dmy2[2].toLowerCase().slice(0,3)]; if (m) return `${dmy2[3]}-${m}-${dmy2[1].padStart(2,'0')}`; }

  // "Jan 2024" / "January 2024"
  const my = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (my) { const m = MON[my[1].toLowerCase().slice(0,3)]; if (m) return `${my[2]}-${m}-01`; }

  // Q1 2024 / 2024-Q1 / 2024Q1
  const qy = s.match(/(?:^Q([1-4])\s+(\d{4})$|^(\d{4})-?Q([1-4])$)/i);
  if (qy) {
    const q = parseInt(qy[1] ?? qy[4]); const y = qy[2] ?? qy[3];
    return `${y}-${((q-1)*3+1).toString().padStart(2,'0')}-01`;
  }

  // H1/H2 YYYY (semi-annual)
  const hy = s.match(/^(\d{4})-?H([12])$/i);
  if (hy) return `${hy[1]}-${hy[2] === '1' ? '01' : '07'}-01`;

  if (/^\d{4}$/.test(s)) return `${s}-07-01`; // annual → mid-year
  return null;
}

// ─── Number parsing (EU "1.234,56" and US "1,234.56") ─────────────────────

function parseNum(s: string): number | null {
  let n = s.trim().replace(/[$€£¥₹]/g,'').replace(/\s/g,'').replace(/%$/,'');
  if (n.startsWith('(') && n.endsWith(')')) n = '-' + n.slice(1,-1);
  // European thousands + decimal: 1.234.567,89
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g,'').replace(',','.');
  else n = n.replace(/,/g,''); // US: strip thousand-commas
  const v = parseFloat(n);
  return isFinite(v) ? v : null;
}

// ─── Script-embedded chart data extractor ─────────────────────────────────
// Many "JS-rendered" pages embed their chart data directly in <script> tags
// as JavaScript arrays — no browser execution needed, just HTML parsing.
// Handles Highcharts [[timestamp_ms, value], ...] and similar patterns.

function tsToDate(ts: number): string | null {
  const tsMs = ts < 1e10 ? ts * 1000 : ts;
  const year = new Date(tsMs).getFullYear();
  if (year < 1950 || year > 2100) return null;
  return new Date(tsMs).toISOString().slice(0, 10);
}

function extractFromScripts(html: string, fromDate?: string): DP[] {
  let best: DP[] = [];

  const scriptRx = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;

  while ((sm = scriptRx.exec(html)) !== null) {
    const attrs = sm[1] ?? '';
    const code  = sm[2] ?? '';
    if (/\bsrc\s*=/i.test(attrs) || code.length < 40) continue;

    const pts: DP[] = [];

    // Pattern 1: [timestamp, value] — Highcharts/ApexCharts array format
    const arrRx = /\[\s*(\d{9,13})\s*,\s*([\-\d.]+)\s*\]/g;
    let m: RegExpExecArray | null;
    while ((m = arrRx.exec(code)) !== null) {
      const date = tsToDate(parseInt(m[1]));
      if (!date) continue;
      const val = parseFloat(m[2]);
      if (isFinite(val) && !(fromDate && date < fromDate)) pts.push({ date, value: val });
    }

    // Pattern 2: {x: timestamp, y: value} — Highcharts/ApexCharts object format
    const objRx = /\{\s*["']?x["']?\s*:\s*(\d{9,13})\s*,[^}]{0,80}["']?y["']?\s*:\s*([\-\d.]+)/g;
    while ((m = objRx.exec(code)) !== null) {
      const date = tsToDate(parseInt(m[1]));
      if (!date) continue;
      const val = parseFloat(m[2]);
      if (isFinite(val) && !(fromDate && date < fromDate)) pts.push({ date, value: val });
    }

    // Pattern 3: {timestamp: ts, value: v} or {date: ts, price: v} etc.
    const objRx2 = /\{\s*["']?(?:timestamp|t|time)["']?\s*:\s*(\d{9,13})\s*,[^}]{0,80}["']?(?:value|v|price|close|last)["']?\s*:\s*([\-\d.]+)/g;
    while ((m = objRx2.exec(code)) !== null) {
      const date = tsToDate(parseInt(m[1]));
      if (!date) continue;
      const val = parseFloat(m[2]);
      if (isFinite(val) && !(fromDate && date < fromDate)) pts.push({ date, value: val });
    }

    if (pts.length >= 5 && pts.length > best.length) best = pts;
  }

  // Deduplicate by date (keep last occurrence per date)
  const deduped = new Map<string, number>();
  for (const pt of best) deduped.set(pt.date, pt.value);
  return Array.from(deduped.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── HTML table extractor ─────────────────────────────────────────────────

function extractFromHtml(html: string, fromDate?: string): DP[] {
  const tableRx = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let best: DP[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableRx.exec(html)) !== null) {
    const rows: string[][] = [];
    const rowRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRx.exec(m[1])) !== null) {
      const cells: string[] = [];
      const cellRx = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cellRx.exec(rm[1])) !== null) {
        const txt = cm[1]
          .replace(/<[^>]+>/g,' ')
          .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<')
          .replace(/&gt;/gi,'>').replace(/&quot;/gi,'"')
          .replace(/&#(\d+);/gi, (_,n)=>String.fromCharCode(+n))
          .replace(/\s+/g,' ').trim();
        if (txt) cells.push(txt);
      }
      if (cells.length >= 2) rows.push(cells);
    }
    if (rows.length < 3) continue;
    const cols = Math.min(rows[0].length, 5);
    for (let dc = 0; dc < cols; dc++) {
      for (let vc = 0; vc < cols; vc++) {
        if (dc === vc) continue;
        const pts: DP[] = [];
        for (const row of rows) {
          if (row.length <= Math.max(dc,vc)) continue;
          const d = normalizeDate(row[dc]); if (!d) continue;
          if (fromDate && d < fromDate) continue;
          const v = parseNum(row[vc]); if (v !== null) pts.push({ date: d, value: v });
        }
        if (pts.length > best.length) best = pts;
      }
    }
  }
  best.sort((a,b)=>a.date.localeCompare(b.date));
  return best;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────

// FRED public CSV endpoint — works from Node.js even when blocked on Edge.
async function tryFREDCsv(seriesId: string, fromDate?: string): Promise<DP[]> {
  const params = new URLSearchParams({ id: seriesId });
  if (fromDate) params.set('cosd', fromDate);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/csv,text/plain,*/*', Referer: 'https://fred.stlouisfed.org/' },
    });
    if (!res.ok) return [];
    const csv = await res.text();
    if (!csv || csv.length < 20) return [];
    const pts: DP[] = [];
    for (const line of csv.trim().split('\n').slice(1)) {
      const [d, v] = line.split(',');
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) continue;
      if (fromDate && d.trim() < fromDate) continue;
      const num = parseFloat((v ?? '').trim());
      if (isFinite(num)) pts.push({ date: d.trim(), value: num });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// FRED legacy tab-separated text endpoint.
async function tryFREDTxt(seriesId: string, fromDate?: string): Promise<DP[]> {
  const url = `https://fred.stlouisfed.org/data/${encodeURIComponent(seriesId)}.txt`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' } });
    if (!res.ok) return [];
    const txt = await res.text();
    const pts: DP[] = [];
    for (const line of txt.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) continue;
      if (fromDate && parts[0] < fromDate) continue;
      const num = parseFloat(parts[1]);
      if (isFinite(num)) pts.push({ date: parts[0], value: num });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// World Bank — fallback for GDP (NY.GDP.MKTP.CD, billions current USD)
//                       and GDPC1 (NY.GDP.MKTP.KD, billions constant 2015 USD).
async function tryWorldBank(indicator: string, fromDate?: string): Promise<DP[]> {
  const url = `https://api.worldbank.org/v2/country/US/indicator/${indicator}?format=json&mrv=60&per_page=60`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json() as [unknown, Array<{ date?: string; value?: number | null }>];
    const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : [];
    const pts: DP[] = [];
    for (const r of rows) {
      if (!r.date || r.value == null || !isFinite(r.value)) continue;
      pts.push({ date: `${r.date}-07-01`, value: r.value / 1e9 }); // USD → B$
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

// OECD MEI — fallback for INDPRO (US Industrial Production Index).
async function tryOECDIndPro(fromDate?: string): Promise<DP[]> {
  const url = 'https://stats.oecd.org/SDMX-JSON/data/MEI_BTE6/USA.PRMNTO01.IDX2015.M/all?format=json';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json() as {
      dataSets?: Array<{ observations?: Record<string, [number, ...unknown[]]> }>;
      structure?: { dimensions?: { observation?: Array<{ id: string; values: Array<{ id: string }> }> } };
    };
    const obs = json?.dataSets?.[0]?.observations ?? {};
    const timeDim = (json?.structure?.dimensions?.observation ?? []).find(d => d.id === 'TIME_PERIOD');
    if (!timeDim?.values?.length) return [];
    const periods = timeDim.values;
    const pts: DP[] = [];
    for (const [key, vals] of Object.entries(obs)) {
      const tIdx = parseInt(key.split(':').at(-1) ?? '-1', 10);
      if (tIdx < 0 || tIdx >= periods.length) continue;
      const raw = periods[tIdx].id;
      const dateStr = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || (fromDate && dateStr < fromDate)) continue;
      const v = vals[0];
      if (typeof v === 'number' && isFinite(v)) pts.push({ date: dateStr, value: v });
    }
    pts.sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  } catch { return []; } finally { clearTimeout(t); }
}

async function fetchDBnomics(seriesId: string, fromDate?: string): Promise<{ data: DP[]; msg: string }> {
  const enc = encodeURIComponent(seriesId);
  const urls = [
    `https://api.db.nomics.world/v22/series/FRED/${enc}/${enc}?observations=1`,
    `https://api.db.nomics.world/v22/series/FRED/${enc}?observations=1`,
  ];

  function fetchOneDBn(url: string): Promise<DP[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7_000);
    return fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': UA } })
      .then(async res => {
        if (!res.ok) return [];
        const json = await res.json() as {
          series?: { docs?: Array<{ period?: string[]; value?: (number|string|null)[] }> }
        };
        const doc = json?.series?.docs?.[0];
        if (!doc?.period?.length) return [];
        const data: DP[] = [];
        for (let i = 0; i < doc.period!.length; i++) {
          const d = normalizeDate(doc.period![i]); if (!d) continue;
          if (fromDate && d < fromDate) continue;
          const v = doc.value?.[i];
          const num = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
          if (isFinite(num)) data.push({ date: d, value: num });
        }
        data.sort((a,b)=>a.date.localeCompare(b.date));
        return data;
      })
      .catch(() => [])
      .finally(() => clearTimeout(t));
  }

  const data = await raceSuccess(urls.map(fetchOneDBn));
  return data.length
    ? { data, msg: `FRED ${seriesId} via DBnomics · ${data.length} pts` }
    : { data: [], msg: `FRED ${seriesId}: not found in DBnomics` };
}

async function fetchYahoo(symbol: string, fromDate?: string): Promise<{ data: DP[]; msg: string }> {
  const daysAgo = fromDate ? (Date.now() - new Date(fromDate).getTime()) / 86_400_000 : 365;
  const range = daysAgo > 3500 ? 'max' : daysAgo > 1500 ? '10y' : daysAgo > 800 ? '5y'
    : daysAgo > 300 ? '1y' : '6mo';
  // Always daily — no thinning, even for MAX-range queries.
  const interval = '1d';
  for (const host of ['query2.finance.yahoo.com','query1.finance.yahoo.com']) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://finance.yahoo.com/' },
      });
      if (!res.ok) continue;
      const json = await res.json() as { chart?: { result?: unknown[] } };
      const result = json?.chart?.result?.[0] as Record<string,unknown> | undefined;
      if (!result) continue;
      const ts = (result.timestamp as number[]) ?? [];
      const closes = ((result.indicators as Record<string,unknown>)?.quote as Array<Record<string,unknown>>)?.[0]?.close as number[] ?? [];
      const data: DP[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !isFinite(c) || c <= 0) continue;
        const d = new Date(ts[i]*1000).toISOString().slice(0,10);
        if (fromDate && d < fromDate) continue;
        data.push({ date: d, value: c });
      }
      data.sort((a,b)=>a.date.localeCompare(b.date));
      if (data.length) return { data, msg: `Yahoo Finance ${symbol} · ${data.length} pts` };
    } catch { /* try next */ } finally { clearTimeout(t); }
  }
  return { data: [], msg: `Yahoo Finance ${symbol}: no data` };
}

async function fetchGeneric(url: string, fromDate?: string): Promise<{ data: DP[]; msg: string; type: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { ...BROWSER_HEADERS, Referer: (() => { try { return new URL(url).origin + '/'; } catch { return url; } })() },
    });
    if (!res.ok) return { data: [], msg: `HTTP ${res.status} from ${url}`, type: 'error' };
    const ct = res.headers.get('content-type') ?? '';
    const text = await res.text();

    // JSON
    if (ct.includes('json') || (text.trimStart().startsWith('{') || text.trimStart().startsWith('['))) {
      try {
        const json = JSON.parse(text);
        const arr: unknown[] = Array.isArray(json) ? json
          : (json?.data ?? json?.observations ?? json?.values ?? json?.result ?? []);
        if (Array.isArray(arr) && arr.length > 0) {
          const sample = arr[0] as Record<string,unknown>;
          const dk = Object.keys(sample).find(k => /date|period|time/i.test(k));
          const vk = Object.keys(sample).find(k => /value|rate|close|amount|level|price/i.test(k));
          if (dk && vk) {
            const data: DP[] = [];
            for (const row of arr as Record<string,unknown>[]) {
              const d = normalizeDate(String(row[dk]).slice(0,10)); if (!d) continue;
              if (fromDate && d < fromDate) continue;
              const v = parseFloat(String(row[vk]));
              if (isFinite(v)) data.push({ date: d, value: v });
            }
            data.sort((a,b)=>a.date.localeCompare(b.date));
            if (data.length) return { data, msg: `JSON · ${data.length} pts`, type: 'json' };
          }
        }
      } catch { /* fall through */ }
    }

    // CSV / TSV / semicolon-separated
    if (ct.includes('csv') || ct.includes('text/plain') || /[,;\t]/.test(text.split('\n')[0] ?? '')) {
      const sep = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ',';
      const lines = text.trim().split('\n');
      const data: DP[] = [];
      let headerSkipped = false;
      for (const line of lines) {
        const parts = line.split(sep).map(p => p.trim().replace(/^"|"$/g,''));
        if (parts.length < 2) continue;
        const d = normalizeDate(parts[0]);
        if (!d && !headerSkipped) { headerSkipped = true; continue; }
        if (!d) continue;
        if (fromDate && d < fromDate) continue;
        for (let ci = 1; ci < parts.length; ci++) {
          const v = parseNum(parts[ci]);
          if (v !== null) { data.push({ date: d, value: v }); break; }
        }
      }
      data.sort((a,b)=>a.date.localeCompare(b.date));
      if (data.length > 1) return { data, msg: `CSV · ${data.length} pts`, type: 'csv' };
    }

    // HTML: try table first, then script-embedded chart data
    if (ct.includes('html') || text.includes('<table') || text.includes('<script')) {
      if (text.includes('<table')) {
        const tableData = extractFromHtml(text, fromDate);
        if (tableData.length >= 3) return { data: tableData, msg: `HTML table · ${tableData.length} rows`, type: 'html' };
      }
      if (text.includes('<script')) {
        const scriptData = extractFromScripts(text, fromDate);
        if (scriptData.length >= 5) return { data: scriptData, msg: `Chart data · ${scriptData.length} pts`, type: 'script' };
      }
      return { data: [], msg: 'No parseable data found on page', type: 'html' };
    }

    return { data: [], msg: `Unsupported content type: ${ct}`, type: 'unknown' };
  } catch (e) {
    return { data: [], msg: `Error: ${(e as Error).message}`, type: 'error' };
  } finally { clearTimeout(t); }
}

// ─── GET handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ success: false, data: [], message: 'Missing url', sourceType: 'error' });
  }
  // Auto-add https:// so bare domains like "bullionbypost.co.uk" are valid URLs
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const fromDate = req.nextUrl.searchParams.get('from') ?? undefined;
  const ck = `${url}|${fromDate ?? ''}`;

  const hit = cache.get(ck);
  if (hit && Date.now() - hit.ts < TTL) {
    return NextResponse.json(hit.data, { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } });
  }

  let result: ScrapeResult;
  const fid = fredId(url);
  const ysym = yahooSym(url);

  if (fid) {
    // Race FRED CSV (4s), TXT (4s), DBnomics (7s) — resolve on first non-empty result
    const dbnPromise = fetchDBnomics(fid, fromDate);
    let data = await raceSuccess([
      tryFREDCsv(fid, fromDate),
      tryFREDTxt(fid, fromDate),
      dbnPromise.then(r => r.data),
    ]);
    let msg = data.length ? `FRED ${fid} · ${data.length} pts` : '';

    // Specific fallbacks for series with known alternative public APIs
    if (!data.length) {
      if (fid === 'GDP') {
        data = await tryWorldBank('NY.GDP.MKTP.CD', fromDate);
        if (data.length) msg = `World Bank (GDP current USD) · ${data.length} pts`;
      } else if (fid === 'GDPC1') {
        data = await tryWorldBank('NY.GDP.MKTP.KD', fromDate);
        if (data.length) msg = `World Bank (Real GDP 2015 USD) · ${data.length} pts`;
      } else if (fid === 'INDPRO') {
        data = await tryOECDIndPro(fromDate);
        if (data.length) msg = `OECD (Industrial Production) · ${data.length} pts`;
      }
    }

    if (!msg) msg = `FRED ${fid}: all sources failed`;
    result = { success: data.length > 0, data, message: msg, sourceType: 'fred' };
  } else if (ysym) {
    const { data, msg } = await fetchYahoo(ysym, fromDate);
    result = { success: data.length > 0, data, message: msg, sourceType: 'yahoo' };
  } else {
    const { data, msg, type } = await fetchGeneric(url, fromDate);
    result = { success: data.length > 0, data, message: msg, sourceType: type };
  }

  if (result.success) cache.set(ck, { data: result, ts: Date.now() });

  return NextResponse.json(result, {
    headers: { 'Cache-Control': result.success ? 'public, s-maxage=1800, stale-while-revalidate=3600' : 'no-store' },
  });
}
