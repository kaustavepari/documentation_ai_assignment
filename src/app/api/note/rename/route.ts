import { ConflictError, renameNote } from '@/lib/server/structural';
import { PathError } from '@/lib/server/paths';

/**
 * Also the move endpoint — a rename and a move are the same `git mv` under
 * the hood (`structural.ts`), only the UI trigger differs. `rewriteLinks`
 * is the client's answer to the link-impact modal: true after "Fix what can
 * be fixed", false after "Leave as-is" or when nothing was affected at all.
 */
type Body = { oldPath: string; newPath: string; rewriteLinks: boolean };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { oldPath, newPath, rewriteLinks } = body ?? {};
  if (typeof oldPath !== 'string' || typeof newPath !== 'string' || typeof rewriteLinks !== 'boolean') {
    return Response.json(
      { error: 'Expected { oldPath, newPath, rewriteLinks }.' },
      { status: 400 },
    );
  }

  try {
    const result = await renameNote({ oldPath, newPath, rewriteLinks });
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): Response {
  if (error instanceof PathError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : 'Unknown error.';
  return Response.json({ error: message }, { status: 500 });
}
