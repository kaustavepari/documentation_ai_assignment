/**
 * Pure string helpers for repo-relative paths.
 *
 * Deliberately not `node:path`: these run on the client too (the tree renders
 * names in the browser), and repo paths are always POSIX with forward slashes
 * regardless of the host OS. Anything that touches the filesystem lives in
 * `lib/server/paths.ts` instead.
 */

/** `notes/work/todo.md` -> `todo.md` */
export function baseName(relPath: string): string {
  const cut = relPath.lastIndexOf('/');
  return cut === -1 ? relPath : relPath.slice(cut + 1);
}

/** `notes/work/todo.md` -> `notes/work`; a top-level path gives `''`. */
export function dirName(relPath: string): string {
  const cut = relPath.lastIndexOf('/');
  return cut === -1 ? '' : relPath.slice(0, cut);
}

/**
 * Extension, lowercased, taken from the LAST dot — so
 * `2025.07.15.retro.md` is `.md`, not `.07.15.retro.md`.
 *
 * A leading dot is a hidden file rather than an extension: `.gitignore` has no
 * extension.
 */
export function extensionOf(relPath: string): string {
  return rawExtensionOf(relPath).toLowerCase();
}

/**
 * The extension exactly as written. `LEGACY-IMPORT.MD` keeps its uppercase
 * `.MD`, which the sidebar shows — the casing is real and worth not hiding.
 */
export function rawExtensionOf(relPath: string): string {
  const base = baseName(relPath);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

/** Filename with its extension stripped. The index's title fallback uses this. */
export function stemOf(relPath: string): string {
  const base = baseName(relPath);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

/**
 * Joins and normalizes a POSIX relative path, resolving `.` and `..`
 * segments — pure string math, no filesystem access. This is the
 * client-safe counterpart to `resolveInRepo`'s traversal handling in
 * `lib/server/paths.ts`, which throws and needs `node:path`/`fs`, so it
 * isn't reused directly.
 *
 * May resolve outside `fromDir` entirely, including above it — a relative
 * markdown link from a note into `assets/` does exactly that, and excess
 * `..` segments simply run out (matching how a browser resolves a relative
 * href with more `../` than the source path has levels). This function only
 * computes the resulting path string; it does not judge whether that path
 * is allowed to exist.
 */
export function resolveRelativePath(fromDir: string, target: string): string {
  const combined = fromDir ? `${fromDir}/${target}` : target;
  const resolved: string[] = [];

  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.join('/');
}

/**
 * Inverse of `resolveRelativePath`: the relative path from a directory to a
 * repo-relative target, one `..` per directory segment not shared with the
 * target. Needed when a rename/move changes a note's own directory (its
 * outbound relative links need new `../` counts) or changes where a linking
 * note has to reach it from.
 *
 * Verified against the one real case in the dataset: from
 * `notes/work/meetings` to `assets/diagrams/auth-flow.svg` produces
 * `../../../assets/diagrams/auth-flow.svg` — the correct 3-level path
 * `repo-analysis.md` confirmed the source data gets wrong by one `../`.
 */
export function relativePath(fromDir: string, toPath: string): string {
  const fromSegments = fromDir ? fromDir.split('/') : [];
  const toSegments = toPath.split('/');

  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common++;
  }

  const ups = Array(fromSegments.length - common).fill('..');
  return [...ups, ...toSegments.slice(common)].join('/');
}

/**
 * "Rename" (same folder), "Move" (same filename, different folder), or
 * "Move and rename" (both) — the verb this operation reads as, computed once
 * so the commit message (`server/structural.ts`) and the link-impact modal
 * can never drift apart on what to call the same operation.
 */
export function renameVerb(oldPath: string, newPath: string): 'Rename' | 'Move' | 'Move and rename' {
  const sameDir = dirName(oldPath) === dirName(newPath);
  const sameName = baseName(oldPath) === baseName(newPath);
  if (sameDir) return 'Rename';
  if (sameName) return 'Move';
  return 'Move and rename';
}

/** `oldPath` and `newPath` differ only in case — the Windows/macOS trap where
 *  a naive single `git mv` can silently no-op on a case-insensitive
 *  filesystem. See DECISIONS.md's case-only-rename section. */
export function isCaseOnlyRename(oldPath: string, newPath: string): boolean {
  return oldPath !== newPath && oldPath.toLowerCase() === newPath.toLowerCase();
}

/**
 * Sentinel `baseHash` meaning "this file shouldn't exist on disk yet" — a
 * real SHA-256 hex digest is never the empty string, so this can never
 * collide with a genuine hash. The create flow opens an editor session with
 * this as the starting hash; the first autosave is the first disk write.
 */
export const NEW_FILE_HASH = '';
