'use client';

import { useEffect } from 'react';

const AUTO_DISMISS_MS = 6000;

/**
 * Bottom-of-screen banner shown once, right after a successful delete —
 * `AppShell` owns the timer that clears it. Undo replays the exact same
 * restore call `TrashPanel` uses; this is just a faster path to it for the
 * delete you just made, not a separate mechanism.
 */
export default function Toast({
  title,
  busy,
  error,
  onUndo,
  onDismiss,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (busy || error) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [busy, error, onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-xl"
    >
      <p className="text-xs text-neutral-300">
        {error ? <span className="text-red-400">{error}</span> : (
          <>Deleted <span className="font-mono text-neutral-100">{title}</span></>
        )}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onUndo}
        className="rounded border border-line px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-white/5 disabled:opacity-50"
      >
        {busy ? 'Undoing…' : 'Undo'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded p-0.5 text-sm leading-none text-neutral-500 hover:bg-white/5 hover:text-neutral-300 disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}
