import AppShell from '@/components/AppShell';
import NoteEditor from '@/components/NoteEditor';
import { NEW_FILE_HASH } from '@/lib/paths';
import { checkRepo } from '@/lib/server/config';
import { listNotes } from '@/lib/server/index-file';
import { readNote, resolveNotePath } from '@/lib/server/notes';
import { PathError } from '@/lib/server/paths';
import { listOutsideNotes } from '@/lib/server/walk';
import { buildTree } from '@/lib/tree';
import { titleFor } from '@/lib/titles';

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

  const { path, new: isNew } = await props.searchParams;
  const selected = typeof path === 'string' ? path : undefined;

  const [notes, otherFiles] = await Promise.all([listNotes(), listOutsideNotes()]);
  const tree = buildTree(notes);
  const repoFiles = [...notes.map((n) => n.path), ...otherFiles];

  let note = null;
  let openError: string | null = null;
  if (selected) {
    try {
      if (isNew === '1') {
        // A brand-new note: confirming its name never touched disk (see
        // structural.ts's crud-operations-spec.md-driven design), so there's
        // nothing to read yet. `resolveNotePath` still runs, unused beyond
        // its validation, so a path that escapes `notes/` fails the same way
        // an ordinary open would rather than silently stubbing anything.
        resolveNotePath(selected);
        note = { path: selected, title: titleFor(selected, ''), content: '', hash: NEW_FILE_HASH };
      } else {
        note = await readNote(selected);
      }
    } catch (error) {
      openError =
        error instanceof PathError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Could not open that note.';
    }
  }

  return (
    <AppShell tree={tree} noteCount={notes.length} selected={selected}>
      {note ? (
        // Keyed by path so switching notes gives a fresh editor rather than
        // one holding the previous note's unsaved text.
        <NoteEditor key={note.path} note={note} notes={notes} repoFiles={repoFiles} />
      ) : (
        <Empty message={openError} />
      )}
    </AppShell>
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
