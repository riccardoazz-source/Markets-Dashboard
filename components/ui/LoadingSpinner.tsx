'use client';

export function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin text-accent"
      style={{ color: '#6366f1' }}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 animate-pulse">
      <div className="h-3 w-1/3 rounded bg-border mb-3" />
      <div className="h-6 w-2/3 rounded bg-border mb-2" />
      <div className="h-4 w-1/2 rounded bg-border" />
    </div>
  );
}

export function LoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
