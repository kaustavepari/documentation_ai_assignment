import 'server-only';

import fs from 'node:fs/promises';

import { titleFor } from '../titles';
import {
  commitPaths,
  dropHeadCommit,
  formatStat,
  hasChangesAgainst,
  headSha,
  shortSha,
  stagePaths,
  subject,
  wordStat,
} from './commit';
import { INDEX_PATHSPEC } from './config';
import { git } from './git';
import { buildIndexEntries, writeIndex } from './index-file';
import { repoLock } from './mutex';
import { resolveInRepo } from './paths';

/**
 * The commit layer.
 *
 * Autosave writes bytes to disk; this decides when those bytes become history.
 * The two are deliberately separate: committing on every keystroke makes the
 * log useless, and committing only on an explicit Save loses work when a laptop
 * closes.
 *
 * The unit is an **editing session** — one note, one continuous stretch of
 * work, one commit. While a session is open its commit is amended rather than
 * added to, so a five-minute stretch of typing is one line in `git log` instead
 * of twenty.
 *
 * Note what is *not* here: nothing scans `git status` to decide what to commit.
 * A sweeper would find a flat set of dirty paths and have to reconstruct which
 * of them belong together, and that grouping was never in the filesystem — it
 * existed only at the moment the user acted. The app is the authority on
 * intent; git only records it. The one place that does look at a flat dirty
 * tree is startup recovery, and it refuses to guess (see `recovery.ts`).
 */

/** Idle gap after which a note's work is written to history. */
const COMMIT_IDLE_MS = 15_000;

/**
 * After this long, a session's commit stops being amended and finalises.
 *
 * Arbitrary, and worth being honest about: its job is not to make the log
 * meaningful but to make commits *settle*. An amend chain running for hours
 * means the commit someone saw earlier keeps being replaced.
 */
const SETTLE_MS = 10 * 60_000;

type Session = {
  path: string;
  startedAt: number;
  /** null until this session has committed once; enables the amend check. */
  ourCommitSha: string | null;
  /**
   * Whether anything has been written since the last commit.
   *
   * Without this, a second flush with no new typing — two Ctrl+S in a row, or
   * a quiesce right after an idle commit — would amend the commit again and
   * hand it a new sha for an identical tree. Harmless to the repo, but it
   * churns the commit id the user is being shown.
   */
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

/** One entry per note with unwritten history. One entry = one future commit. */
const sessions = new Map<string, Session>();

export type CommitInfo = { sha: string; short: string; message: string };

/**
 * Record that a note was just autosaved.
 *
 * Restarts *that note's* idle timer and nothing else — a trailing-edge debounce
 * per note, not a global sweep. Two notes edited a second apart keep two
 * independent timers and become two commits, because they are two intents.
 */
export function touchSession(path: string): void {
  const existing = sessions.get(path);
  const session: Session = existing ?? {
    path,
    startedAt: Date.now(),
    ourCommitSha: null,
    dirty: false,
    timer: null,
  };
  session.dirty = true;

  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    void flushSession(path).catch(() => undefined);
  }, COMMIT_IDLE_MS);

  sessions.set(path, session);
}

/** Whether a note has work on disk that is not yet in history. */
export function isPending(path: string): boolean {
  return sessions.has(path);
}

/**
 * Commit a note's session now instead of waiting out the idle timer.
 *
 * Called on Ctrl+S, on navigating away, on tab close, and before any structural
 * operation. All of those *flush*; none of them *seal*. The distinction
 * matters: sealing on navigation would fragment the common "pop over to another
 * note and come back" pattern into a commit per lookup.
 */
export async function flushSession(path: string): Promise<CommitInfo | null> {
  // A session may not exist yet — pressing Ctrl+S inside the autosave debounce
  // reaches here before the first idle write ever opened one. "Commit this
  // note's outstanding work now" is still the right answer, so open a session
  // rather than returning null and stranding the change on disk.
  const session: Session = sessions.get(path) ?? {
    path,
    startedAt: Date.now(),
    ourCommitSha: null,
    dirty: true,
    timer: null,
  };
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  sessions.set(path, session);

  if (!session.dirty) return null;
  return repoLock.run(() => commitSession(session));
}

/**
 * Same work as `flushSession`, but assumes the caller already holds
 * `repoLock` — used only by `flushAll`.
 *
 * `flushAll` only ever runs from inside `withQuiescedTransaction`'s own
 * `repoLock.run` callback (`structural.ts`). `Mutex.run` is a plain FIFO
 * chain, not reentrant: calling it again from inside a job it's already
 * running queues the new job behind that same still-pending job, which can
 * never resolve first because it's the one waiting on the new job. That
 * deadlock was real, not theoretical — a structural op (rename/delete/
 * restore) starting while any note had unflushed autosave work in its
 * 15-second idle window would hang forever with the lock wedged for the
 * whole app, not just that request.
 */
async function flushSessionLocked(path: string): Promise<CommitInfo | null> {
  const session = sessions.get(path);
  if (!session) return null;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  if (!session.dirty) return null;
  return commitSession(session);
}

/**
 * Commit every open session.
 *
 * Structural operations call this first. It gives them two things at once: a
 * clean boundary, so a rename's commit cannot sweep in someone's half-typed
 * paragraph, and a rollback point, since `git checkout HEAD -- <paths>` is only
 * safe when nothing uncommitted is in the tree.
 */
export async function flushAll(): Promise<CommitInfo[]> {
  const open = [...sessions.keys()];
  const done: CommitInfo[] = [];
  for (const path of open) {
    const info = await flushSessionLocked(path);
    if (info) done.push(info);
  }
  return done;
}

/** Forget a note's session — used when the note stops existing under that path. */
export function endSession(path: string): void {
  const session = sessions.get(path);
  if (session?.timer) clearTimeout(session.timer);
  sessions.delete(path);
}

/** Caller must hold `repoLock`. */
async function commitSession(session: Session): Promise<CommitInfo | null> {
  const { path } = session;
  const head = await headSha();
  if (!head) return null;

  // Amend only when HEAD is still this session's own commit. That check is not
  // just a safety net: it *is* the continuity rule. If anything committed in
  // between — another note, a rename — the episode was interrupted and the work
  // genuinely deserves its own commit.
  const canAmend =
    session.ourCommitSha !== null &&
    head === session.ourCommitSha &&
    Date.now() - session.startedAt < SETTLE_MS;

  const base = canAmend ? `${head}~1` : head;

  if (!(await hasChangesAgainst(base, [path]))) {
    // Net change of nothing. If we already committed this session, the user
    // typed and then undid it — drop our commit so the log shows what actually
    // happened, which is nothing. `--soft` leaves the working tree alone, and
    // this is only reachable having proved HEAD is ours.
    if (canAmend) await dropHeadCommit([path, INDEX_PATHSPEC]);
    endSession(path);
    return null;
  }

  const current = await fs.readFile(resolveInRepo(path), 'utf8').catch(() => null);
  if (current === null) {
    endSession(path);
    return null;
  }

  const baseContent = await showAtCommit(base, path);
  const currentTitle = titleFor(path, current.replace(/\r\n/g, '\n'));

  // Staged before measuring: a note git has never tracked is invisible to
  // `git diff`, so a freshly created one would report zero words.
  await stagePaths([path]);
  const stat = formatStat(await wordStat(base, [path]));

  // The verb is a pure function of the diff against the parent, recomputed on
  // every amend rather than accumulated. That is what makes amending
  // self-correcting: a session that ends up creating a note reads `Create`
  // however many times it was amended along the way.
  const paths = [path];
  let message: string;

  if (baseContent === null) {
    message = subject(`Create "${currentTitle}" — ${path}${stat ? ` ${stat}` : ''}`);
    paths.push(INDEX_PATHSPEC);
  } else {
    const baseTitle = titleFor(path, baseContent.replace(/\r\n/g, '\n'));
    if (baseTitle !== currentTitle) {
      message = subject(`Retitle "${baseTitle}" → "${currentTitle}"`);
      paths.push(INDEX_PATHSPEC);
    } else {
      message = subject(`Edit "${currentTitle}"${stat ? ` ${stat}` : ''}`);
    }
  }

  // The index entry changes as part of the same commit as the change that
  // caused it, never as a commit of its own: `git revert` has to put the note
  // and its index entry back in one step.
  if (paths.length > 1) await writeIndex(await buildIndexEntries());

  const sha = await commitPaths({ paths, message, amend: canAmend });
  session.ourCommitSha = sha;
  session.dirty = false;
  // Sessions stay open after committing so continued typing amends rather than
  // stacking. `startedAt` is untouched, so the settle window still bites.
  sessions.set(path, session);

  return { sha, short: await shortSha(sha), message };
}

/** A file's content at a commit, or null if it did not exist there. */
async function showAtCommit(commitish: string, path: string): Promise<string | null> {
  try {
    return await git().raw(['show', `${commitish}:${path}`]);
  } catch {
    return null;
  }
}
