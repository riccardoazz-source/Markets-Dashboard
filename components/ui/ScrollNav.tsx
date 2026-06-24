'use client';

// Fixed page-jump controls, parked against the right edge (next to the
// scrollbar) and vertically centred — so they stay reachable from ANY scroll
// position. Up = jump to the top, Down = jump to the bottom.
export function ScrollNav() {
  const jump = (to: 'top' | 'bottom') =>
    window.scrollTo({
      top: to === 'top' ? 0 : document.body.scrollHeight,
      behavior: 'smooth',
    });

  return (
    <div className="fixed right-1.5 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-1.5">
      <button
        onClick={() => jump('top')}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-bg-card/90 border border-border text-gray-400 hover:text-gray-100 hover:border-gray-500 shadow-lg backdrop-blur transition-all text-base"
        title="Vai a inizio pagina"
        aria-label="Scroll to top"
      >
        ↑
      </button>
      <button
        onClick={() => jump('bottom')}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-bg-card/90 border border-border text-gray-400 hover:text-gray-100 hover:border-gray-500 shadow-lg backdrop-blur transition-all text-base"
        title="Vai in fondo alla pagina"
        aria-label="Scroll to bottom"
      >
        ↓
      </button>
    </div>
  );
}
