'use client';

import { useEffect, useRef } from 'react';

import { FolderIcon } from '@/components/icons';
import { baseName } from '@/lib/paths';

/**
 * The keyboard-accessible fallback for Move — reached via the row context
 * menu's "Move to…", since native drag-and-drop (`NoteTree.tsx`) has no
 * keyboard equivalent. Lists real folders only, no free-text field: creating
 * a folder stays solely the sidebar's New Folder button's job, not something
 * this dialog duplicates.
 *
 * Picking a folder confirms immediately — this is a destination picker, not
 * a form, so there's nothing a second "Move" button would add.
 */
export default function MoveToDialog({
  path,
  folders,
  onConfirm,
  onCancel,
}: {
  path: string;
  folders: string[];
  onConfirm: (folder: string) => void;
  onCancel: () => void;
}) {
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
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
        aria-label={`Move ${baseName(path)} to…`}
        className="w-full max-w-sm rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">Move to…</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-neutral-100" title={path}>
              <span className="font-mono">{baseName(path)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="shrink-0 rounded p-1 text-lg leading-none text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
          >
            ×
          </button>
        </div>

        <ul className="max-h-72 overflow-y-auto border-t border-line py-1.5">
          {folders.map((folder, i) => (
            <li key={folder}>
              <button
                ref={i === 0 ? firstItemRef : undefined}
                type="button"
                onClick={() => onConfirm(folder)}
                className="flex w-full items-center gap-2 px-4 py-1.5 text-left font-mono text-xs text-neutral-300 hover:bg-white/5"
              >
                <FolderIcon className="size-3.5 shrink-0 text-neutral-500" />
                <span className="truncate">{folder}</span>
              </button>
            </li>
          ))}
          {folders.length === 0 && (
            <li className="px-4 py-2 text-xs text-neutral-500">No other folders yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
