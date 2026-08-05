export type LinkType = 'wiki' | 'markdown' | 'image';

/**
 * A link found in a note's raw text, before resolution.
 *
 * Offsets are into the LF-normalized content (matching how `readNote`
 * hands content to the rest of the app) and are character offsets, not
 * byte offsets.
 */
export type ParsedLink = {
  type: LinkType;
  /** The full matched text, e.g. `[[design/notes]]` or `![alt](path.svg)`. */
  raw: string;
  /** The target as written, e.g. `design/notes` or `path.svg`. */
  target: string;
  /** Link text for markdown/image links; null for wiki links. */
  label: string | null;
  from: number;
  to: number;
  /** Offsets of `target` itself, for cursor placement and overlay anchoring. */
  targetFrom: number;
  targetTo: number;
};

export type ResolvedLink = ParsedLink &
  (
    | { state: 'resolved'; resolvedPath: string; resolvedKind: 'note' | 'asset' }
    | { state: 'broken' }
    | { state: 'ambiguous'; candidates: string[] }
    | { state: 'malformed' }
    | { state: 'external' }
  );

export type Backlink = {
  sourcePath: string;
  sourceTitle: string;
  type: LinkType;
  raw: string;
};

export type LinkIndex = {
  outbound: Map<string, ResolvedLink[]>;
  backlinks: Map<string, Backlink[]>;
};
