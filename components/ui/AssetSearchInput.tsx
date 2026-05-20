'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { ALL_COMPARABLE_ASSETS } from '@/lib/config';

interface RemoteHit { symbol: string; name: string; exchange?: string }

interface Props {
  value: string;
  displayName?: string;
  onChange: (symbol: string, name: string) => void;
  placeholder?: string;
  clearable?: boolean;
}

export function AssetSearchInput({
  value,
  displayName,
  onChange,
  placeholder = 'Search asset…',
  clearable = true,
}: Props) {
  const [query, setQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState<RemoteHit[]>([]);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preset = ALL_COMPARABLE_ASSETS.find(a => a.symbol === value);
  const selectedName = displayName || preset?.name || value;

  const localHits = query.length > 0
    ? ALL_COMPARABLE_ASSETS
        .filter(a =>
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.symbol.toLowerCase().includes(query.toLowerCase())
        )
        .map(a => ({ symbol: a.symbol, name: a.name, group: (a as { group?: string }).group }))
        .slice(0, 10)
    : [];

  const localSymbols = new Set(ALL_COMPARABLE_ASSETS.map(a => a.symbol));
  const extraRemoteHits = remoteHits
    .filter(h => !localSymbols.has(h.symbol))
    .slice(0, 8);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 1) { setRemoteHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stock?mode=search&q=${encodeURIComponent(query)}`);
        const json = await res.json() as RemoteHit[];
        setRemoteHits(Array.isArray(json) ? json : []);
      } catch { setRemoteHits([]); }
      finally { setSearching(false); }
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setQuery('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (symbol: string, name: string) => {
    onChange(symbol, name);
    setQuery('');
    setRemoteHits([]);
  };

  const isOpen = query.length > 0 && (localHits.length > 0 || extraRemoteHits.length > 0);

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg border border-border rounded-md text-xs min-h-[30px]">
          <span className="text-gray-100 truncate flex-1">{selectedName}</span>
          <span className="text-gray-600 font-mono text-[10px] shrink-0">{value}</span>
          {clearable && (
            <button
              type="button"
              onClick={() => onChange('', '')}
              className="ml-0.5 text-gray-600 hover:text-gray-300 shrink-0"
            >
              <X size={10} />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg border border-border rounded-md text-xs min-h-[30px]">
          <Search size={11} className="text-gray-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="bg-transparent outline-none text-gray-200 flex-1 min-w-0 w-36"
          />
          {searching && <span className="text-[10px] text-gray-500 animate-pulse shrink-0">…</span>}
        </div>
      )}

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-bg-card border border-border rounded-lg shadow-xl z-30 max-h-64 overflow-y-auto">
          {localHits.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Preset</p>
              {localHits.map(a => (
                <button
                  key={a.symbol}
                  type="button"
                  onClick={() => select(a.symbol, a.name)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-bg-hover text-left"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-gray-100 truncate block">{a.name}</span>
                    {a.group && <span className="text-gray-600 text-[10px]">{a.group}</span>}
                  </div>
                  <span className="text-gray-500 ml-2 shrink-0 font-mono text-[10px]">{a.symbol}</span>
                </button>
              ))}
            </>
          )}
          {extraRemoteHits.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[10px] text-gray-600 uppercase tracking-wider font-semibold border-t border-border mt-1">
                Yahoo Finance
              </p>
              {extraRemoteHits.map(h => (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => select(h.symbol, h.name)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-bg-hover text-left"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-gray-100 truncate block">{h.name}</span>
                    {h.exchange && <span className="text-gray-500 text-[10px]">{h.exchange}</span>}
                  </div>
                  <span className="text-gray-400 ml-2 shrink-0 font-mono text-[10px]">{h.symbol}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
