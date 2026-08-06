import { planLinkRewrite } from '@/lib/links/rewrite';
import { listNotes } from '@/lib/server/index-file';
import { buildRepoLinkIndex } from '@/lib/server/link-index';
import { PathError } from '@/lib/server/paths';

/**
 * Read-only preview for a rename/move: what would break and what's safe to
 * fix, computed before any git operation happens so the client can show the
 * link-impact modal (or skip it entirely when nothing's affected) prior to
 * committing to the mutation.
 */
type Body = { oldPath: string; newPath: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { oldPath, newPath } = body ?? {};
  if (typeof oldPath !== 'string' || typeof newPath !== 'string') {
    return Response.json({ error: 'Expected { oldPath, newPath } as strings.' }, { status: 400 });
  }

  try {
    const [index, notes] = await Promise.all([buildRepoLinkIndex(), listNotes()]);
    const notePaths = notes.map((n) => n.path);
    const titleByPath = new Map(notes.map((n) => [n.path, n.title]));
    const plan = planLinkRewrite(index, oldPath, newPath, notePaths, titleByPath);
    return Response.json(plan);
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): Response {
  if (error instanceof PathError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : 'Unknown error.';
  return Response.json({ error: message }, { status: 500 });
}
