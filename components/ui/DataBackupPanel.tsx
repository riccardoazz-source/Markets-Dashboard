'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, Download, Upload, AlertTriangle, Check } from 'lucide-react';
import {
  loadGistData, updateGistData, useSyncStatus, type GistData,
} from '@/lib/gist';
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
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadGistData().then(setData).catch(() => setData({})); }, []);
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
              <AlertTriangle size={13} /> Cloud storage unreachable
            </p>
            <p className="text-[11px] text-red-200/70 leading-snug">
              Changes are kept here and will be retried. If this persists, the access token
              behind cloud storage may have expired — those expire on a schedule.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-gray-500 leading-snug">
            Synced to cloud storage, so every device sees the same thing. A downloaded copy
            is still worth having.
          </p>
        )}

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
