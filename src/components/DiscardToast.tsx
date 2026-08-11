'use client';

import { useEffect } from 'react';

const DISCARD_UNDO_MS = 10_000;

/**
 * A reflexive-click safety net for "Load theirs" in `ConflictDialog` — not
 * `Toast.tsx`, which is wired to the async delete/restore flow (`busy`,
 * `error`, a commit `sha`). This one is synchronous and purely client-side:
 * the discarded text is already sitting in sessionStorage by the time this
 * renders, so Undo is just handing it back, no request involved.
 */
export default function DiscardToast({ onUndo, onDismiss }: { onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DISCARD_UNDO_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-xl"
    >
      <p className="text-xs text-neutral-300">Discarded your changes</p>
      <button
        type="button"
        onClick={onUndo}
        className="rounded border border-line px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-white/5"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded p-0.5 text-sm leading-none text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
      >
        ×
      </button>
    </div>
  );
}
