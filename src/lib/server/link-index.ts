import 'server-only';

import { backlinksFor, computeLinkIndex } from '../links/graph';
import type { Backlink, LinkIndex } from '../links/types';
import { listNotes } from './index-file';
import { readNote } from './notes';
import { listOutsideNotes } from './walk';

/**
 * Builds the whole-repo link index by reading every note's content and
 * resolving every link it contains. No caching — recomputed per call, same
 * reasoning `buildTree` already uses elsewhere: at 36 files a cache buys
 * nothing and is one more thing that can desync. This only runs when a
 * delete confirmation is opened, not on every page load, so the cost of
 * reading all 36 files is paid rarely.
 */
export async function buildRepoLinkIndex(): Promise<LinkIndex> {
  const [notes, otherFiles] = await Promise.all([listNotes(), listOutsideNotes()]);
  const repoFiles = [...notes.map((n) => n.path), ...otherFiles];
  const titleByPath = new Map(notes.map((n) => [n.path, n.title]));

  const sources = await Promise.all(
    notes.map(async ({ path }) => {
      const note = await readNote(path);
      return { path, content: note.content };
    }),
  );

  return computeLinkIndex(sources, repoFiles, titleByPath);
}

export type BacklinkSummary = { path: string; count: number; backlinks: Backlink[] };

/**
 * `null` means `targetPath` isn't a known note — distinct from a real note
 * with zero backlinks, so the API route can tell "nothing links here" apart
 * from "no such note" and return the right status for each.
 *
 * Deduplicated by source note: `backlinksFor` returns one entry per raw link
 * *occurrence*, which is what rename's splicing needs (a file can link to
 * the same note twice and both need rewriting), but callers of this summary
 * — the delete confirmation UI and the delete commit's message body — care
 * about how many *notes* are affected, not how many links. Without this, a
 * file linking to the target twice would be counted and listed twice.
 */
export async function getBacklinkSummary(targetPath: string): Promise<BacklinkSummary | null> {
  const index = await buildRepoLinkIndex();
  if (!index.outbound.has(targetPath)) return null;

  const bySource = new Map<string, Backlink>();
  for (const link of backlinksFor(index, targetPath)) {
    if (!bySource.has(link.sourcePath)) bySource.set(link.sourcePath, link);
  }
  const backlinks = [...bySource.values()];
  return { path: targetPath, count: backlinks.length, backlinks };
}
