/**
 * Files preserve their existing line-ending convention on disk; application
 * content is always LF-normalized. This repo is checked out with
 * `core.autocrlf=true`, so on-disk bytes are CRLF while a browser
 * `<textarea>`/CodeMirror always normalizes to LF — without this boundary, a
 * naive read/write round-trip would rewrite every line of every touched file.
 */

/** Normalize on-disk text to the LF content the rest of the app works with. */
export function toAppContent(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

/**
 * Render LF app content back to the line-ending convention already used by
 * `existingRaw` — another read of the same file, or `''` if none exists yet
 * (defaults to LF).
 */
export function toDiskContent(content: string, existingRaw: string): string {
  return existingRaw.includes('\r\n')
    ? content.replace(/\r?\n/g, '\r\n')
    : content.replace(/\r\n/g, '\n');
}
