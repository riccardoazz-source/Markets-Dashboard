'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, Download, Upload, AlertTriangle, Check } from 'lucide-react';
import {
  loadGistData, updateGistData, useSyncStatus, lastWriteError, lastUpload, type GistData,
} from '@/lib/gist';
import { missingFromRemote } from '@/lib/gistMerge';
import { DetailModal } from './DetailModal';
import { PanelClose } from './PanelClose';

// ── Where your saved things actually are ─────────────────────────────────────
//
// Everything personal in this app — notes, the stock watchlist, saved rotations, pins,
// My Strategy, personal calendar entries — is ONE object. It is kept in this browser's
// localStorage and, when cloud storage is configured, mirrored to a GitHub gist so every
// device sees the same thing.
//
// When the cloud is NOT configured, localStorage is the only copy, and localStorage is
// per-browser. The phone and the desktop are then two separate islands: each shows what
// was created on it and neither can see the other. That is not a fault and nothing is
// broken, but it is invisible — which is how someone ends up with 48 stocks on a phone
// and an empty list on a desktop and no idea why.
//
// So this panel says which of the two situations you are in, in words, and gives a way
// out that does not depend on the cloud at all: write the whole object to a file on one
// device, read it back on the other.
//
// The badge that used to be the only warning lived inside the Notes panel — inside the
// feature that stops working. Now it is in the navbar, and only when something is wrong.

function countsOf(d: GistData) {
  const notes = d.notes ?? {};
  const chartIds = Object.keys(notes);
  return {
    noteEntries: chartIds.reduce((n, k) => n + (notes[k]?.length ?? 0), 0),
    stocks: chartIds.filter(k => k.startsWith('stock:')).length,
    rotationLists: (d.rotationStockLists ?? []).length,
    pins: (d.pins ?? []).length,
    strategy: (d.strategyCustom ?? []).length + Object.keys(d.strategyLinks ?? {}).length,
    calendar: (d.calendarEvents ?? []).length,
    analyses: (d.analyses ?? []).length,
    sentiments: (d.sentiments ?? []).length,
  };
}

export function DataBackupPanel({ onClose }: { onClose: () => void }) {
  const status = useSyncStatus();
  const [data, setData] = useState<GistData | null>(null);
  const [owed, setOwed] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadGistData().then(setData).catch(() => setData({})); }, []);

  // What this device is holding that the server has not got.
  //
  // The question "where is my data" cannot be answered by reading /api/gist, because that
  // endpoint returns the SERVER's copy and therefore says the same thing from every
  // device. The interesting comparison is local against remote, and only the device
  // itself can make it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [local, resp] = await Promise.all([
          loadGistData(),
          fetch('/api/gist').then(r => r.json()) as Promise<{ cloud?: boolean; data?: GistData }>,
        ]);
        if (cancelled) return;
        if (!resp?.cloud) { setOwed(null); return; }
        const diff = missingFromRemote(local, resp.data ?? {});
        setOwed(Object.keys(diff));
      } catch { if (!cancelled) setOwed(null); }
    })();
    return () => { cancelled = true; };
  }, [data]);
  const c = data ? countsOf(data) : null;

  const download = useCallback(() => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketpulse-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const restore = useCallback(async (file: File) => {
    setMsg(null);
    try {
      const parsed = JSON.parse(await file.text()) as GistData;
      // A file that is valid JSON but not a backup would otherwise be written straight
      // into the store. Checking for at least one key this app owns is a weak test, but
      // it rejects the obvious mistakes without pretending to validate deeply.
      const known = ['notes', 'pins', 'strategyCustom', 'strategyLinks',
        'rotationStockLists', 'calendarEvents', 'analyses', 'sentiments'];
      if (typeof parsed !== 'object' || parsed === null || !known.some(k => k in parsed)) {
        setMsg({ kind: 'err', text: 'That file does not look like a MarketPulse backup.' });
        return;
      }
      // Goes through the normal patch path, so this ADDS to what is here rather than
      // replacing it: restoring a phone backup onto a desktop keeps the desktop's own
      // pins and strategy. Notes merge chart by chart.
      const after = await updateGistData(parsed);
      setData(after);
      const n = countsOf(after);
      setMsg({ kind: 'ok', text: `Restored. Now holding ${n.noteEntries} notes across ${n.stocks} stocks, ${n.pins} pins, ${n.calendar} calendar entries.` });
    } catch (e) {
      setMsg({ kind: 'err', text: `Could not read that file: ${(e as Error).message}` });
    }
  }, []);

  return (
    <DetailModal onClose={onClose}>
      <div className="relative rounded-xl border border-accent/40 bg-bg-card p-4 space-y-3 max-w-lg">
        <PanelClose onClose={onClose} />
        <h3 className="text-base font-bold text-white pr-7">Your saved data</h3>

        {status === 'local-only' ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 space-y-1">
            <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
              <CloudOff size={13} /> Saved on this device only
            </p>
            <p className="text-[11px] text-amber-200/70 leading-snug">
              Cloud storage is not configured, so nothing here is shared between devices.
              Your phone and this computer each keep their own copy and neither can see the
              other&apos;s. <span className="font-semibold">This is the only copy</span> — if this
              browser&apos;s data is cleared, it is gone. Use Download below.
            </p>
          </div>
        ) : status === 'error' ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2.5 space-y-1">
            <p className="text-xs font-semibold text-red-300 flex items-center gap-1.5">
              <AlertTriangle size={13} /> The server refused to save
            </p>
            {lastWriteError() && (
              <p className="text-[11px] font-mono text-red-200/80 break-all">{lastWriteError()}</p>
            )}
            <p className="text-[11px] text-red-200/70 leading-snug">
              Reading works, writing does not, so every device sees the same frozen copy and
              this one keeps its changes to itself. A 401 or 403 from GitHub means the access
              token has expired or lacks gist write permission — GitHub tokens expire after
              30 days by default. Make a new one at github.com/settings/tokens with the
              <span className="font-mono"> gist </span>scope, set it as
              <span className="font-mono"> GITHUB_GIST_TOKEN </span>on Vercel, and redeploy.
              Nothing here is lost meanwhile — download a copy to be sure.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-gray-500 leading-snug">
              Synced to cloud storage, so every device sees the same thing. A downloaded copy
              is still worth having.
            </p>
            {owed !== null && (
              owed.length > 0 ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 space-y-1">
                  <p className="text-xs font-semibold text-amber-300">
                    This device holds {owed.length} thing{owed.length > 1 ? 's' : ''} the server does not
                  </p>
                  <p className="text-[11px] text-amber-200/70 leading-snug">
                    <span className="font-mono">{owed.join(', ')}</span> — present here, absent from
                    cloud storage, so no other device can see {owed.length > 1 ? 'them' : 'it'} yet.
                    This uploads by itself on load; reopening the app is enough. Download a copy
                    first if you would rather not rely on that.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-emerald-300/80 leading-snug">
                  Everything on this device has reached the server.
                </p>
              )
            )}
          </>
        )}

        {/* The last automatic upload, verbatim. This is the record that did not exist:
            whether this device ever SENT what it holds, how much, and what came back. */}
        {lastUpload() && (() => { const u = lastUpload()!; return (
          <div className={`rounded-lg border px-3 py-2 space-y-0.5 ${
            u.ok === true ? 'border-emerald-500/30 bg-emerald-500/5'
            : u.ok === false ? 'border-red-500/40 bg-red-500/5' : 'border-border bg-bg-input'}`}>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Last upload from this device</p>
            <p className="text-[11px] text-gray-300 font-mono break-all">
              {u.at.slice(11, 19)}Z · sent {u.keys.join(', ') || 'nothing'} · {(u.bytes / 1024).toFixed(1)} KB
            </p>
            <p className={`text-[11px] font-mono ${u.ok === true ? 'text-emerald-300' : u.ok === false ? 'text-red-300' : 'text-gray-500'}`}>
              {u.ok === null ? 'waiting for the server…'
                : u.ok ? `accepted (HTTP ${u.status})`
                : `REFUSED — HTTP ${u.status ?? '?'}: ${u.error ?? 'no reason given'}`}
            </p>
          </div>
        ); })()}

        {c && (
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <Row label="Note entries" v={c.noteEntries} />
            <Row label="Stocks in watchlist" v={c.stocks} />
            <Row label="Rotation lists" v={c.rotationLists} />
            <Row label="Pinned" v={c.pins} />
            <Row label="Strategy items" v={c.strategy} />
            <Row label="Calendar entries" v={c.calendar} />
            <Row label="Saved analyses" v={c.analyses} />
            <Row label="Sentiment readings" v={c.sentiments} />
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={download} disabled={!data}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border
                       bg-bg-input px-3 py-2 text-xs font-semibold text-gray-200
                       hover:border-accent/50 transition-colors disabled:opacity-40">
            <Download size={13} /> Download a copy
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border
                       bg-bg-input px-3 py-2 text-xs font-semibold text-gray-200
                       hover:border-accent/50 transition-colors">
            <Upload size={13} /> Restore from a file
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
        </div>

        {msg && (
          <p className={`text-[11px] leading-snug flex items-start gap-1.5 ${
            msg.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
            {msg.kind === 'ok' ? <Check size={12} className="mt-0.5 shrink-0" />
                               : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
            {msg.text}
          </p>
        )}

        <p className="text-[10px] text-gray-600 leading-snug">
          Restoring ADDS to what is already here; it does not wipe this device. Notes merge
          chart by chart, so the same chart&apos;s list is taken from the file.
        </p>
      </div>
    </DetailModal>
  );
}

function Row({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded bg-bg-input px-2 py-1">
      <span className="text-gray-500 truncate">{label}</span>
      <span className={`font-bold tabular-nums ${v > 0 ? 'text-white' : 'text-gray-600'}`}>{v}</span>
    </div>
  );
}
