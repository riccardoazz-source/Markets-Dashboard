'use client';

import { X } from 'lucide-react';

// The ✕ belongs in the corner of the panel, full stop.
//
// It used to be the last item in the same flex row as Compare / Returns / Quadrant
// / AI. On a wide screen that put it in the corner by coincidence; on a phone the
// row wrapped and the ✕ ended up on a line of its own, in a different place on
// every panel depending on how many buttons that panel had. Taking it out of the
// flow and pinning it to the corner makes the position a property of the panel
// rather than an accident of the button count.
//
// The panel it sits in must be `relative`; the button rows next to it carry `pr-7`
// so nothing runs underneath.
export function PanelClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close"
      // Big enough to hit with a thumb, without a big visible box.
      className="absolute top-2 right-2 z-10 p-1.5 -m-1 text-gray-500 hover:text-gray-200 transition-colors"
      data-print-hide
    >
      <X size={16} />
    </button>
  );
}
