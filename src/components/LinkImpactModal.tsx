'use client';

import { useEffect, useRef } from 'react';

import { WarningIcon } from '@/components/icons';
import type { FixableLink, UnfixableLink } from '@/lib/links/rewrite';
import { baseName, dirName, renameVerb } from '@/lib/paths';

const LIST_CAP = 5;

/**
 * The one centered, backdrop-blocking modal in the app — deliberately a
 * different pattern from the anchored popovers (`RowContextMenu`,
 * `LinksMenu`) that dismiss on click-away, since this blocks on a choice
 * only a human can make.
 *
 * That's a narrower case than it might sound: `AppShell` only opens this
 * when the impact scan found something *unfixable* — a link elsewhere that
 * this rename/move would make newly ambiguous. Every fixable link (anything
 * pointing directly at the note being renamed) is safe by construction and
 * gets rewritten without ever reaching this dialog at all. So what's shown
 * here is always at least one thing nobody but a person can resolve, plus
 * optionally a shorter list of what's safe to also fix along the way.
 */
export default function LinkImpactModal({
  oldPath,
  newPath,
  fixable,
  unfixable,
  busy,
  error,
  onFix,
  onLeave,
  onCancel,
}: {
  oldPath: string;
  newPath: string;
  fixable: FixableLink[];
  unfixable: UnfixableLink[];
  busy: boolean;
  error: string | null;
  onFix: () => void;
  onLeave: () => void;
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

  const verb = renameVerb(oldPath, newPath);
  const sameDir = dirName(oldPath) === dirName(newPath);
  const hasFix = fixable.length > 0;

  const impactSentence = hasFix
    ? `${plural(fixable.length, 'link')} will update automatically. ${plural(unfixable.length, 'link')} can't — ${
        unfixable.length === 1 ? 'it needs' : 'they need'
      } a manual fix after this ${verb.toLowerCase()}.`
    : `${plural(unfixable.length, 'link')} will break — ${
        unfixable.length === 1 ? "it can't" : "they can't"
      } be updated automatically.`;

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
        aria-label={`Links affected by this ${verb.toLowerCase()}`}
        className="w-full max-w-md rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">{verb}</p>
            <p className="mt-0.5 text-sm font-semibold text-neutral-100">
              to <span className="font-mono">{baseName(newPath)}</span>
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {sameDir ? 'Same folder — only the filename changes.' : 'Moving to a different folder.'}
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
          <p className="text-xs leading-relaxed text-neutral-400">{impactSentence}</p>

          {hasFix && (
            <LinkGroup tone="ok" label="Updated automatically" links={fixable} />
          )}

          <LinkGroup tone="warn" label="Needs manual fixing" links={unfixable} />

          {!hasFix && unfixable.length === 1 && (
            <p className="mt-2 rounded-md border border-line bg-white/[0.02] px-2.5 py-2 text-xs text-neutral-500">
              After this {verb.toLowerCase()}, fix this link by hand in{' '}
              <span className="font-mono text-neutral-400">{unfixable[0].sourcePath}</span>.
            </p>
          )}

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2 px-4 pb-4">
          {hasFix ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onLeave}
                className="rounded border border-line px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
              >
                {verb} Only
              </button>
              <button
                ref={primaryRef}
                type="button"
                disabled={busy}
                onClick={onFix}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? 'Working…' : `Update ${plural(fixable.length, 'Link')} & ${verb}`}
              </button>
            </>
          ) : (
            <button
              ref={primaryRef}
              type="button"
              disabled={busy}
              onClick={onLeave}
              className="rounded border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {busy ? 'Working…' : `${verb} Anyway`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function LinkGroup({
  tone,
  label,
  links,
}: {
  tone: 'ok' | 'warn';
  label: string;
  links: (FixableLink | UnfixableLink)[];
}) {
  const shown = links.slice(0, LIST_CAP);
  const overflow = links.length - shown.length;

  return (
    <div
      className={`mt-2.5 rounded-md border px-2.5 py-2 ${
        tone === 'ok' ? 'border-line bg-white/[0.02]' : 'border-amber-500/25 bg-amber-500/[0.07]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${
            tone === 'ok' ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {tone === 'warn' && <WarningIcon className="size-3 shrink-0" />}
          {label}
        </span>
        <span
          className={`rounded-full px-1.5 font-mono text-[10px] ${
            tone === 'ok' ? 'bg-white/5 text-neutral-500' : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          {links.length}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1 divide-y divide-white/5">
        {shown.map((link, i) => (
          <li key={`${link.sourcePath}-${i}`} className="pt-1 text-xs first:pt-0">
            <PathLabel path={link.sourcePath} />
            {'reason' in link && <span className="mt-0.5 block text-neutral-500">{link.reason}</span>}
          </li>
        ))}
        {overflow > 0 && <li className="pt-1 text-xs text-neutral-600 italic">+{overflow} more</li>}
      </ul>
    </div>
  );
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
