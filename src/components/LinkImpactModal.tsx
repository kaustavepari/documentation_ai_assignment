'use client';

import { useEffect } from 'react';

import { WarningIcon } from '@/components/icons';
import type { FixableLink, UnfixableLink } from '@/lib/links/rewrite';

/**
 * The one centered, backdrop-blocking modal in the app — deliberately a
 * different pattern from the anchored popovers (`RowContextMenu`,
 * `LinksMenu`) that dismiss on click-away. A rename/move that affects other
 * notes' links needs an explicit choice, not something that can be
 * accidentally dismissed by a stray click.
 *
 * Always shows both lists — safely fixable and not, with why — and only
 * rewrites the fixable ones once the user confirms
 * (`crud-operations-spec.md`'s decided shape). Shared between rename and
 * move; the caller decides which endpoint `newPath` implies.
 */
export default function LinkImpactModal({
  newPath,
  fixable,
  unfixable,
  busy,
  error,
  onFix,
  onLeave,
  onCancel,
}: {
  newPath: string;
  fixable: FixableLink[];
  unfixable: UnfixableLink[];
  busy: boolean;
  error: string | null;
  onFix: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

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
        aria-label="Links affected by this change"
        className="w-full max-w-md rounded-lg border border-line bg-surface p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-neutral-100">
          Moving to <span className="font-mono">{newPath}</span>
        </h2>
        <p className="mt-1 text-xs text-neutral-500">This affects links elsewhere in the repo.</p>

        {fixable.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-emerald-400">
              Can be fixed automatically ({fixable.length})
            </p>
            <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
              {fixable.map((link, i) => (
                <li
                  key={`${link.sourcePath}-${i}`}
                  className="truncate font-mono text-xs text-neutral-400"
                  title={link.sourcePath}
                >
                  {link.sourcePath}
                </li>
              ))}
            </ul>
          </div>
        )}

        {unfixable.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-amber-400">
              Can&rsquo;t be fixed automatically ({unfixable.length})
            </p>
            <ul className="mt-1.5 max-h-32 space-y-1.5 overflow-y-auto">
              {unfixable.map((link, i) => (
                <li key={`${link.sourcePath}-${i}`} className="flex items-start gap-1.5 text-xs">
                  <WarningIcon className="mt-0.5 size-3 shrink-0 text-amber-400" />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-neutral-400" title={link.sourcePath}>
                      {link.sourcePath}
                    </span>
                    <span className="text-neutral-600">{link.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onLeave}
            className="rounded border border-line px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Leave as-is'}
          </button>
          {fixable.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={onFix}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? 'Fixing…' : 'Fix what can be fixed'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
