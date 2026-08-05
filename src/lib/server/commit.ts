import 'server-only';

import { git } from './git';

/**
 * The primitives every commit in this app goes through.
 *
 * Two rules are enforced here rather than left to callers:
 *
 *   1. **Explicit pathspec, always.** `git commit -- <paths>` builds the commit
 *      from HEAD plus those paths only, ignoring everything else dirty in the
 *      tree. That is what lets five notes be dirty while exactly one commits.
 *      `git commit -a` would destroy the whole design in one call, so it never
 *      appears.
 *   2. **Never commit a no-op.** A note that was opened and not changed must
 *      not produce a commit; see `hasChangesAgainst`.
 */

export type WordStat = { added: number; removed: number };

export async function headSha(): Promise<string | null> {
  try {
    return (await git().raw(['rev-parse', 'HEAD'])).trim();
  } catch {
    return null; // repo with no commits yet
  }
}

export async function shortSha(sha: string): Promise<string> {
  return (await git().raw(['rev-parse', '--short', sha])).trim();
}

/**
 * True if `paths` differ from `base` (a commit-ish).
 *
 * Decided on output rather than exit code: `git diff --quiet` signals its
 * answer by exiting 1, and simple-git resolves that call normally instead of
 * rejecting, so a status-code check silently reports "nothing changed" for
 * every edit.
 *
 * `git diff` alone is also not enough — it does not see a file that git has
 * never tracked, which is exactly the case when a note has just been created.
 */
export async function hasChangesAgainst(base: string, paths: string[]): Promise<boolean> {
  const changed = await git().raw(['diff', '--name-only', base, '--', ...paths]);
  if (changed.trim() !== '') return true;

  const untracked = await git().raw([
    'ls-files', '--others', '--exclude-standard', '--', ...paths,
  ]);
  return untracked.trim() !== '';
}

/**
 * Words added and removed between `base` and the working tree.
 *
 * Words, not lines, because `--numstat` counts lines and a markdown paragraph
 * is usually one long soft-wrapped line: rewriting a whole paragraph reads as
 * `+1 -1`, and writing three paragraphs reads as `+3`. That is not merely
 * imprecise, it is misleading in the log. Git's own word-diff does the
 * tokenising, so this only has to count.
 *
 * Callers must stage first. `git diff` cannot see a file git has never heard
 * of, so a brand-new note would otherwise measure as zero words — the one case
 * where the count matters most.
 */
export async function wordStat(base: string, paths: string[]): Promise<WordStat> {
  let out: string;
  try {
    out = await git().raw(['diff', '--word-diff=porcelain', '--unified=0', base, '--', ...paths]);
  } catch {
    return { added: 0, removed: 0 };
  }

  let added = 0;
  let removed = 0;
  let inHunk = false;

  for (const line of out.split('\n')) {
    // `---`/`+++` file headers would otherwise be counted as content, so
    // nothing counts until the first hunk header.
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('~') || line.startsWith('\\')) continue;

    const words = line.slice(1).trim().split(/\s+/).filter(Boolean).length;
    if (line.startsWith('+')) added += words;
    else if (line.startsWith('-')) removed += words;
  }

  return { added, removed };
}

/** `(+212 -18 words)`, or empty when nothing measurable changed. */
export function formatStat({ added, removed }: WordStat): string {
  if (added === 0 && removed === 0) return '';
  const parts = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  return `(${parts.join(' ')} word${added + removed === 1 ? '' : 's'})`;
}

export type CommitOptions = {
  paths: string[];
  message: string;
  /** Replace HEAD instead of stacking a new commit. Caller must have proved
   *  HEAD is its own commit first. */
  amend?: boolean;
};

/**
 * Stage and commit exactly `paths`.
 *
 * `add` runs first because a bare `git commit -- <newfile>` fails on untracked
 * files ("pathspec did not match"); the pathspec on `commit` then keeps the
 * scope tight regardless of what else may be staged.
 */
export async function stagePaths(paths: string[]): Promise<void> {
  await git().raw(['add', '--', ...paths]);
}

export async function commitPaths({ paths, message, amend }: CommitOptions): Promise<string> {
  await stagePaths(paths);

  const args = ['commit'];
  if (amend) args.push('--amend');
  args.push('-m', message, '--', ...paths);
  await git().raw(args);

  const sha = await headSha();
  if (!sha) throw new Error('Commit produced no HEAD.');
  return sha;
}

/**
 * Undo our own last commit, keeping the working tree untouched.
 *
 * Used when a session round-trips to nothing: the user types, we commit, then
 * they undo back to the original before the session ends. Amending would
 * produce a tree identical to the parent and git refuses that. Safe only
 * because the caller has already proved HEAD is this app's commit.
 */
export async function dropHeadCommit(paths: string[]): Promise<void> {
  await git().raw(['reset', '--soft', 'HEAD~1']);
  // `--soft` leaves the dropped commit's tree staged, which would leave the
  // index dirty at rest and let the next commit sweep it back in. Unstage the
  // paths it touched; the working tree is untouched throughout.
  await git().raw(['reset', '-q', 'HEAD', '--', ...paths]);
}

/** Message subject, capped so `git log --oneline` stays readable. */
export function subject(text: string, max = 72): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
