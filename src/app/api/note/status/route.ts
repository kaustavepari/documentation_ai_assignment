import fs from 'node:fs/promises';

import { git } from '@/lib/server/git';
import { hashOf } from '@/lib/server/notes';
import { PathError, resolveInRepo } from '@/lib/server/paths';
import { isPending } from '@/lib/server/sessions';

/**
 * Where a note stands between the two guarantees, plus its current on-disk
 * hash — the latter lets a client that already has a note open ask "did this
 * change under me?" for the price of a stat-and-hash, without pulling the
 * full content across the wire just to find out.
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
    const abs = resolveInRepo(path); // reject traversal before it reaches git or fs

    const [shaRaw, hash] = await Promise.all([
      git().raw(['log', '-1', '--format=%h', '--', path]),
      // null distinguishes "no file here right now" (deleted elsewhere) from
      // any other hash — the client must not confuse the two.
      fs.readFile(abs).then(hashOf).catch(() => null),
    ]);
    return Response.json({ pending: isPending(path), commit: shaRaw.trim() || null, hash });
  } catch (error) {
    if (error instanceof PathError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ pending: false, commit: null, hash: null });
  }
}
