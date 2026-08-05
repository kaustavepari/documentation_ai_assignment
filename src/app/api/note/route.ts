import { readNote, writeNote } from '@/lib/server/notes';
import { PathError } from '@/lib/server/paths';

/**
 * Notes are addressed by their full repo-relative path, passed as a single
 * query parameter: `/api/note?path=notes%2Fpersonal%2Fjournal%2F%F0%9F%8E%89%20first-day.md`.
 *
 * One encoded parameter rather than a path segment per folder. The three
 * awkward filenames in this repo (spaces, parentheses, an emoji) are exactly
 * what per-segment encoding gets wrong, and those are the files Rule 1 is
 * checking. Encoding exists only inside the URL — everything behind this line
 * works with the real path.
 */
function requirePath(request: Request): string {
  const path = new URL(request.url).searchParams.get('path');
  if (!path) throw new PathError('Missing ?path=');
  return path;
}

export async function GET(request: Request) {
  try {
    return Response.json(await readNote(requirePath(request)));
  } catch (error) {
    return failure(error);
  }
}

type SaveRequest = { path: string; content: string; baseHash: string };

export async function PUT(request: Request) {
  let body: SaveRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { path, content, baseHash } = body ?? {};
  if (typeof path !== 'string' || typeof content !== 'string' || typeof baseHash !== 'string') {
    return Response.json(
      { error: 'Expected { path, content, baseHash } as strings.' },
      { status: 400 },
    );
  }

  try {
    const result = await writeNote(path, content, baseHash);
    if (!result.ok) {
      // 409 is the honest status: the request was well-formed, the note simply
      // moved underneath it. The client is handed the current content so it
      // can show both sides rather than just refusing.
      return Response.json(
        {
          error: 'conflict',
          message: 'This note changed on disk since you opened it.',
          currentHash: result.currentHash,
          currentContent: result.currentContent,
        },
        { status: 409 },
      );
    }
    return Response.json({ hash: result.hash, title: result.title });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): Response {
  if (error instanceof PathError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (isNodeError(error) && error.code === 'ENOENT') {
    return Response.json({ error: 'No such note.' }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : 'Unknown error.';
  return Response.json({ error: message }, { status: 500 });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
