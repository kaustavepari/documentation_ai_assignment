'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

export type OverlayCandidate = { path: string; title: string };

/**
 * The disambiguation UI for an `ambiguous` wiki link: absolutely positioned
 * next to the link itself (via CodeMirror's `coordsAtPos`), not a centered
 * `<dialog>` — this needs to sit where the link is, not take over the
 * screen. Dismisses on outside click, Escape, or scroll, so it never lingers
 * somewhere stale after the page moves under it.
 */
export default function AmbiguousLinkOverlay({
  x,
  y,
  target,
  candidates,
  onDismiss,
}: {
  x: number;
  y: number;
  target: string;
  candidates: OverlayCandidate[];
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const onScroll = () => onDismiss();

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={`Notes matching "${target}"`}
      style={{ position: 'fixed', left: x, top: y + 4 }}
      className="z-50 min-w-56 max-w-80 rounded-md border border-line bg-surface py-1 shadow-lg"
    >
      <p className="border-b border-line px-3 py-1.5 text-xs text-neutral-500">
        {candidates.length} notes match &ldquo;{target}&rdquo;
      </p>
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.path}>
            <Link
              href={`/?path=${encodeURIComponent(candidate.path)}`}
              onClick={onDismiss}
              role="option"
              title={candidate.title}
              className="block truncate px-3 py-1.5 font-mono text-sm text-neutral-200 hover:bg-white/5"
            >
              {candidate.path}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
