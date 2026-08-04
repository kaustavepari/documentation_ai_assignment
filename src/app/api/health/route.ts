import fs from 'node:fs/promises';
import { checkRepo, INDEX_FILE } from '@/lib/server/config';
import { git } from '@/lib/server/git';
import { listNoteFiles, listIgnoredUnderNotes, listOutsideNotes } from '@/lib/server/walk';

type IndexEntry = { path: string; title: string };

/**
 * Setup smoke test, and standing answer to the assignment's own check:
 * "does your app show 36 items?"
 *
 * Reports the filesystem walk and .noteindex.json as two independent counts
 * plus their symmetric difference, so drift between them is visible rather
 * than averaged away.
 */
export async function GET() {
  const repo = checkRepo();
  if (!repo.ok) {
    return Response.json({ ok: false, notesRoot: repo.root, problem: repo.problem }, { status: 500 });
  }

  const [onDisk, ignored, outside, indexRaw, branch] = await Promise.all([
    listNoteFiles(),
    listIgnoredUnderNotes(),
    listOutsideNotes(),
    fs.readFile(INDEX_FILE, 'utf8'),
    git().revparse(['--abbrev-ref', 'HEAD']),
  ]);

  const index: IndexEntry[] = JSON.parse(indexRaw);
  const indexPaths = new Set(index.map((e) => e.path));
  const diskPaths = new Set(onDisk);

  return Response.json({
    ok: true,
    notesRoot: repo.root,
    branch: branch.trim(),
    filesOnDisk: onDisk.length,
    entriesInIndex: index.length,
    inSync: onDisk.length === index.length && onDisk.every((p) => indexPaths.has(p)),
    missingFromIndex: onDisk.filter((p) => !indexPaths.has(p)),
    missingFromDisk: index.map((e) => e.path).filter((p) => !diskPaths.has(p)),
    files: onDisk,
    // Everything the app does NOT treat as a note, reported rather than
    // silently skipped so the choice is visible and arguable.
    ignoredUnderNotes: ignored,
    outsideNotesDir: outside,
  });
}
