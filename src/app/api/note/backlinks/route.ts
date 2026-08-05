import { getBacklinkSummary } from '@/lib/server/link-index';
import { PathError } from '@/lib/server/paths';

/** Same single encoded `?path=` convention as `/api/note`. */
function requirePath(request: Request): string {
  const path = new URL(request.url).searchParams.get('path');
  if (!path) throw new PathError('Missing ?path=');
  return path;
}

export async function GET(request: Request) {
  try {
    const path = requirePath(request);
    const summary = await getBacklinkSummary(path);
    if (!summary) {
      return Response.json({ error: 'No such note.' }, { status: 404 });
    }
    return Response.json(summary);
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
