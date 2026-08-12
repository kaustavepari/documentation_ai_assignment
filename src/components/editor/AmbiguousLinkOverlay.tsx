'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type OverlayCandidate = { path: string; title: string };

/** Minimum gap (px) kept between the overlay and any viewport edge. */
const VIEWPORT_MARGIN = 8;

/**
 * Given the raw click point (`x`, `y` — the left edge / bottom edge of the
 * clicked link, in viewport coordinates since this is a `position: fixed`
 * element) and the overlay's own rendered size, returns a `{ left, top }`
 * that keeps the whole box on screen:
 *  - Vertically: prefers rendering below the click (`y + gap`), but flips to
 *    above it (`y - height - gap`) when there isn't room below. If there
 *    isn't room *above* either (a viewport shorter than the overlay), it
 *    just clamps into the available space rather than flipping forever.
 *  - Horizontally: clamps `x` so the box never crosses the left or right
 *    edge; no flip needed since the click point is already the box's left
 *    edge, not its center.
 *
 * Pure function (no DOM reads) so it can be exercised directly in a script,
 * independent of React rendering.
 */
export function clampPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 4,
  margin = VIEWPORT_MARGIN,
): { left: number; top: number } {
  const { x, y } = point;
  const { width, height } = size;

  const fitsBelow = y + gap + height + margin <= viewport.height;
  const top = fitsBelow ? y + gap : y - gap - height;

  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const maxTop = Math.max(margin, viewport.height - height - margin);

  return {
    left: Math.min(Math.max(x, margin), maxLeft),
    top: Math.min(Math.max(top, margin), maxTop),
  };
}

/**
 * The disambiguation UI for an `ambiguous` wiki link: absolutely positioned
 * next to the link itself (via CodeMirror's `coordsAtPos`), not a centered
 * `<dialog>` — this needs to sit where the link is, not take over the
 * screen. Dismisses on outside click, Escape, or scroll, so it never lingers
 * somewhere stale after the page moves under it.
 *
 * Position is clamped to the viewport after mount: `coordsAtPos` hands back
 * the raw click point with no regard for the overlay's own size, so a click
 * near the bottom/right edge would otherwise render the candidate list
 * partly or fully off-screen (bug #3 in dev-notes/known-bugs.md). Measuring
 * happens in `useLayoutEffect` (not `useEffect`) so the flip/clamp is
 * applied before the browser paints — no visible jump from the raw position
 * to the corrected one.
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
  // Start at the raw click point (unclamped) so the very first paint has a
  // sane position even before we've been able to measure; corrected a frame
  // later by the layout effect below, before the browser actually paints.
  const [pos, setPos] = useState({ left: x, top: y + 4 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(
      clampPosition(
        { x, y },
        { width, height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    // Re-run whenever the click point or candidate set changes size.
  }, [x, y, candidates]);

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
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
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
