import { listTrash } from '@/lib/server/trash';

export async function GET() {
  try {
    const entries = await listTrash();
    return Response.json(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return Response.json({ error: message }, { status: 500 });
  }
}
