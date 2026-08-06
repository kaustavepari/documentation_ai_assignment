import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { baseName, dirName, isCaseOnlyRename } from '../paths';
import { applySplices, buildSplicesForFile, planLinkRewrite } from '../links/rewrite';
import { INDEX_PATHSPEC } from './config';
import { commitPaths, headSha, shortSha, stagePaths, subject } from './commit';
import { git } from './git';
import { buildIndexEntries, listNotes, writeIndex } from './index-file';
import { buildRepoLinkIndex, getBacklinkSummary } from './link-index';
import { repoLock } from './mutex';
import { readNote, resolveNotePath, toEol } from './notes';
import { PathError } from './paths';
import { endSession, flushAll } from './sessions';

/**
 * Create/rename/move/delete, on top of everything the autosave/commit layer
 * already built. The shape is the one `commit-strategy.md` §9 already
 * specified: quiesce every open editing session first (so a structural
 * commit can never sweep in someone's half-typed paragraph, and so there is
 * a clean rollback point), then validate, mutate, rewrite links, update the
 * index, and commit everything touched in one commit.
 *
 * Create has no function here — it doesn't need one. Confirming a name opens
 * a normal editor session at that path with a sentinel `baseHash`
 * (`NEW_FILE_HASH`, see `lib/paths.ts`), and the existing autosave/session
 * pipeline in `sessions.ts` does the rest unmodified; see the patch to
 * `writeNote` in `notes.ts`.
 */

export class ConflictError extends Error {}
export class RestoreConflictError extends Error {}

async function withQuiescedTransaction<T>(work: () => Promise<T>): Promise<T> {
  return repoLock.run(async () => {
    await flushAll();
    return work();
  });
}

/**
 * `git mv`/`git rm` already stage a path's removal — the index has nothing
 * left there to "add". Running `git add` on that same path again (which the
 * ordinary `commitPaths` helper does unconditionally, since every other
 * caller in this app only ever commits paths that still exist) fails with
 * "pathspec did not match any files". So structural commits split the two
 * lists: `addPaths` are the genuinely new/changed content `git add` needs to
 * pick up; `commitPathspec` is everything the commit should include,
 * which also has to name the already-vanished path so the commit captures
 * the paired removal (and, for a rename, so git's similarity detection
 * recognises it as one — the mechanical test for "history survives").
 */
async function commitStructural(
  addPaths: string[],
  commitPathspec: string[],
  message: string,
): Promise<string> {
  await stagePaths(addPaths);
  await git().raw(['commit', '-m', message, '--', ...commitPathspec]);
  const sha = await headSha();
  if (!sha) throw new Error('Commit produced no HEAD.');
  return sha;
}

/**
 * `core.ignorecase` (which git auto-sets `true` on Windows/macOS — confirmed
 * on this repo) makes a pathspec-scoped commit blind to a change whose old
 * and new paths differ only in case: both spellings fold to the same
 * pathspec string, and `git commit -- <that pathspec>` reports "nothing to
 * commit" even though `git status` still shows the staged rename correctly.
 * Verified empirically against a scratch clone, not assumed — every other
 * pathspec combination tried (old only, new only, both) either silently
 * dropped the rename or hit git's own "will not add file alias" guard.
 *
 * The only reliable fix is an unscoped commit for this one case. Safe
 * specifically because the staged set is verified first: if anything beyond
 * what this rename touched is staged, this throws rather than silently
 * folding someone else's change into the commit — the same guarantee every
 * pathspec-scoped commit elsewhere in this app already has.
 */
async function commitCaseOnlyRename(
  addPaths: string[],
  expectedStaged: string[],
  message: string,
): Promise<string> {
  await stagePaths(addPaths);

  const stagedRaw = await git().raw(['diff', '--cached', '--name-only', '-z']);
  const staged = stagedRaw.split('\0').filter(Boolean);
  const unexpected = staged.filter((p) => !expectedStaged.includes(p));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected staged changes before a case-only rename: ${unexpected.join(', ')}`);
  }

  await git().raw(['commit', '-m', message]);
  const sha = await headSha();
  if (!sha) throw new Error('Commit produced no HEAD.');
  return sha;
}

async function exists(relPath: string): Promise<boolean> {
  return fs.access(resolveNotePath(relPath)).then(
    () => true,
    () => false,
  );
}

/**
 * Best-effort undo of a structural operation that failed partway through,
 * before its commit landed. Two different repairs are needed depending on
 * whether a path existed at HEAD: a path that existed (the source, or any
 * link-rewritten file) is restored with `checkout`; a path that is brand
 * new (the rename/move destination) never existed at HEAD, so `checkout`
 * would error on it — it's just deleted instead.
 */
async function rollbackStructural(existedAtHead: string[], newOnly: string[]): Promise<void> {
  const staged = [...new Set([...existedAtHead, ...newOnly, INDEX_PATHSPEC])];
  await git()
    .raw(['reset', 'HEAD', '--', ...staged])
    .catch(() => undefined);

  const toRestore = [...new Set([...existedAtHead, INDEX_PATHSPEC])];
  await git()
    .raw(['checkout', 'HEAD', '--', ...toRestore])
    .catch(() => undefined);

  for (const relPath of newOnly) {
    await fs.rm(resolveNotePath(relPath), { force: true }).catch(() => undefined);
  }
}

function composeRenameMessage(title: string, oldPath: string, newPath: string, rewrittenFiles: string[]): string {
  const sameDir = dirName(oldPath) === dirName(newPath);
  const sameName = baseName(oldPath) === baseName(newPath);

  let verb: string;
  let dest: string;
  if (sameDir) {
    verb = 'Rename';
    dest = baseName(newPath);
  } else if (sameName) {
    verb = 'Move';
    dest = `${dirName(newPath)}/`;
  } else {
    verb = 'Move and rename';
    dest = newPath;
  }

  const linkCount = rewrittenFiles.length;
  const suffix = linkCount > 0 ? ` (${linkCount} link${linkCount === 1 ? '' : 's'} updated)` : '';
  const subjectLine = subject(`${verb} "${title}" → ${dest}${suffix}`);

  if (linkCount === 0) return subjectLine;
  return [subjectLine, '', 'Links updated:', ...rewrittenFiles.map((p) => `  ${p}`)].join('\n');
}

export type RenameResult = { sha: string; short: string; message: string; rewrittenFiles: string[] };

export async function renameNote({
  oldPath,
  newPath,
  rewriteLinks,
}: {
  oldPath: string;
  newPath: string;
  rewriteLinks: boolean;
}): Promise<RenameResult> {
  if (oldPath === newPath) throw new PathError('Source and destination are the same.');

  return withQuiescedTransaction(async () => {
    resolveNotePath(oldPath);
    resolveNotePath(newPath);

    if (!(await exists(oldPath))) throw new PathError(`No such note: ${oldPath}`);

    const caseOnly = isCaseOnlyRename(oldPath, newPath);
    if (!caseOnly && (await exists(newPath))) {
      throw new ConflictError(`Already exists: ${newPath}`);
    }

    const title = (await readNote(oldPath)).title;

    const [index, notes] = await Promise.all([buildRepoLinkIndex(), listNotes()]);
    const notePaths = notes.map((n) => n.path);
    const titleByPath = new Map(notes.map((n) => [n.path, n.title]));
    const plan = planLinkRewrite(index, oldPath, newPath, notePaths, titleByPath);

    const touchedLinkFiles = rewriteLinks ? [...new Set(plan.fixable.map((f) => f.sourcePath))] : [];
    const existedAtHead = [oldPath, ...touchedLinkFiles.filter((p) => p !== oldPath)];

    try {
      await fs.mkdir(path.dirname(resolveNotePath(newPath)), { recursive: true });

      if (caseOnly) {
        const tmp = `${oldPath}.tmp-${Date.now()}`;
        await git().raw(['mv', oldPath, tmp]);
        await git().raw(['mv', tmp, newPath]);
      } else {
        await git().raw(['mv', oldPath, newPath]);
      }

      const rewrittenFiles: string[] = [];
      for (const sourcePath of touchedLinkFiles) {
        // The moved note itself already lives at newPath now; every other
        // touched file hasn't been touched on disk yet.
        const readPath = sourcePath === oldPath ? newPath : sourcePath;
        const splices = buildSplicesForFile(sourcePath, index, oldPath, newPath);
        if (splices.length === 0) continue;

        const note = await readNote(readPath);
        const rewritten = applySplices(note.content, splices);
        await fs.writeFile(resolveNotePath(readPath), Buffer.from(toEol(rewritten, note.eol), 'utf8'));
        rewrittenFiles.push(readPath);
      }

      await writeIndex(await buildIndexEntries());

      const message = composeRenameMessage(title, oldPath, newPath, rewrittenFiles);
      const addPaths = [...new Set([newPath, ...rewrittenFiles, INDEX_PATHSPEC])];

      const sha = caseOnly
        ? await commitCaseOnlyRename(addPaths, addPaths, message)
        : await commitStructural(addPaths, [...new Set([oldPath, ...addPaths])], message);

      endSession(oldPath);

      return { sha, short: await shortSha(sha), message, rewrittenFiles };
    } catch (error) {
      await rollbackStructural(existedAtHead, [newPath]);
      throw error;
    }
  });
}

export type DeleteResult = { sha: string; short: string; message: string };

export async function deleteNote({ path: relPath }: { path: string }): Promise<DeleteResult> {
  return withQuiescedTransaction(async () => {
    resolveNotePath(relPath);
    if (!(await exists(relPath))) throw new PathError(`No such note: ${relPath}`);

    const [summary, note] = await Promise.all([getBacklinkSummary(relPath), readNote(relPath)]);

    try {
      await git().raw(['rm', '--', relPath]);
      await writeIndex(await buildIndexEntries());

      const bodyLines =
        summary && summary.count > 0
          ? [
              '',
              `${summary.count} note${summary.count === 1 ? '' : 's'} link here; their links now dangle:`,
              ...summary.backlinks.map((b) => `  ${b.sourcePath}`),
            ]
          : [];
      // No literal sha here — a commit cannot name its own final hash inside
      // its own message (the hash is computed over the message, so amending
      // one to add the other just produces a different hash, forever one
      // step behind). Tried it, confirmed the mismatch empirically: the
      // amended commit's real sha never matches whatever was embedded before
      // the amend. `git log` already shows this commit's sha right next to
      // its subject, so "revert this commit" is unambiguous without
      // repeating a sha that can't actually be made accurate.
      const message = [
        subject(`Delete "${note.title}" — ${relPath}`),
        ...bodyLines,
        '',
        'Restore: git revert this commit.',
      ].join('\n');

      const sha = await commitStructural([INDEX_PATHSPEC], [relPath, INDEX_PATHSPEC], message);

      endSession(relPath);
      return { sha, short: await shortSha(sha), message };
    } catch (error) {
      await rollbackStructural([relPath, INDEX_PATHSPEC], []);
      throw error;
    }
  });
}

export type RestoreResult = { sha: string; short: string; path: string; title: string };

export async function restoreNote({ sha }: { sha: string }): Promise<RestoreResult> {
  return withQuiescedTransaction(async () => {
    try {
      await git().raw(['revert', '--no-commit', sha]);
    } catch {
      await git()
        .raw(['revert', '--abort'])
        .catch(() => undefined);
      throw new RestoreConflictError(
        'Could not restore — something else has since changed this path.',
      );
    }

    const touchedRaw = await git().raw(['diff', '--cached', '--name-only', '-z']);
    const touched = touchedRaw.split('\0').filter(Boolean);
    const restoredPath = touched.find((p) => p !== INDEX_PATHSPEC);
    if (!restoredPath) {
      await git()
        .raw(['reset', '--hard', 'HEAD'])
        .catch(() => undefined);
      throw new Error('Restore produced no note.');
    }

    const note = await readNote(restoredPath);
    const short = await shortSha(sha);
    const message = `Restore "${note.title}" — undo of ${short}`;
    const shaOut = await commitPaths({ paths: touched, message });

    return { sha: shaOut, short: await shortSha(shaOut), path: restoredPath, title: note.title };
  });
}
