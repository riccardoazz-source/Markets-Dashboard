'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main">
      <div className="text-center space-y-4 max-w-md px-4">
        <p className="text-gray-300 text-base font-medium">Something went wrong loading the dashboard.</p>
        <p className="text-gray-500 text-sm">{error.message ?? 'Unexpected rendering error'}</p>
        <button
          onClick={reset}
          className="mt-2 px-4 py-2 text-sm rounded-lg border border-border text-gray-300 hover:text-gray-100 hover:border-border-light transition-all"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
