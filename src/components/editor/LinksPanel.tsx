'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { WarningIcon } from '@/components/icons';
import type { ResolvedLink } from '@/lib/links/types';

type NoteEntry = { path: string; title: string };

/**
 * Compact outbound-only summary of the links in the currently open note —
 * not the excluded "graph/backlink visualization" (design-brief.md's own
 * scope cut): this is a single note's own links, no cross-note traversal.
 *
 * Malformed and external links are never shown here — they're not a real
 * link attempt or not ours to resolve, so listing them would be noise, not
 * signal. See dev-notes/link-resolution-spec.md for the full case matrix.
 */
export default function LinksPanel({ links, notes }: { links: ResolvedLink[]; notes: NoteEntry[] }) {
  const titleByPath = useMemo(() => new Map(notes.map((n) => [n.path, n.title])), [notes]);

  const visible = links.filter((link) => link.state !== 'malformed' && link.state !== 'external');
  if (visible.length === 0) return null;

  return (
    <div className="mx-10 mb-6 rounded-md border border-line">
      <p className="border-b border-line px-3 py-2 text-xs font-semibold text-neutral-400">
        Links in this note
      </p>
      <ul className="divide-y divide-line">
        {visible.map((link, i) => (
          <LinkRow key={i} link={link} titleByPath={titleByPath} />
        ))}
      </ul>
    </div>
  );
}

function LinkRow({
  link,
  titleByPath,
}: {
  link: ResolvedLink;
  titleByPath: Map<string, string>;
}) {
  if (link.state === 'resolved') {
    const label = link.resolvedKind === 'note' ? titleByPath.get(link.resolvedPath) ?? link.resolvedPath : link.resolvedPath;
    const row = (
      <span className="flex items-center gap-2 px-3 py-2 text-sm text-accent">
        <span className="text-neutral-600">→</span>
        <span className="truncate">{label}</span>
      </span>
    );
    if (link.resolvedKind !== 'note') return <li>{row}</li>;
    return (
      <li>
        <Link href={`/?path=${encodeURIComponent(link.resolvedPath)}`} className="block hover:bg-white/5">
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
  // component (LinksPanel filters them out) — but the type is a union of
  // all five states, so narrow explicitly rather than assume.
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
              className="text-xs text-neutral-400 hover:text-neutral-200 hover:underline"
            >
              {titleByPath.get(candidate) ?? candidate}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
