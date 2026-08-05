import { git } from '@/lib/server/git';
import { PathError, resolveInRepo } from '@/lib/server/paths';
import { isPending } from '@/lib/server/sessions';

/**
 * Where a note stands between the two guarantees.
 *
 * An autosave answers "is it on disk?" immediately, but the commit happens a
 * quiet moment later, with no request in flight to carry the news back. Rather
 * than hold a socket open for a state that changes once, the client asks again
 * shortly after it stops typing.
 */
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path');
  try {
    if (!path) throw new PathError('Missing ?path=');
    resolveInRepo(path); // reject traversal before it reaches git

    const sha = (await git().raw(['log', '-1', '--format=%h', '--', path])).trim();
    return Response.json({ pending: isPending(path), commit: sha || null });
  } catch (error) {
    if (error instanceof PathError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ pending: false, commit: null });
  }
}
