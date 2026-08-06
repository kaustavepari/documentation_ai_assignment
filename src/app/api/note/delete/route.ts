import { deleteNote } from '@/lib/server/structural';
import { PathError } from '@/lib/server/paths';

type Body = { path: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { path } = body ?? {};
  if (typeof path !== 'string') {
    return Response.json({ error: 'Expected { path }.' }, { status: 400 });
  }

  try {
    const result = await deleteNote({ path });
    return Response.json(result);
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
