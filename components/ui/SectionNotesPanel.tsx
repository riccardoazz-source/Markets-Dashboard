'use client';

import { useState, useMemo } from 'react';
import { BookOpen, X, Edit2, Trash2, Check, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useGistData, useSyncStatus, NoteEntry, todayStr } from '@/lib/gist';
import { resolveNoteName, type NotesSection } from '@/lib/sectionNotes';
import { SyncBadge } from '@/components/ui/SyncBadge';

interface Props {
  section: NotesSection;
  sectionLabel: string;
  onNavigate?: (section: NotesSection, chartId: string) => void;
}

interface FlatNote extends NoteEntry {
  chartId: string;
  assetName: string;
}

export function SectionNotesPanel({ section, sectionLabel, onNavigate }: Props) {
  const { data, update } = useGistData();
  const syncStatus = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const allNotes = data.notes ?? {};

  const flatNotes: FlatNote[] = useMemo(() => {
    const out: FlatNote[] = [];
    for (const [chartId, notes] of Object.entries(allNotes)) {
      const assetName = resolveNoteName(section, chartId);
      if (!assetName) continue;
      for (const n of notes) out.push({ ...n, chartId, assetName });
    }
    return out.sort((a, b) =>
      b.date.localeCompare(a.date) || a.assetName.localeCompare(b.assetName));
  }, [allNotes, section]);

  const total = flatNotes.length;

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const n of flatNotes) cats.add(n.category ?? '');
    return Array.from(cats).sort((a, b) => {
      if (!a) return 1; // empty/uncategorized goes last
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [flatNotes]);

  const filteredNotes = filterCat === null
    ? flatNotes
    : flatNotes.filter(n => (n.category ?? '') === filterCat);

  const grouped = useMemo(() => {
    const map = new Map<string, FlatNote[]>();
    for (const n of filteredNotes) {
      const cat = n.category ?? '';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(n);
    }
    return map;
  }, [filteredNotes]);

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
    const note = (allNotes[chartId] ?? []).find(n => n.id === id);
    if (!text && !note?.category) {
      // Both text and category empty → delete the note
      const updated = (allNotes[chartId] ?? []).filter(n => n.id !== id);
      await update({ notes: { [chartId]: updated } });
      setEditKey(null);
      return;
    }
    const updated = (allNotes[chartId] ?? []).map(n =>
      n.id === id ? { ...n, text, date: todayStr() } : n);
    await update({ notes: { [chartId]: updated } });
    setEditKey(null);
  };

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleNavigate = (n: FlatNote) => {
    if (!onNavigate) return;
    onNavigate(section, n.chartId);
    setOpen(false);
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
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={16} className="text-accent shrink-0" />
            <h3 className="text-sm font-semibold text-gray-100 truncate">{sectionLabel} — Notes</h3>
            <span className="text-[10px] text-gray-500 shrink-0">({total})</span>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <SyncBadge />
            <button onClick={() => setOpen(false)} className="p-1 text-gray-500 hover:text-gray-200">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Category filter chips */}
        {allCategories.length > 1 && (
          <div className="px-4 py-2 border-b border-border bg-bg-input/50 flex flex-wrap gap-1.5 shrink-0">
            <button
              onClick={() => setFilterCat(null)}
              className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors border',
                filterCat === null
                  ? 'bg-accent text-white border-accent'
                  : 'border-border text-gray-500 hover:text-gray-300')}
            >
              All
            </button>
            {allCategories.map(cat => (
              <button
                key={cat || '__none__'}
                onClick={() => setFilterCat(prev => prev === cat ? null : cat)}
                className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors border',
                  filterCat === cat
                    ? 'bg-accent text-white border-accent'
                    : 'border-border text-gray-500 hover:text-gray-300')}
              >
                {cat || 'Uncategorized'}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {syncStatus === 'local-only' && (
            <div className="bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 text-[11px] text-amber-300/90">
              <p className="font-semibold mb-0.5">Notes are stored only on this device</p>
              <p className="text-amber-300/70">
                They won&apos;t appear if you switch device or browser. To sync everywhere,
                set <code className="text-amber-200">GITHUB_GIST_ID</code> and{' '}
                <code className="text-amber-200">GITHUB_GIST_TOKEN</code> in your Vercel
                project settings.
              </p>
            </div>
          )}
          {syncStatus === 'error' && (
            <div className="bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2 text-[11px] text-red-300/90">
              Couldn&apos;t reach cloud storage. Notes are saved on this device and will
              sync automatically once the connection is restored.
            </div>
          )}
          {filteredNotes.length === 0 ? (
            <p className="text-xs text-gray-600 italic mt-2">
              {total === 0
                ? 'No notes in this section yet. Open any asset and add notes below its chart.'
                : 'No notes match the selected filter.'}
            </p>
          ) : (
            Array.from(grouped.entries()).map(([cat, notes]) => {
              const isCollapsed = collapsedCats.has(cat);
              const catLabel = cat || 'Uncategorized';
              const hasMultiCats = grouped.size > 1;
              return (
                <div key={cat || '__none__'}>
                  {hasMultiCats && (
                    <button
                      onClick={() => toggleCat(cat)}
                      className="flex items-center gap-1.5 w-full text-left mb-1.5 group/cat"
                    >
                      {isCollapsed
                        ? <ChevronRight size={12} className="text-gray-500 shrink-0" />
                        : <ChevronDown size={12} className="text-gray-500 shrink-0" />}
                      <span className={clsx('text-[10px] font-bold uppercase tracking-wider',
                        cat ? 'text-accent/80' : 'text-gray-500')}>
                        {catLabel}
                      </span>
                      <span className="text-[10px] text-gray-600">({notes.length})</span>
                    </button>
                  )}

                  {!isCollapsed && (
                    <div className={clsx('space-y-2', hasMultiCats && 'pl-4')}>
                      {notes.map(note => {
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
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => commitEdit(note.chartId, note.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-semibold transition">
                                    <Check size={13} /> Save
                                  </button>
                                  <button onClick={() => setEditKey(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-border text-gray-400 hover:text-gray-200 text-xs font-semibold transition">
                                    <X size={13} /> Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <button
                                    onClick={() => handleNavigate(note)}
                                    className={clsx(
                                      'text-[11px] font-semibold text-accent truncate text-left transition-colors',
                                      onNavigate
                                        ? 'hover:text-accent/70 hover:underline underline-offset-2 cursor-pointer'
                                        : 'cursor-default pointer-events-none',
                                    )}
                                  >
                                    {note.assetName}
                                  </button>
                                  <div className="flex gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => startEdit(note)} className="p-2 sm:p-1 text-gray-500 hover:text-gray-300"><Edit2 size={12} /></button>
                                    <button onClick={() => deleteNote(note.chartId, note.id)} className="p-2 sm:p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                                  </div>
                                </div>
                                {note.text && <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap break-words">{note.text}</p>}
                                <div className="flex items-center gap-2 mt-1.5">
                                  <p className="text-[10px] text-gray-600">{note.date}</p>
                                  {note.category && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent/80">
                                      {note.category}
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
