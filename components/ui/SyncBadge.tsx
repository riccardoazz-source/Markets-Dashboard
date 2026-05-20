'use client';

import { Cloud, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useSyncStatus } from '@/lib/gist';

const MAP = {
  idle:         { Icon: Cloud,         text: 'Cloud',      cls: 'text-gray-500',    spin: false },
  syncing:      { Icon: RefreshCw,     text: 'Syncing…',   cls: 'text-gray-400',    spin: true  },
  synced:       { Icon: Cloud,         text: 'Synced',     cls: 'text-emerald-400', spin: false },
  error:        { Icon: AlertTriangle, text: 'Sync error', cls: 'text-red-400',     spin: false },
  'local-only': { Icon: CloudOff,      text: 'Local only', cls: 'text-amber-400',   spin: false },
} as const;

export function SyncBadge({ className }: { className?: string }) {
  const status = useSyncStatus();
  const { Icon, text, cls, spin } = MAP[status];

  const title =
    status === 'local-only'
      ? 'Notes are saved only on this device. Configure cloud storage to sync across devices.'
      : status === 'error'
      ? 'Could not reach cloud storage. Notes are kept on this device and will retry.'
      : status === 'synced'
      ? 'Notes are synced to the cloud and available on all your devices.'
      : 'Cloud sync';

  return (
    <span
      title={title}
      className={clsx('flex items-center gap-1 text-[10px] font-medium whitespace-nowrap', cls, className)}
    >
      <Icon size={11} className={spin ? 'animate-spin' : ''} />
      {text}
    </span>
  );
}
