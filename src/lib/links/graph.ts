import { parseLinks } from './parse';
import { resolveLink } from './resolve';
import type { Backlink, LinkIndex, ResolvedLink } from './types';

export type LinkSource = { path: string; content: string };

/**
 * Builds the repo-wide link index: every note's outbound links, resolved,
 * plus the inverse — who resolves to a given path.
 *
 * There's no persisted graph and no per-target search. This is a
 * scan-then-invert: parse and resolve every source's links first (the
 * `outbound` map), then walk every `resolved` link across all sources and
 * push it into a reverse map keyed by its resolved target (`backlinks`). A
 * path only ever appears in `backlinks` because some other note's forward
 * pass already proved a link of its resolves there — a broken link that
 * merely *looks like* a match (case #4 in dev-notes/link-resolution-spec.md)
 * can never appear as a false-positive backlink, because it's never
 * `resolved` in the first place.
 *
 * Pure: takes already-read content rather than touching the filesystem, so
 * it's testable without a repo and reusable client-side if ever needed.
 */
export function computeLinkIndex(
  sources: LinkSource[],
  repoFiles: readonly string[],
  titleByPath: ReadonlyMap<string, string>,
): LinkIndex {
  const notePaths = sources.map((s) => s.path);
  const outbound = new Map<string, ResolvedLink[]>();
  const backlinks = new Map<string, Backlink[]>();

  for (const source of sources) {
    const links = parseLinks(source.content);
    const resolved = links.map((link) => resolveLink(source.path, link, { notePaths, repoFiles }));
    outbound.set(source.path, resolved);

    for (const link of resolved) {
      if (link.state !== 'resolved') continue;

      const existing = backlinks.get(link.resolvedPath);
      const entry: Backlink = {
        sourcePath: source.path,
        sourceTitle: titleByPath.get(source.path) ?? source.path,
        type: link.type,
        raw: link.raw,
      };
      if (existing) existing.push(entry);
      else backlinks.set(link.resolvedPath, [entry]);
    }
  }

  return { outbound, backlinks };
}

export function backlinksFor(index: LinkIndex, targetPath: string): Backlink[] {
  return index.backlinks.get(targetPath) ?? [];
}
