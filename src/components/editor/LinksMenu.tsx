'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LinkIcon, WarningIcon } from '@/components/icons';
import type { ResolvedLink } from '@/lib/links/types';

type NoteEntry = { path: string; title: string };

/**
 * The header trigger + popover for a note's outbound links — not the excluded
 * "graph/backlink visualization" (design-brief.md's own scope cut): this is a
 * single note's own links, no cross-note traversal.
 *
 * Lives entirely outside the note's scrolling content region, anchored to its
 * own button via a `position: fixed` popover positioned from
 * `getBoundingClientRect()` at open-time — the same pattern
 * `AmbiguousLinkOverlay` already uses. That is deliberate: this used to be a
 * card rendered inline after the editor, and CodeMirror's own flex/height
 * plumbing could leave it visually overlapping note text. Anchoring to the
 * header instead of the document flow makes that class of bug impossible
 * rather than patching it.
 *
 * Malformed and external links are never shown here — they're not a real
 * link attempt or not ours to resolve, so listing them would be noise, not
 * signal. See dev-notes/link-resolution-spec.md for the full case matrix.
 */
export default function LinksMenu({ links, notes }: { links: ResolvedLink[]; notes: NoteEntry[] }) {
  const titleByPath = useMemo(() => new Map(notes.map((n) => [n.path, n.title])), [notes]);
  const visible = links.filter((link) => link.state !== 'malformed' && link.state !== 'external');

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ right: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Most notes have none (4 of 36 do, per design-brief.md) — no trigger at
  // all is the honest state, not a button that opens onto an empty list.
  if (visible.length === 0) return null;

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setCoords({ right: window.innerWidth - rect.right, top: rect.bottom + 6 });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Links in this note (${visible.length})`}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-xs text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
      >
        <LinkIcon className="size-3.5" />
        {visible.length}
      </button>

      {open && coords && (
        <div
          ref={menuRef}
          role="dialog"
          aria-label="Links in this note"
          style={{ position: 'fixed', right: coords.right, top: coords.top }}
          className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          <p className="border-b border-line px-3 py-2 text-xs font-semibold text-neutral-400">
            Links in this note
          </p>
          <ul className="divide-y divide-line">
            {visible.map((link, i) => (
              <LinkRow key={i} link={link} titleByPath={titleByPath} onNavigate={() => setOpen(false)} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function LinkRow({
  link,
  titleByPath,
  onNavigate,
}: {
  link: ResolvedLink;
  titleByPath: Map<string, string>;
  onNavigate: () => void;
}) {
  if (link.state === 'resolved') {
    // The path, not the title: this is the identifier the link actually
    // resolved to, and showing anything else would mean the app silently
    // relabels what the note's author wrote inside `[[ ]]`.
    const row = (
      <span className="flex items-center gap-2 px-3 py-2 text-sm text-accent">
        <span className="text-neutral-600">→</span>
        <span className="truncate font-mono">{link.resolvedPath}</span>
      </span>
    );
    if (link.resolvedKind !== 'note') return <li>{row}</li>;
    return (
      <li>
        <Link
          href={`/?path=${encodeURIComponent(link.resolvedPath)}`}
          onClick={onNavigate}
          title={titleByPath.get(link.resolvedPath)}
          className="block hover:bg-white/5"
        >
          {row}
        </Link>
      </li>
    );
  }

  if (link.state === 'broken') {
    const reason =
      link.type === 'wiki'
        ? `"${link.target}" doesn't match any note`
        : `"${link.target}" doesn't resolve to a file`;
    return (
      <li className="flex items-start gap-2 px-3 py-2 text-sm text-red-400">
        <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Broken — {reason}
        </span>
      </li>
    );
  }

  // Ambiguous is wiki-only, and malformed/external never reach this
  // component (filtered out above) — but the type is a union of all five
  // states, so narrow explicitly rather than assume.
  if (link.state !== 'ambiguous') return null;

  return (
    <li className="px-3 py-2 text-sm text-amber-400">
      <div className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Ambiguous — {link.candidates.length} notes match &ldquo;{link.target}&rdquo;
        </span>
      </div>
      <ul className="mt-1.5 ml-5.5 space-y-1">
        {link.candidates.map((candidate) => (
          <li key={candidate}>
            <Link
              href={`/?path=${encodeURIComponent(candidate)}`}
              onClick={onNavigate}
              title={titleByPath.get(candidate)}
              className="font-mono text-xs text-neutral-400 hover:text-neutral-200 hover:underline"
            >
              {candidate}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
