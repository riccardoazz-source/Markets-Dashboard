'use client';

import { useState } from 'react';
import { useGistData, NoteEntry, todayStr, makeId } from '@/lib/gist';
import { StickyNote, Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  chartId: string;
  defaultCategory?: string;
}

export function ChartNotes({ chartId, defaultCategory }: Props) {
  const { data, update } = useGistData();
  const [open, setOpen] = useState(false);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState(defaultCategory ?? '');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState('');

  const notes: NoteEntry[] = data.notes?.[chartId] ?? [];

  const saveNote = async () => {
    const text = newText.trim();
    if (!text) return;
    const entry: NoteEntry = { id: makeId(), text, date: todayStr(), category: newCategory.trim() || undefined };
    await update({ notes: { [chartId]: [...notes, entry] } });
    setNewText('');
    setNewCategory(defaultCategory ?? '');
  };

  const deleteNote = async (id: string) => {
    await update({ notes: { [chartId]: notes.filter(n => n.id !== id) } });
  };

  const startEdit = (n: NoteEntry) => {
    setEditId(n.id);
    setEditText(n.text);
    setEditCategory(n.category ?? '');
  };

  const commitEdit = async () => {
    const text = editText.trim();
    if (!text || !editId) { setEditId(null); return; }
    const updated = notes.map(n =>
      n.id === editId ? { ...n, text, date: todayStr(), category: editCategory.trim() || undefined } : n,
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
                <div className="space-y-1.5">
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                    className="w-full bg-bg border border-accent rounded px-2 py-1 text-xs text-gray-100 focus:outline-none resize-none min-h-[56px]"
                    autoFocus
                  />
                  <input
                    value={editCategory}
                    onChange={e => setEditCategory(e.target.value)}
                    placeholder="Category (optional)"
                    className="w-full bg-bg border border-border rounded px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-accent"
                  />
                  <div className="flex gap-1 justify-end">
                    <button onClick={commitEdit} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
                    <button onClick={() => setEditId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap break-words">{note.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-[10px] text-gray-600">{note.date}</p>
                      {note.category && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent/80">
                          {note.category}
                        </span>
                      )}
                    </div>
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
          <div className="space-y-1.5">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); }}
              placeholder="Add a note… (⌘↵ to save)"
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-accent resize-none min-h-[48px] transition-colors"
            />
            <div className="flex gap-2 items-center">
              <input
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                placeholder={defaultCategory ? `Category (default: ${defaultCategory})` : 'Category (optional)'}
                className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-accent"
              />
              <button
                onClick={saveNote}
                disabled={!newText.trim()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-40 hover:bg-accent/80 transition shrink-0"
              >
                <Plus size={12} /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
