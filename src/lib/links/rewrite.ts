import { dirName, relativePath } from '../paths';
import { backlinksFor } from './graph';
import { resolveWikiLink, withoutExtension } from './resolve';
import type { LinkIndex, LinkType } from './types';

/**
 * What a rename/move from `oldPath` to `newPath` does to every other note's
 * links — the read side of Rule 3. Pure: takes an already-built `LinkIndex`
 * (see `server/link-index.ts`) rather than touching the filesystem, so it
 * can run once for a preview and again, unchanged, for the real mutation.
 *
 * `fixable` is everything mechanically safe to rewrite. Every inbound wiki
 * link is rewritten to `newPath` with its extension stripped, which is
 * always a unique match by construction (full-path targets can't collide —
 * see `resolve.ts`'s segment-matching rule), so nothing pointing directly at
 * the moved note ever needs a human decision. Markdown/image links are
 * always fixable too: a relative path can always be recomputed.
 *
 * `unfixable` is a different, indirect case `link-resolution-spec.md` names
 * explicitly: the move can make some UNRELATED wiki link — one that doesn't
 * point at `oldPath` today — newly ambiguous, if `newPath`'s trailing
 * segments happen to collide with a target that used to resolve uniquely.
 * Catching that means re-resolving every wiki link in the repo against the
 * post-move file list, not just `oldPath`'s own backlinks. Cheap at this
 * dataset's scale; in practice this bucket is usually empty, since the
 * fixable strategy above is deliberately designed to never need it for the
 * common case.
 */

export type FixableLink = { sourcePath: string; sourceTitle: string; type: LinkType; raw: string };
export type UnfixableLink = FixableLink & { reason: string };
export type LinkRewritePlan = { fixable: FixableLink[]; unfixable: UnfixableLink[] };

export function planLinkRewrite(
  index: LinkIndex,
  oldPath: string,
  newPath: string,
  notePaths: readonly string[],
  titleByPath: ReadonlyMap<string, string>,
): LinkRewritePlan {
  const fixable: FixableLink[] = backlinksFor(index, oldPath).map((b) => ({ ...b }));

  // The moved note's own outbound path-links need re-relativizing when its
  // directory changes, even though none of their targets moved.
  if (dirName(oldPath) !== dirName(newPath)) {
    for (const link of index.outbound.get(oldPath) ?? []) {
      if (link.state === 'resolved' && (link.type === 'markdown' || link.type === 'image')) {
        fixable.push({
          sourcePath: oldPath,
          sourceTitle: titleByPath.get(oldPath) ?? oldPath,
          type: link.type,
          raw: link.raw,
        });
      }
    }
  }

  const unfixable: UnfixableLink[] = [];
  const movedNotePaths = notePaths.map((p) => (p === oldPath ? newPath : p));

  for (const [sourcePath, links] of index.outbound) {
    if (sourcePath === oldPath) continue; // its own links are the fixable block above

    for (const link of links) {
      if (link.type !== 'wiki' || link.state !== 'resolved' || link.resolvedPath === oldPath) continue;

      const after = resolveWikiLink(link.target, movedNotePaths);
      if (after.state === 'ambiguous') {
        unfixable.push({
          sourcePath,
          sourceTitle: titleByPath.get(sourcePath) ?? sourcePath,
          type: link.type,
          raw: link.raw,
          reason: `Would make "${link.target}" ambiguous — it would then match ${after.candidates.length} notes instead of 1`,
        });
      }
    }
  }

  return { fixable, unfixable };
}

export type Splice = { from: number; to: number; text: string };

/**
 * Splice ranges for one source file's content — every link in it that needs
 * rewriting because of this rename/move. Sorted descending by offset:
 * applying them in that order (right-to-left through the string) means an
 * earlier splice's position is never invalidated by a later one in the same
 * file.
 */
export function buildSplicesForFile(
  sourcePath: string,
  index: LinkIndex,
  oldPath: string,
  newPath: string,
): Splice[] {
  const links = index.outbound.get(sourcePath) ?? [];
  const splices: Splice[] = [];

  for (const link of links) {
    if (link.state !== 'resolved') continue;

    if (link.resolvedPath === oldPath) {
      const text =
        link.type === 'wiki' ? withoutExtension(newPath) : relativePath(dirName(sourcePath), newPath);
      splices.push({ from: link.targetFrom, to: link.targetTo, text });
      continue;
    }

    // This file is the one that moved: its own path-links need a new
    // relative distance to their (unmoved) targets, even though the target
    // itself isn't `oldPath`.
    if (sourcePath === oldPath && (link.type === 'markdown' || link.type === 'image')) {
      splices.push({
        from: link.targetFrom,
        to: link.targetTo,
        text: relativePath(dirName(newPath), link.resolvedPath),
      });
    }
  }

  return splices.sort((a, b) => b.from - a.from);
}

export function applySplices(content: string, splices: Splice[]): string {
  let result = content;
  for (const { from, to, text } of splices) {
    result = result.slice(0, from) + text + result.slice(to);
  }
  return result;
}
