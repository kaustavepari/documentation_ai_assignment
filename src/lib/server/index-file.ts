import 'server-only';

import fs from 'node:fs/promises';

import { INDEX_FILE } from './config';
import { titleFor } from '../titles';
import type { NoteEntry } from '../tree';
import { listNoteFiles } from './walk';
import { readNote } from './notes';

export type IndexEntry = { path: string; title: string };

export async function readIndex(): Promise<IndexEntry[]> {
  return JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
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
