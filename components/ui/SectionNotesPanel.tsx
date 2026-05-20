'use client';

import { useState, useMemo } from 'react';
import { BookOpen, X, Edit2, Trash2, Check } from 'lucide-react';
import clsx from 'clsx';
import { useGistData, NoteEntry, todayStr } from '@/lib/gist';
import { resolveNoteName, type NotesSection } from '@/lib/sectionNotes';

interface Props {
  section: NotesSection;
  sectionLabel: string;
}

interface FlatNote extends NoteEntry {
  chartId: string;
  assetName: string;
}

export function SectionNotesPanel({ section, sectionLabel }: Props) {
  const { data, update } = useGistData();
  const [open, setOpen] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const allNotes = data.notes ?? {};

  // Gather every note whose chartId belongs to this section
  const flatNotes: FlatNote[] = useMemo(() => {
    const out: FlatNote[] = [];
    for (const [chartId, notes] of Object.entries(allNotes)) {
      const assetName = resolveNoteName(section, chartId);
      if (!assetName) continue;
      for (const n of notes) out.push({ ...n, chartId, assetName });
    }
    // Newest first; tie-break by asset name for stable grouping
    return out.sort((a, b) =>
      b.date.localeCompare(a.date) || a.assetName.localeCompare(b.assetName));
  }, [allNotes, section]);

  const total = flatNotes.length;

  const deleteNote = async (chartId: string, id: string) => {
    const updated = (allNotes[chartId] ?? []).filter(n => n.id !== id);
    await update({ notes: { [chartId]: updated } });
  };

  const startEdit = (n: FlatNote) => {
    setEditKey(`${n.chartId}:${n.id}`);
    setEditText(n.text);
  };

  const commitEdit = async (chartId: string, id: string) => {
    const text = editText.trim();
    if (!text) { setEditKey(null); return; }
    const updated = (allNotes[chartId] ?? []).map(n =>
      n.id === id ? { ...n, text, date: todayStr() } : n);
    await update({ notes: { [chartId]: updated } });
    setEditKey(null);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`View all notes in ${sectionLabel}`}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-bg-card text-gray-400 hover:text-gray-100 hover:border-accent/50 transition-colors shrink-0"
      >
        <BookOpen size={16} />
        <span className="text-xs font-medium hidden sm:inline">Notes</span>
        {total > 0 && (
          <span className="bg-accent text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
            {total}
          </span>
        )}
      </button>

      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/50 z-[90] transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setOpen(false)}
      />

      {/* Slide-out drawer */}
      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full sm:w-[420px] bg-bg-card border-l border-border z-[100] flex flex-col shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-input shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-100">{sectionLabel} — Notes</h3>
            <span className="text-[10px] text-gray-500">({total})</span>
          </div>
          <button onClick={() => setOpen(false)} className="p-1 text-gray-500 hover:text-gray-200">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {flatNotes.length === 0 ? (
            <p className="text-xs text-gray-600 italic mt-2">
              No notes in this section yet. Open any asset and add notes below its chart.
            </p>
          ) : (
            flatNotes.map(note => {
              const key = `${note.chartId}:${note.id}`;
              const isEditing = editKey === key;
              return (
                <div key={key} className="bg-bg-input rounded-lg px-3 py-2.5 group">
                  {isEditing ? (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-accent">{note.assetName}</p>
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit(note.chartId, note.id);
                          if (e.key === 'Escape') setEditKey(null);
                        }}
                        className="w-full bg-bg border border-accent rounded px-2 py-1 text-xs text-gray-100 focus:outline-none resize-none min-h-[64px]"
                        autoFocus
                      />
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => commitEdit(note.chartId, note.id)} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
                        <button onClick={() => setEditKey(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={14} /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-semibold text-accent truncate">{note.assetName}</span>
                        <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(note)} className="p-1 text-gray-500 hover:text-gray-300"><Edit2 size={11} /></button>
                          <button onClick={() => deleteNote(note.chartId, note.id)} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={11} /></button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap break-words">{note.text}</p>
                      <p className="text-[10px] text-gray-600 mt-1.5">{note.date}</p>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
