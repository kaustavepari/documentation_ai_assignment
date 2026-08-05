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
