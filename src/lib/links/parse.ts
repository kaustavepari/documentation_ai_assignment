import type { LinkType, ParsedLink } from './types';

/**
 * Finds `[[wiki links]]` and `[text](path)` / `![alt](path)` links in raw
 * note text, skipping anything inside frontmatter, fenced/indented code, or
 * inline code spans — a note *about* markdown syntax must not have its
 * example `[[links]]` treated as real ones.
 *
 * Callers always pass LF-normalized content, matching what `readNote` and
 * the editor's own document both use — there is no CRLF handling here.
 */
export function parseLinks(content: string): ParsedLink[] {
  const skip = computeSkipRanges(content);
  const links: ParsedLink[] = [];

  const wikiRe = /\[\[([^[\]]*)\]\]/g;
  for (const match of content.matchAll(wikiRe)) {
    const from = match.index;
    const to = from + match[0].length;
    if (isInSkipRange(from, skip)) continue;

    const target = match[1] ?? '';
    const targetFrom = from + 2; // past the opening `[[`
    links.push({
      type: 'wiki',
      raw: match[0],
      target,
      label: null,
      from,
      to,
      targetFrom,
      targetTo: targetFrom + target.length,
    });
  }

  // (bang?)? '[' label ']' '(' inner ')'  — group offsets computed by hand
  // rather than the regex `d` flag, which needs an es2022+ compile target
  // this project doesn't otherwise need.
  const mdRe = /(!)?\[([^[\]]*)\]\(([^()]*)\)/g;
  for (const match of content.matchAll(mdRe)) {
    const from = match.index;
    const to = from + match[0].length;
    if (isInSkipRange(from, skip)) continue;

    const bang = match[1] ?? '';
    const label = match[2] ?? '';
    const inner = match[3] ?? '';
    const innerFrom = from + bang.length + 1 + label.length + 1 + 1;

    const { target, offsetInInner } = splitDestinationAndTitle(inner);
    const targetFrom = innerFrom + offsetInInner;

    const type: LinkType = bang ? 'image' : 'markdown';
    links.push({
      type,
      raw: match[0],
      target,
      label,
      from,
      to,
      targetFrom,
      targetTo: targetFrom + target.length,
    });
  }

  links.sort((a, b) => a.from - b.from);
  return links;
}

/**
 * Byte ranges (as char offsets) to exclude from link scanning: YAML
 * frontmatter, fenced code blocks, indented code blocks, and inline code
 * spans. Deliberately a simplified approximation of CommonMark rather than
 * a full implementation — good enough to keep a note's own markdown
 * examples from being parsed as real links, not a general-purpose parser.
 */
export function computeSkipRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  const frontmatter = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(content);
  if (frontmatter) ranges.push([0, frontmatter[0].length]);

  const lines = content.split('\n');
  let offset = 0;
  let fence: { char: string; length: number; start: number } | null = null;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (fence) {
      const close = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        ranges.push([fence.start, lineEnd]);
        fence = null;
      }
    } else {
      const open = indent <= 3 ? /^(`{3,}|~{3,})/.exec(trimmed) : null;
      if (open) {
        fence = { char: open[1][0], length: open[1].length, start: lineStart };
      } else if (indent >= 4 && line.trim() !== '') {
        ranges.push([lineStart, lineEnd]);
      } else if (/^\t/.test(line) && line.trim() !== '') {
        ranges.push([lineStart, lineEnd]);
      }
    }

    offset = lineEnd + 1;
  }
  if (fence) ranges.push([fence.start, content.length]);

  // Inline code spans, scanned per line so a stray unmatched backtick can't
  // greedily swallow the rest of the document looking for its pair.
  offset = 0;
  for (const line of lines) {
    const codeRe = /(`+)([^`]*?)\1/g;
    for (const match of line.matchAll(codeRe)) {
      ranges.push([offset + match.index, offset + match.index + match[0].length]);
    }
    offset += line.length + 1;
  }

  return ranges;
}

function isInSkipRange(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => pos >= start && pos < end);
}

/**
 * Splits a markdown link destination from its optional trailing `"title"`,
 * and unwraps `<destination with spaces>`. Returns the target and its
 * offset within `inner` so the caller can compute an absolute position.
 */
function splitDestinationAndTitle(inner: string): { target: string; offsetInInner: number } {
  const leadingWs = /^\s*/.exec(inner)![0];
  const rest = inner.slice(leadingWs.length);
  const offset = leadingWs.length;

  if (rest.startsWith('<')) {
    const end = rest.indexOf('>');
    if (end !== -1) {
      return { target: rest.slice(1, end), offsetInInner: offset + 1 };
    }
  }

  const wsIndex = rest.search(/\s/);
  const target = wsIndex === -1 ? rest : rest.slice(0, wsIndex);
  return { target, offsetInInner: offset };
}
