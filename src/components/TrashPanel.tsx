'use client';

import { useEffect, useState } from 'react';

import { TrashIcon } from '@/components/icons';
import { dirName, baseName } from '@/lib/paths';

export type TrashEntry = { sha: string; short: string; path: string; title: string };

/**
 * Same centered-modal pattern as `MoveToDialog`/`DeleteConfirmDialog` — a
 * flat list rather than a new UI paradigm. Fetches its own listing on open
 * rather than `AppShell` holding it, since the list is only ever needed
 * while this is open and can go stale the moment it isn't.
 */
export default function TrashPanel({
  restoringSha,
  error,
  onRestore,
  onCancel,
}: {
  restoringSha: string | null;
  error: string | null;
  /** Resolves `true` on a successful restore — the row is only dropped from
   *  this panel's own list once the caller confirms it actually happened. */
  onRestore: (entry: TrashEntry) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleRestore = async (entry: TrashEntry) => {
    const ok = await onRestore(entry);
    if (ok) setEntries((prev) => prev?.filter((e) => e.sha !== entry.sha) ?? prev);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/note/trash')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load trash.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trash"
        className="w-full max-w-md rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <TrashIcon className="size-4 text-neutral-500" />
            <p className="text-sm font-semibold text-neutral-100">Trash</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-lg leading-none text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
          >
            ×
          </button>
        </div>

        {error && <p className="px-4 pb-2 text-xs text-red-400">{error}</p>}

        <ul className="max-h-80 overflow-y-auto border-t border-line py-1">
          {entries === null && !loadError && (
            <li className="px-4 py-3 text-xs text-neutral-500">Loading…</li>
          )}
          {loadError && <li className="px-4 py-3 text-xs text-red-400">{loadError}</li>}
          {entries?.length === 0 && (
            <li className="px-4 py-3 text-xs text-neutral-500">Nothing deleted yet.</li>
          )}
          {entries?.map((entry) => {
            const busy = restoringSha === entry.sha;
            const dir = dirName(entry.path);
            return (
              <li key={entry.sha} className="flex items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-neutral-300" title={entry.path}>
                    {dir && <span className="text-neutral-600">{dir}/</span>}
                    <span className="font-mono">{baseName(entry.path)}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-neutral-600">{entry.title}</p>
                </div>
                <button
                  type="button"
                  disabled={restoringSha !== null}
                  onClick={() => handleRestore(entry)}
                  className="shrink-0 rounded border border-line px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
                >
                  {busy ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
