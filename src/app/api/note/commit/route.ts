import { readNote, writeNote } from '@/lib/server/notes';
import { PathError } from '@/lib/server/paths';
import { flushSession, touchSession } from '@/lib/server/sessions';
import { ConflictError, deleteNote, renameNote } from '@/lib/server/structural';

/**
 * Replays staged changes through the app's existing save pipeline for real.
 *
 * Deliberately not a new write path: `writeNote` is the same function
 * `/api/note`'s PUT already calls (same conflict check, same atomic-create
 * handling for a not-yet-real note via the `NEW_FILE_HASH` sentinel);
 * `touchSession`/`flushSession` are the same functions that decide the
 * commit message (`Create`/`Retitle`/`Edit`) today; `renameNote` is the same
 * function `/api/note/rename` already calls, producing the same
 * `Rename`/`Move`/`Move and rename` message and the same fixable-link
 * rewriting; `deleteNote` is the same function `/api/note/delete` already
 * calls, producing the same `Delete` message with the same dangling-links
 * summary (recomputed fresh here, from the repo as it actually is right
 * now — not from whatever the client saw when the delete was staged, which
 * could be stale by commit time). This endpoint only adds the loop that
 * drives them from a staged batch instead of one live UI action.
 *
 * Each op is independent: one op's failure (typically its `baseHash` no
 * longer matching disk, or its destination now existing) does not stop the
 * rest from committing. The client is the one that decides what to do with
 * a mixed result — clear what succeeded, keep what didn't staged with its
 * reason.
 */
type CommitOp = {
  path: string;
  content?: string;
  baseHash?: string;
  newPath?: string;
  rewriteLinks?: boolean;
  delete?: boolean;
};

type OpResult =
  | { path: string; ok: true; commit: string | null; hash: string; title: string; newPath?: string }
  | { path: string; ok: false; error: string };

export async function POST(request: Request) {
  let body: { ops?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const ops = body?.ops;
  if (!Array.isArray(ops)) {
    return Response.json({ error: 'Expected { ops: [...] }.' }, { status: 400 });
  }

  const results: OpResult[] = [];
  for (const raw of ops) {
    const op = raw as Partial<CommitOp>;
    if (typeof op.path !== 'string') {
      results.push({ path: '(unknown)', ok: false, error: 'Malformed staged change.' });
      continue;
    }
    const hasContent = op.content !== undefined;
    const hasRename = op.newPath !== undefined;
    const hasDelete = op.delete === true;
    if (
      (hasContent && typeof op.content !== 'string') ||
      (hasRename && typeof op.newPath !== 'string') ||
      (!hasContent && !hasRename && !hasDelete)
    ) {
      results.push({ path: op.path, ok: false, error: 'Malformed staged change.' });
      continue;
    }
    results.push(
      await commitOne({
        path: op.path,
        content: op.content,
        baseHash: op.baseHash ?? '',
        newPath: op.newPath,
        rewriteLinks: op.rewriteLinks ?? false,
        delete: hasDelete,
      }),
    );
  }

  return Response.json({ results });
}

async function commitOne(
  op: Required<Pick<CommitOp, 'path' | 'baseHash' | 'rewriteLinks' | 'delete'>> & Pick<CommitOp, 'content' | 'newPath'>,
): Promise<OpResult> {
  const { path: originalPath, content, baseHash, newPath, rewriteLinks, delete: shouldDelete } = op;

  try {
    // A staged delete wins outright — whatever else might also be staged
    // for this identity (it can't be, in practice: `upsertDelete` drops
    // content/newPath the moment a delete is staged) is moot once the note
    // itself is going away.
    if (shouldDelete) {
      const result = await deleteNote({ path: originalPath });
      return { path: originalPath, ok: true, commit: result.short, hash: '', title: result.title };
    }

    // Renamed identities may also carry staged content — the note was
    // renamed *and* edited before commit. Rename first (matching the order
    // the two would have happened live), then write the staged content at
    // its new home. Two separate commits, same as if the user had done both
    // for real one after another; collapsing that into one commit is
    // ticket 08's "net effect" territory, not this ticket's.
    let path = originalPath;
    let renamedTo: string | undefined;

    if (newPath !== undefined) {
      const rename = await renameNote({ oldPath: originalPath, newPath, rewriteLinks });
      path = newPath;
      renamedTo = newPath;
      if (content === undefined) {
        const after = await readNote(path);
        return { path: originalPath, ok: true, commit: rename.short, hash: after.hash, title: after.title, newPath: renamedTo };
      }
    }

    if (content !== undefined) {
      // A rename's own commit already wrote real bytes at `path`; the
      // `baseHash` staged alongside the *original* edit refers to the
      // pre-rename file and would no longer match — re-read to get the
      // hash the edit actually needs to check against.
      const editBaseHash = renamedTo ? (await readNote(path)).hash : baseHash;
      const result = await writeNote(path, content, editBaseHash);
      if (!result.ok) {
        return {
          path: originalPath,
          ok: false,
          error: renamedTo
            ? 'Renamed successfully, but the staged edit on top of it could not be written — retry the edit.'
            : 'This note changed since it was staged — refusing to overwrite it.',
        };
      }

      touchSession(path);
      // Always flush, never leave this as a "wait for the idle window"
      // session: a staged batch is an explicit, deliberate action, the same
      // weight as Ctrl+S.
      const commit = await flushSession(path);
      return { path: originalPath, ok: true, commit: commit?.short ?? null, hash: result.hash, title: result.title, newPath: renamedTo };
    }

    return { path: originalPath, ok: false, error: 'Malformed staged change: nothing to commit.' };
  } catch (error) {
    const message =
      error instanceof PathError || error instanceof ConflictError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Commit failed.';
    return { path: originalPath, ok: false, error: message };
  }
}
