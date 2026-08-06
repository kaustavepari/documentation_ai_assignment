import 'server-only';

import { baseName } from '../paths';
import { git } from './git';
import { shortSha } from './commit';

export type TrashEntry = { sha: string; short: string; path: string; title: string };

const LOG_LIMIT = 300;

/**
 * Recovers the set of delete commits with no later restore, scanning commit
 * *subjects* to find candidates (`Delete "..." — ...`, `Restore "..." — undo
 * of <sha>`, both from `structural.ts`) but never trusting subject text for
 * the actual path or sha — `subject()` truncates long ones with "…", so the
 * two are recovered from the commit's real content instead:
 *
 *   - a delete's path comes from `git diff-tree`'s own record of what that
 *     commit removed, not from parsing it back out of the message.
 *   - a restore's target comes from resolving whatever the "undo of <ref>"
 *     fragment still points to via `git rev-parse`, so an old commit stays
 *     correctly matched even if git would now print a longer short-sha for
 *     it than it did at restore time.
 *
 * Bounded to the last 300 commits — same "don't build for 10,000 notes"
 * reasoning the rest of this project holds itself to.
 */
export async function listTrash(): Promise<TrashEntry[]> {
  const raw = await git().raw(['log', '--format=%H%x1f%s', '-z', '-n', String(LOG_LIMIT)]);
  const commits = raw
    .split('\0')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf('\x1f');
      return { sha: line.slice(0, sep), subject: line.slice(sep + 1) };
    });

  const restoredShas = new Set<string>();
  for (const { subject } of commits) {
    const match = subject.match(/^Restore ".*" — undo of ([0-9a-f]+)$/);
    if (!match) continue;
    try {
      restoredShas.add((await git().raw(['rev-parse', match[1]])).trim());
    } catch {
      // The referenced commit no longer resolves — ignore rather than fail
      // the whole listing over one stale reference.
    }
  }

  const entries: TrashEntry[] = [];
  for (const { sha, subject } of commits) {
    if (!subject.startsWith('Delete "') || restoredShas.has(sha)) continue;

    const deletedRaw = await git().raw([
      'diff-tree', '--no-commit-id', '--diff-filter=D', '--name-only', '-r', sha,
    ]);
    const deletedPath = deletedRaw
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    if (!deletedPath) continue;

    const titleMatch = subject.match(/^Delete "(.*)" — /);
    const title = titleMatch ? titleMatch[1] : baseName(deletedPath);

    entries.push({ sha, short: await shortSha(sha), path: deletedPath, title });
  }

  return entries;
}
