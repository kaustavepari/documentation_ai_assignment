'use client';

import { useEffect, useRef } from 'react';

import { WarningIcon } from '@/components/icons';
import type { Backlink } from '@/lib/links/types';
import { baseName, dirName } from '@/lib/paths';

const LIST_CAP = 5;

/**
 * Unlike `LinkImpactModal`, this always shows — deleting is destructive
 * regardless of impact, so there's no "skip if safe" fast path. It never
 * offers a fix, just a warning: rewriting the backlinks would destroy the
 * information a later undo (Phase 6) needs to restore them.
 */
export default function DeleteConfirmDialog({
  path,
  backlinks,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  path: string;
  backlinks: Backlink[];
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const shown = backlinks.slice(0, LIST_CAP);
  const overflow = backlinks.length - shown.length;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${baseName(path)}`}
        className="w-full max-w-md rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-red-400 uppercase">Delete</p>
            <p className="mt-0.5 text-sm font-semibold text-neutral-100">
              <span className="font-mono">{baseName(path)}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Cancel"
            className="shrink-0 rounded p-1 text-lg leading-none text-neutral-500 hover:bg-white/5 hover:text-neutral-300 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="px-4 pt-3">
          <p className="text-xs leading-relaxed text-neutral-300">
            Are you sure you want to delete <span className="font-mono text-neutral-100">{baseName(path)}</span>?
          </p>

          {backlinks.length > 0 && (
            <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
              Linked from {plural(backlinks.length, 'other note')} — deleting will break{' '}
              {backlinks.length === 1 ? 'that link' : 'those links'}.
            </p>
          )}

          {backlinks.length > 0 && (
            <div className="mt-2.5 rounded-md border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                  <WarningIcon className="size-3 shrink-0" />
                  Will break these links
                </span>
                <span className="rounded-full bg-amber-500/15 px-1.5 font-mono text-[10px] text-amber-400">
                  {backlinks.length}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1 divide-y divide-white/5">
                {shown.map((link, i) => (
                  <li key={`${link.sourcePath}-${i}`} className="pt-1 text-xs first:pt-0">
                    <PathLabel path={link.sourcePath} />
                  </li>
                ))}
                {overflow > 0 && <li className="pt-1 text-xs text-neutral-600 italic">+{overflow} more</li>}
              </ul>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border border-line px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={primaryRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function PathLabel({ path }: { path: string }) {
  const dir = dirName(path);
  return (
    <span className="block truncate font-mono" title={path}>
      {dir && <span className="text-neutral-600">{dir}/</span>}
      <span className="text-neutral-300">{baseName(path)}</span>
    </span>
  );
}
