'use client';

// Inline page-jump buttons.
//   <ScrollButton to="bottom" />  → down arrow, placed at the TOP of the page
//   <ScrollButton to="top" />     → up arrow,   placed at the BOTTOM of the page
// Single-click smooth scroll to the far end of the page. Inline (not floating),
// so each sits at the end it sends you away from.
export function ScrollButton({ to }: { to: 'top' | 'bottom' }) {
  const onClick = () =>
    window.scrollTo({
      top: to === 'top' ? 0 : document.body.scrollHeight,
      behavior: 'smooth',
    });

  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded-full bg-bg-input border border-border text-gray-400 hover:text-gray-100 hover:border-gray-500 transition-all text-base shrink-0"
      title={to === 'top' ? 'Vai a inizio pagina' : 'Vai in fondo alla pagina'}
      aria-label={to === 'top' ? 'Scroll to top' : 'Scroll to bottom'}
    >
      {to === 'top' ? '↑' : '↓'}
    </button>
  );
}
