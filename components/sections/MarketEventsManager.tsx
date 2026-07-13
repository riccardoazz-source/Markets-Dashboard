'use client';

import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, CalendarDays } from 'lucide-react';
import { MARKET_EVENTS, MARKET_EVENT_COLORS, MarketEventCategory } from '@/lib/config';
import {
  type SourcesConfig, type CustomMarketEvent, generateId,
} from '@/lib/userSources';
import clsx from 'clsx';

const CATEGORY_LABELS: Record<MarketEventCategory, string> = {
  financial:    'Financial Crisis',
  war:          'War / Conflict',
  terrorism:    'Terrorism',
  pandemic:     'Pandemic',
  geopolitical: 'Geopolitical',
  elections:    'US Elections',
  crypto:       'Crypto',
  ipo:          'Major IPOs',
  personal:     'Personal',
};

const CATEGORY_ORDER: MarketEventCategory[] = [
  'personal', 'financial', 'war', 'terrorism', 'pandemic', 'geopolitical', 'elections', 'crypto', 'ipo',
];

const BLANK_EVENT = { date: '', label: '', description: '' };

interface Props {
  config: SourcesConfig;
  persist: (next: SourcesConfig) => void;
  mounted: boolean;
}

export function MarketEventsManager({ config, persist, mounted }: Props) {
  const [openCats, setOpenCats] = useState<Set<MarketEventCategory>>(new Set());
  const [addingCat, setAddingCat] = useState<MarketEventCategory | null>(null);
  const [draft, setDraft] = useState(BLANK_EVENT);

  const customEvents = mounted ? (config.customEvents ?? []) : [];

  const toggleCat = (cat: MarketEventCategory) => setOpenCats(prev => {
    const next = new Set(prev);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    return next;
  });

  const startAdd = (cat: MarketEventCategory) => {
    setAddingCat(cat);
    setDraft(BLANK_EVENT);
    setOpenCats(prev => new Set(prev).add(cat));
  };

  const commitAdd = (cat: MarketEventCategory) => {
    const date = draft.date.trim();
    const label = draft.label.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) return;
    const entry: CustomMarketEvent = {
      id: generateId(),
      date,
      label,
      description: draft.description.trim() || label,
      category: cat,
    };
    persist({ ...config, customEvents: [...customEvents, entry] });
    setDraft(BLANK_EVENT);
    setAddingCat(null);
  };

  const deleteEvent = (id: string) => {
    persist({ ...config, customEvents: customEvents.filter(e => e.id !== id) });
  };

  const totalCustom = customEvents.length;

  return (
    <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
      <div className="px-4 py-3 bg-bg-input border-b border-border flex items-center gap-2 flex-wrap">
        <CalendarDays size={14} className="text-accent shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-100">Market Events</h3>
            <span className="text-[10px] text-gray-500 bg-bg px-2 py-0.5 rounded-full border border-border">
              {MARKET_EVENTS.length} built-in{totalCustom > 0 ? ` + ${totalCustom} custom` : ''}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Curated events shown as vertical lines on the &quot;Events&quot; macro chart and in Compare.
            Add your own per category — they appear instantly. Built-in events are read-only.
          </p>
        </div>
      </div>

      {CATEGORY_ORDER.map(cat => {
        const builtins = MARKET_EVENTS.filter(e => e.category === cat);
        const customs = customEvents.filter(e => e.category === cat);
        const count = builtins.length + customs.length;
        const isOpen = openCats.has(cat);
        return (
          <div key={cat}>
            <div className="w-full flex items-center gap-2 px-4 py-2 bg-bg-input/50 border-t border-border">
              <button onClick={() => toggleCat(cat)} className="flex items-center gap-2 flex-1 text-left hover:opacity-80 transition">
                {isOpen
                  ? <ChevronDown size={12} className="text-gray-500 shrink-0" />
                  : <ChevronRight size={12} className="text-gray-500 shrink-0" />}
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: MARKET_EVENT_COLORS[cat] }}
                />
                <span className="text-xs font-semibold text-gray-300">{CATEGORY_LABELS[cat]}</span>
                <span className="text-[10px] text-gray-500 bg-bg px-1.5 py-0.5 rounded-full border border-border ml-1">
                  {count}
                </span>
                {customs.length > 0 && (
                  <span className="text-[10px] text-accent ml-1">{customs.length} custom</span>
                )}
              </button>
              <button
                onClick={() => startAdd(cat)}
                className="px-2 py-1 text-[11px] font-semibold rounded-md bg-accent/90 text-white hover:bg-accent transition flex items-center gap-1 shrink-0"
              >
                <Plus size={11} /> Add
              </button>
            </div>

            {isOpen && (
              <div className="overflow-x-auto">
                {/* Add form */}
                {addingCat === cat && (
                  <div className="px-4 py-2.5 border-t border-border bg-bg-input/30 flex flex-wrap gap-2 items-end">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Date</label>
                      <input
                        type="date"
                        value={draft.date}
                        onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
                        className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Label</label>
                      <input
                        value={draft.label}
                        onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                        placeholder="e.g. Iran War Begins"
                        className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-44 focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Description</label>
                      <input
                        value={draft.description}
                        onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') commitAdd(cat); if (e.key === 'Escape') setAddingCat(null); }}
                        placeholder="What happened (optional)"
                        className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-gray-100 w-full focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => commitAdd(cat)}
                        disabled={!/^\d{4}-\d{2}-\d{2}$/.test(draft.date.trim()) || !draft.label.trim()}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white disabled:opacity-40 transition"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setAddingCat(null); setDraft(BLANK_EVENT); }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-gray-400 hover:text-gray-200 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <table className="w-full text-xs">
                  <thead className="bg-bg-input text-gray-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="text-left px-4 py-1.5 font-semibold w-28">Date</th>
                      <th className="text-left px-4 py-1.5 font-semibold">Event</th>
                      <th className="text-left px-4 py-1.5 font-semibold">Description</th>
                      <th className="text-left px-4 py-1.5 font-semibold w-20">Source</th>
                      <th className="text-left px-4 py-1.5 font-semibold w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Custom events first (editable) */}
                    {customs.map(e => (
                      <tr key={e.id} className="border-t border-border hover:bg-bg-hover/20">
                        <td className="px-4 py-1.5 font-mono text-gray-300 whitespace-nowrap">{e.date}</td>
                        <td className="px-4 py-1.5 text-gray-100 font-medium">{e.label}</td>
                        <td className="px-4 py-1.5 text-gray-500">{e.description}</td>
                        <td className="px-4 py-1.5">
                          <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded text-[10px]">custom</span>
                        </td>
                        <td className="px-4 py-1.5">
                          <button onClick={() => deleteEvent(e.id)} title="Delete event"
                            className="p-1 text-gray-600 hover:text-red-400 transition"><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                    {/* Built-in events (read-only) */}
                    {builtins.map((e, i) => (
                      <tr key={`builtin-${i}`} className="border-t border-border hover:bg-bg-hover/20">
                        <td className="px-4 py-1.5 font-mono text-gray-400 whitespace-nowrap">
                          {e.date}{e.endDate && <span className="text-gray-600"> → {e.endDate}</span>}
                        </td>
                        <td className="px-4 py-1.5 text-gray-200">{e.label}</td>
                        <td className="px-4 py-1.5 text-gray-500">{e.description}</td>
                        <td className="px-4 py-1.5">
                          <span className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-[10px]">built-in</span>
                        </td>
                        <td className="px-4 py-1.5"></td>
                      </tr>
                    ))}
                    {count === 0 && (
                      <tr><td colSpan={5} className="px-4 py-3 text-gray-600 italic text-[11px]">No events in this group yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <div className="px-4 py-2 border-t border-border text-[10px] text-gray-600">
        Custom events are stored locally and encoded in the shareable URL (Copy link).
        Date format: YYYY-MM-DD. They merge with the built-in list on the Events chart.
      </div>
    </div>
  );
}
