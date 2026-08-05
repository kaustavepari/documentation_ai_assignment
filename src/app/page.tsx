import NoteEditor from '@/components/NoteEditor';
import NoteTree from '@/components/NoteTree';
import { checkRepo } from '@/lib/server/config';
import { listNotes } from '@/lib/server/index-file';
import { readNote } from '@/lib/server/notes';
import { buildTree } from '@/lib/tree';

/**
 * The whole app is one page: the tree on the left, the open note on the right,
 * and `?path=` saying which note that is.
 *
 * A single encoded query parameter rather than a route segment per folder.
 * Three of the 36 filenames contain spaces, parentheses or an emoji, and
 * per-segment encoding is where those go wrong — so there is exactly one place
 * a path gets encoded and exactly one place it gets decoded.
 */
export default async function Home(props: PageProps<'/'>) {
  const repo = checkRepo();
  if (!repo.ok) return <SetupProblem root={repo.root} problem={repo.problem} />;

  const { path } = await props.searchParams;
  const selected = typeof path === 'string' ? path : undefined;

  const notes = await listNotes();
  const tree = buildTree(notes);

  let note = null;
  let openError: string | null = null;
  if (selected) {
    try {
      note = await readNote(selected);
    } catch (error) {
      openError = error instanceof Error ? error.message : 'Could not open that note.';
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <div className="sticky top-0 z-10 border-b border-line bg-surface px-3.5 py-3">
          <p className="text-sm font-semibold text-neutral-200">Notes</p>
          <p className="text-xs text-neutral-500">{notes.length} notes</p>
        </div>
        <NoteTree nodes={tree} selected={selected} />
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {note ? (
          // Keyed by path so switching notes gives a fresh editor rather than
          // one holding the previous note's unsaved text.
          <NoteEditor key={note.path} note={note} />
        ) : (
          <Empty message={openError} />
        )}
      </main>
    </div>
  );
}

function Empty({ message }: { message: string | null }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      {message ? (
        <p className="text-sm text-red-400">{message}</p>
      ) : (
        <p className="text-sm text-neutral-600">Select a note to start reading.</p>
      )}
    </div>
  );
}

function SetupProblem({ root, problem }: { root: string; problem: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-lg space-y-3">
        <h1 className="text-base font-semibold text-neutral-100">
          Cannot read the notes repository
        </h1>
        <p className="text-sm text-neutral-400">{problem}</p>
        <p className="font-mono text-xs break-all text-neutral-500">{root}</p>
        <p className="text-sm text-neutral-400">
          Set <code className="font-mono text-neutral-300">NOTES_REPO_PATH</code> in{' '}
          <code className="font-mono text-neutral-300">.env.local</code> and restart.
        </p>
      </div>
    </main>
  );
}
