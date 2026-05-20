'use client';

import { useState } from 'react';
import { useGistData, NoteEntry, todayStr, makeId } from '@/lib/gist';
import { StickyNote, Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  chartId: string;
}

export function ChartNotes({ chartId }: Props) {
  const { data, update } = useGistData();
  const [open, setOpen] = useState(false);
  const [newText, setNewText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const notes: NoteEntry[] = data.notes?.[chartId] ?? [];

  const saveNote = async () => {
    const text = newText.trim();
    if (!text) return;
    const entry: NoteEntry = { id: makeId(), text, date: todayStr() };
    const updated = [...notes, entry];
    await update({ notes: { [chartId]: updated } });
    setNewText('');
  };

  const deleteNote = async (id: string) => {
    const updated = notes.filter(n => n.id !== id);
    await update({ notes: { [chartId]: updated } });
  };

  const startEdit = (n: NoteEntry) => {
    setEditId(n.id);
    setEditText(n.text);
  };

  const commitEdit = async () => {
    const text = editText.trim();
    if (!text || !editId) { setEditId(null); return; }
    const updated = notes.map(n =>
      n.id === editId ? { ...n, text, date: todayStr() } : n,
    );
    await update({ notes: { [chartId]: updated } });
    setEditId(null);
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-input text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <StickyNote size={13} />
          Notes
          {notes.length > 0 && (
            <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
              {notes.length}
            </span>
          )}
        </span>
        <span className="text-[10px] text-gray-600">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="px-3 py-3 space-y-2 bg-bg-card">
          {notes.length === 0 && !newText && (
            <p className="text-[11px] text-gray-600 italic">No notes yet. Add one below.</p>
          )}

          {notes.map(note => (
            <div key={note.id} className="bg-bg-input rounded-lg px-3 py-2 group">
              {editId === note.id ? (
                <div className="flex gap-2 items-start">
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                    className="flex-1 bg-bg border border-accent rounded px-2 py-1 text-xs text-gray-100 focus:outline-none resize-none min-h-[56px]"
                    autoFocus
                  />
                  <div className="flex flex-col gap-1">
                    <button onClick={commitEdit} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
                    <button onClick={() => setEditId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap break-words">{note.text}</p>
                    <p className="text-[10px] text-gray-600 mt-1">{note.date}</p>
                  </div>
                  <div className={clsx('flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity')}>
                    <button onClick={() => startEdit(note)} className="p-1 text-gray-500 hover:text-gray-300"><Edit2 size={11} /></button>
                    <button onClick={() => deleteNote(note.id)} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={11} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* New note input */}
          <div className="flex gap-2 items-end">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); }}
              placeholder="Add a note… (⌘↵ to save)"
              className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-accent resize-none min-h-[48px] transition-colors"
            />
            <button
              onClick={saveNote}
              disabled={!newText.trim()}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-40 hover:bg-accent/80 transition shrink-0"
            >
              <Plus size={12} /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
