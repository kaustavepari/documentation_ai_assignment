import 'server-only';

import fs from 'node:fs/promises';

import { INDEX_FILE } from './config';
import { titleFor } from '../titles';
import type { NoteEntry } from '../tree';
import { toDiskContent } from './eol';
import { listNoteFiles } from './walk';
import { readNote } from './notes';

export type IndexEntry = { path: string; title: string };

export async function readIndex(): Promise<IndexEntry[]> {
  return JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
}

/**
 * `.noteindex.json` uses a hand-rolled shape — one entry per line, compact
 * inside the object, a space after each colon:
 *
 *     [
 *       {"path": "notes/index.md", "title": "Notes Index"},
 *     ]
 *
 * `JSON.stringify(entries, null, 2)` puts every key on its own line, which
 * would turn the file's 38 lines into ~144 on the very first write. That single
 * reformat would land in the log the reviewers read, and every index diff after
 * it would be unreadable. So the serialiser is written out by hand to match
 * what is already there, byte for byte.
 *
 * Sort order matters for the same reason: the existing file is sorted by path,
 * and rewriting it in a different order would produce a whole-file diff every
 * time a note is added.
 */
export function serializeIndex(entries: IndexEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const lines = sorted.map(
    ({ path, title }, i) =>
      `  {"path": ${JSON.stringify(path)}, "title": ${JSON.stringify(title)}}${
        i === sorted.length - 1 ? '' : ','
      }`,
  );
  return ['[', ...lines, ']', ''].join('\n');
}

/**
 * Rewrite the index, preserving the file's own line endings.
 *
 * Callers are inside `repoLock` and stage this file as part of the same commit
 * as the change that caused it — the index is never dirty at rest, and never
 * gets a commit of its own. A commit reading "update index" would be
 * unintelligible alone, and splitting it would break undo: `git revert` has to
 * restore the note *and* its index entry in one step.
 */
export async function writeIndex(entries: IndexEntry[]): Promise<void> {
  const existing = await fs.readFile(INDEX_FILE, 'utf8').catch(() => '');
  await fs.writeFile(INDEX_FILE, toDiskContent(serializeIndex(entries), existing), 'utf8');
}

/**
 * The index as it *should* look for what is currently on disk.
 *
 * Titles are computed from each file's own content, deliberately not read back
 * from the existing index. `listNotes` trusts the index because the sidebar
 * wants whatever the index claims; this is the other direction — it is what
 * *corrects* the index, so trusting it here would make a retitle a no-op and
 * quietly leave the file stale.
 */
export async function buildIndexEntries(): Promise<IndexEntry[]> {
  const paths = await listNoteFiles();
  return Promise.all(
    paths.map(async (path) => {
      try {
        return { path, title: (await readNote(path)).title };
      } catch {
        return { path, title: titleFor(path, '') };
      }
    }),
  );
}

/**
 * Every note, with the title the sidebar shows.
 *
 * Titles come from `.noteindex.json` — the app's job is to keep that file
 * correct, so reading it back is the honest source rather than a second
 * opinion computed alongside it. If the two ever disagree, the sidebar showing
 * the index makes the drift visible instead of hiding it.
 *
 * A note that is on disk but missing from the index has its title computed
 * directly, so a file can never vanish from the sidebar because of a stale
 * index. That path costs one file read and only runs for the stragglers.
 */
export async function listNotes(): Promise<NoteEntry[]> {
  const [paths, index] = await Promise.all([listNoteFiles(), readIndex()]);
  const titles = new Map(index.map((entry) => [entry.path, entry.title]));

  return Promise.all(
    paths.map(async (path) => {
      const known = titles.get(path);
      if (known !== undefined) return { path, title: known };
      try {
        const note = await readNote(path);
        return { path, title: note.title };
      } catch {
        return { path, title: titleFor(path, '') };
      }
    }),
  );
}
