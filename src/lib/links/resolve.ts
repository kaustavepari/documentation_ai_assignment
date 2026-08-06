import { dirName, resolveRelativePath, stemOf } from '../paths';
import type { ParsedLink, ResolvedLink } from './types';

/**
 * A target is external if it starts with a URI scheme (`https:`, `mailto:`,
 * ...) or is protocol-relative (`//host`). Per RFC 3986's generic scheme
 * grammar: a letter, then letters/digits/`+`/`-`/`.`, then `:`.
 */
const EXTERNAL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//;

/**
 * `notes/work/meetings/2025.07.15.retro.md` -> `notes/work/meetings/2025.07.15.retro`.
 * Only the last segment's extension is stripped — matches `stemOf`'s "last
 * dot" rule, applied to a full path rather than just a filename.
 *
 * Exported: a rename/move rewrites a wiki link's target to the note's new
 * path with its extension stripped, the same way this already strips a
 * note's own extension for matching — reusing this keeps both sides of that
 * symmetry defined in one place.
 */
export function withoutExtension(path: string): string {
  const dir = dirName(path);
  const stem = stemOf(path);
  return dir ? `${dir}/${stem}` : stem;
}

type WikiOutcome =
  | { state: 'malformed' }
  | { state: 'broken' }
  | { state: 'resolved'; resolvedPath: string; resolvedKind: 'note' }
  | { state: 'ambiguous'; candidates: string[] };

/**
 * Wiki links are name-based: match against every note's path with its
 * extension stripped, comparing the **trailing N segments exactly**
 * (case-insensitive, never substring/fuzzy) — this is what lets
 * `[[design/notes]]` disambiguate between two files both named `notes.md`,
 * and what keeps a target that's merely a substring of a renamed file's new
 * name (not a full segment match) correctly broken rather than fuzzy-matched.
 *
 * See dev-notes/link-resolution-spec.md for the full derivation and the
 * 10-link validation set this must reproduce exactly.
 */
export function resolveWikiLink(target: string, allNotePaths: readonly string[]): WikiOutcome {
  const trimmed = target.trim();
  if (trimmed === '') return { state: 'malformed' };

  // `[[Note.md]]` and `[[Note]]` are documented as equivalent in Obsidian —
  // this resolver's own cited precedent — so an extension-free target stays
  // fully extension-agnostic (the existing rule that lets `[[component-spec]]`
  // resolve to a `.mdx` file). But a target that *does* carry an extension is
  // a claim about which file this is, not just a name to search for: an
  // extension is stripped for the segment comparison below either way, but a
  // mismatched one (`[[new-year-goals.msf]]` against the real
  // `new-year-goals.md`) still has to come back broken, not silently
  // resolve — otherwise a typo'd extension would resolve to a plausible
  // guess instead of surfacing the mistake, which is the same silent-fix
  // this resolver already refuses to do for a mistyped stem.
  const normalized = withoutExtension(trimmed);
  const typedExt = trimmed.slice(normalized.length).toLowerCase();

  const targetSegments = normalized.split('/');
  if (targetSegments.some((segment) => segment === '')) return { state: 'malformed' };

  const targetLower = targetSegments.map((s) => s.toLowerCase());
  const candidates: string[] = [];

  for (const notePath of allNotePaths) {
    const noteWithoutExt = withoutExtension(notePath);
    if (typedExt && notePath.slice(noteWithoutExt.length).toLowerCase() !== typedExt) continue;

    const noteSegments = noteWithoutExt.split('/');
    if (noteSegments.length < targetLower.length) continue;

    const trailing = noteSegments.slice(noteSegments.length - targetLower.length);
    const isMatch = trailing.every((segment, i) => segment.toLowerCase() === targetLower[i]);
    if (isMatch) candidates.push(notePath);
  }

  if (candidates.length === 0) return { state: 'broken' };
  if (candidates.length === 1) {
    return { state: 'resolved', resolvedPath: candidates[0], resolvedKind: 'note' };
  }
  return { state: 'ambiguous', candidates };
}

type PathOutcome =
  | { state: 'malformed' }
  | { state: 'external' }
  | { state: 'broken' }
  | { state: 'resolved'; resolvedPath: string; resolvedKind: 'note' | 'asset' };

/**
 * Markdown and image links are path-based: deterministic relative-path
 * resolution from the source note's directory (RFC 3986 §5), looked up
 * against the real repo file list. No fuzzy fallback and no extension
 * guessing — the extension in the link must match the file on disk exactly.
 *
 * The result may resolve outside `notes/` entirely (a relative image link
 * into `assets/` does exactly that) — that's legitimate, not an error, and
 * is why this takes the whole repo's file list rather than just the notes.
 */
export function resolveMarkdownLink(
  sourcePath: string,
  target: string,
  repoFiles: ReadonlySet<string>,
  notePaths: ReadonlySet<string>,
): PathOutcome {
  const trimmed = target.trim();
  if (trimmed === '') return { state: 'malformed' };
  if (EXTERNAL_RE.test(trimmed)) return { state: 'external' };

  const resolved = resolveRelativePath(dirName(sourcePath), trimmed);
  if (resolved === '') return { state: 'malformed' };
  if (!repoFiles.has(resolved)) return { state: 'broken' };

  return {
    state: 'resolved',
    resolvedPath: resolved,
    resolvedKind: notePaths.has(resolved) ? 'note' : 'asset',
  };
}

export type ResolveContext = {
  notePaths: readonly string[];
  repoFiles: readonly string[];
};

/**
 * Dispatches a parsed link to the wiki or path resolver by type, and
 * reattaches the parse-time fields (offsets, raw text) to the outcome.
 *
 * Builds fresh `Set`s per call rather than requiring the caller to pass
 * them in — at ~10 links across 36 notes this costs nothing measurable, and
 * matches this project's standing rule against caching or precomputing
 * anything that isn't needed at this scale.
 */
export function resolveLink(sourcePath: string, link: ParsedLink, ctx: ResolveContext): ResolvedLink {
  if (link.type === 'wiki') {
    const outcome = resolveWikiLink(link.target, ctx.notePaths);
    return { ...link, ...outcome } as ResolvedLink;
  }

  const repoFileSet = new Set(ctx.repoFiles);
  const notePathSet = new Set(ctx.notePaths);
  const outcome = resolveMarkdownLink(sourcePath, link.target, repoFileSet, notePathSet);
  return { ...link, ...outcome } as ResolvedLink;
}
