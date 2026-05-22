'use client';

import { useState, useMemo } from 'react';
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

  // Every distinct category already used across all charts — offered as
  // one-click chips so a category can be reused instead of retyped.
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(data.notes ?? {})) {
      for (const n of list) {
        const c = n.category?.trim();
        if (c) set.add(c);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.notes]);

  const saveNote = async () => {
    const text = newText.trim();
    const category = newCategory.trim();
    // A note needs either some text or a category — at least one.
    if (!text && !category) return;
    const entry: NoteEntry = { id: makeId(), text, date: todayStr(), category: category || undefined };
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
    if (!editId) { setEditId(null); return; }
    const text = editText.trim();
    const category = editCategory.trim();
    // If both fields are cleared, delete the note entirely.
    if (!text && !category) {
      await update({ notes: { [chartId]: notes.filter(n => n.id !== editId) } });
      setEditId(null);
      return;
    }
    const updated = notes.map(n =>
      n.id === editId ? { ...n, text, date: todayStr(), category: category || undefined } : n,
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
          {notes.length === 0 && !newText && !newCategory && (
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
                    placeholder="Note text (optional)…"
                    className="w-full bg-bg border border-accent rounded px-2 py-1 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none resize-none min-h-[56px]"
                    autoFocus
                  />
                  <CategoryChips categories={allCategories} value={editCategory} onPick={setEditCategory} />
                  <input
                    value={editCategory}
                    onChange={e => setEditCategory(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                    placeholder="Category (optional)"
                    className="w-full bg-bg border border-border rounded px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-accent"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={commitEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-semibold transition">
                      <Check size={13} /> Save
                    </button>
                    <button onClick={() => setEditId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-border text-gray-400 hover:text-gray-200 text-xs font-semibold transition">
                      <X size={13} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {note.text && (
                      <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap break-words">{note.text}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-[10px] text-gray-600">{note.date}</p>
                      {note.category && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent/80">
                          {note.category}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(note)} className="p-2 sm:p-1 text-gray-500 hover:text-gray-300"><Edit2 size={12} /></button>
                    <button onClick={() => deleteNote(note.id)} className="p-2 sm:p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* New note input — text is optional; a category on its own is enough */}
          <div className="space-y-1.5">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); }}
              placeholder="Note text (optional) — ⌘↵ to save"
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-accent resize-none min-h-[48px] transition-colors"
            />
            <CategoryChips categories={allCategories} value={newCategory} onPick={setNewCategory} />
            <div className="flex gap-2 items-center">
              <input
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
                placeholder={defaultCategory ? `Category (default: ${defaultCategory})` : 'Type or pick a category'}
                className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-accent"
              />
              <button
                onClick={saveNote}
                disabled={!newText.trim() && !newCategory.trim()}
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

/** Existing categories as one-click chips — click to fill, click again to clear. */
function CategoryChips({
  categories, value, onPick,
}: {
  categories: string[];
  value: string;
  onPick: (c: string) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="text-[9px] text-gray-600 uppercase tracking-wider mr-0.5">Categories</span>
      {categories.map(cat => {
        const active = value.trim().toLowerCase() === cat.toLowerCase();
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onPick(active ? '' : cat)}
            className={clsx(
              'px-2 py-0.5 text-[10px] font-medium rounded-full border transition-colors',
              active
                ? 'border-accent text-accent bg-accent/10'
                : 'border-border text-gray-500 hover:text-gray-300 hover:border-border-light',
            )}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
