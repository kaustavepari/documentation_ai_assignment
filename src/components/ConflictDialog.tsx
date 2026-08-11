'use client';

import { useEffect, useRef } from 'react';

import { WarningIcon } from '@/components/icons';
import { baseName } from '@/lib/paths';

/**
 * The Rule 2 conflict was previously surfaced only as a header pill — easy to
 * miss if the user isn't looking at that corner, and the pill's small buttons
 * were the only way out. A blocking modal makes the moment impossible to miss
 * and, like `DeleteConfirmDialog`, has no dismiss-without-deciding path: a
 * stale save is not resolved until the user explicitly picks a side.
 */
export default function ConflictDialog({
  path,
  mine,
  theirs,
  onKeepMine,
  onLoadTheirs,
}: {
  path: string;
  mine: string;
  theirs: string;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Resolve conflict in ${baseName(path)}`}
        className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start gap-2 px-4 pt-4">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-red-400 uppercase">Changed elsewhere</p>
            <p className="mt-0.5 text-sm font-semibold text-neutral-100">
              <span className="font-mono">{baseName(path)}</span> changed on disk while you were editing it
            </p>
          </div>
        </div>

        <div className="px-4 pt-3">
          <p className="text-xs leading-relaxed text-neutral-400">
            Probably another tab, or the app restarting. Your edits here have not been saved. Pick which version to
            keep — nothing is overwritten until you choose.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Preview label="Yours (unsaved)" content={mine} tone="amber" />
            <Preview label="On disk" content={theirs} tone="neutral" />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={onLoadTheirs}
            className="rounded border border-line px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
          >
            Load theirs
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={onKeepMine}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
          >
            Keep mine
          </button>
        </div>
      </div>
    </div>
  );
}

function Preview({ label, content, tone }: { label: string; content: string; tone: 'amber' | 'neutral' }) {
  const dot = tone === 'amber' ? 'bg-amber-400' : 'bg-neutral-500';
  const labelColor = tone === 'amber' ? 'text-amber-400' : 'text-neutral-400';
  return (
    <div className="min-w-0 rounded-md border border-line bg-black/20">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1">
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
        <span className={`text-[10px] font-medium tracking-wide uppercase ${labelColor}`}>{label}</span>
      </div>
      <pre className="max-h-40 overflow-auto p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-neutral-300">
        {content.length > 0 ? content : '(empty)'}
      </pre>
    </div>
  );
}
