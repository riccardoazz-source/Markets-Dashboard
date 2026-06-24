'use client';

import { useEffect, useState } from 'react';

export function ScrollNav() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 200);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-4 z-50 flex flex-col gap-2">
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-card border border-border text-gray-400 hover:text-gray-100 hover:border-gray-500 shadow-lg transition-all text-base"
        title="Vai in cima"
        aria-label="Scroll to top"
      >
        ↑
      </button>
      <button
        onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-card border border-border text-gray-400 hover:text-gray-100 hover:border-gray-500 shadow-lg transition-all text-base"
        title="Vai in fondo"
        aria-label="Scroll to bottom"
      >
        ↓
      </button>
    </div>
  );
}
