import { stemOf } from './paths';

/**
 * A note's title, following the rule `.noteindex.json` already uses.
 *
 * Confirmed against all 36 existing entries rather than assumed:
 *
 *   1. YAML frontmatter with a top-level `title:` -> that value, verbatim.
 *   2. Otherwise -> the filename with its extension stripped, untransformed
 *      (no title-casing, no dash-to-space).
 *
 * Only YAML frontmatter counts. `notes/drafts/experiment-log.org` opens with
 * Org-mode's `#+TITLE: Experiment Log`, and the index still calls it
 * `experiment-log` — so the fallback is about the *absence of frontmatter*,
 * not the absence of a title.
 */
export function titleFor(relPath: string, content: string): string {
  const frontmatter = readFrontmatter(content);
  if (frontmatter !== null) {
    for (const line of frontmatter.split('\n')) {
      // Leading whitespace means a nested key inside some other block, not the
      // document's own title.
      if (/^\s/.test(line)) continue;
      const match = /^title:[ \t]*(.*)$/.exec(line);
      if (!match) continue;
      const value = unquote(match[1].trim());
      // An empty `title:` falls through to the filename rather than showing a
      // blank entry in the tree.
      return value || stemOf(relPath);
    }
  }
  return stemOf(relPath);
}

/** The body between the opening and closing `---`, or null if there is none. */
function readFrontmatter(content: string): string | null {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  return match ? match[1].replace(/\r\n/g, '\n') : null;
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1) : value;
}
