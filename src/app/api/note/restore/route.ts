import { RestoreConflictError, restoreNote } from '@/lib/server/structural';

type Body = { sha: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { sha } = body ?? {};
  if (typeof sha !== 'string') {
    return Response.json({ error: 'Expected { sha }.' }, { status: 400 });
  }

  try {
    const result = await restoreNote({ sha });
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): Response {
  if (error instanceof RestoreConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : 'Unknown error.';
  return Response.json({ error: message }, { status: 500 });
}
