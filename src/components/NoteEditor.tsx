'use client';

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AmbiguousLinkOverlay from '@/components/editor/AmbiguousLinkOverlay';
import LinksMenu from '@/components/editor/LinksMenu';
import { linkDecorations, type AmbiguousLink } from '@/components/editor/linkDecorations';
import { dirName, NEW_FILE_HASH } from '@/lib/paths';
import { parseLinks } from '@/lib/links/parse';
import { resolveLink } from '@/lib/links/resolve';

/**
 * Clears CodeMirror's own defaults (a light background, its own font stack)
 * so the editing surface inherits the wrapper's Tailwind styling instead of
 * introducing a second, separate theme system alongside the app's existing
 * dark palette.
 */
const editorTheme = EditorView.theme(
  {
    // No forced height here on purpose: the editor sizes to its own
    // content, and the *wrapper* around editor+LinksPanel scrolls as one
    // region. Forcing height:100% on a short note left a dead gap between
    // the last line and the panel, which read as the panel floating,
    // pinned to the bottom of the screen.
    '&': { backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: 'inherit' },
    '.cm-content': {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      padding: '1.5rem 2.5rem',
      caretColor: 'currentColor',
    },
    '.cm-line': { padding: 0 },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': { display: 'none' },
  },
  { dark: true },
);

/** Only what the browser needs. The server's `Note` also carries line endings. */
type EditableNote = { path: string; title: string; content: string; hash: string };
type NoteEntry = { path: string; title: string };

type Status = 'clean' | 'editing' | 'saving' | 'onDisk' | 'committed' | 'error' | 'conflict';

/** Long enough not to fire mid-word, short enough that nobody notices waiting. */
const AUTOSAVE_DELAY_MS = 800;

/**
 * When to ask whether the commit has landed.
 *
 * The server commits after 15s of quiet. Nothing is in flight at that moment,
 * so the pill would otherwise sit on "Saved to disk" forever even though the
 * work reached history. One poll, slightly after the server's own window.
 */
const COMMIT_CHECK_MS = 16_000;

/**
 * The editor and its autosave.
 *
 * This is the durability half of the design: typing puts bytes on disk. When
 * a change becomes a commit is a separate decision that hooks into the
 * server's save path, so this component only has to *report* which of the two
 * guarantees currently holds.
 *
 * Keyed by note path upstream, so switching notes remounts it and no state can
 * leak between two files.
 */
export default function NoteEditor({
  note,
  notes,
  repoFiles,
}: {
  note: EditableNote;
  notes: NoteEntry[];
  repoFiles: string[];
}) {
  const router = useRouter();
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<Status>('clean');
  const [commit, setCommit] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<{ link: AmbiguousLink; x: number; y: number } | null>(null);
  // What the server says is actually on disk right now, captured off a 409 —
  // the two conflict actions below are the only things that read this.
  const [conflictWith, setConflictWith] = useState<{ hash: string; content: string } | null>(null);

  // Refs, not state: the debounce timer and the unmount flush need the newest
  // values without waiting for a re-render.
  const hash = useRef(note.hash);
  const latest = useRef(note.content);
  const onDisk = useRef(note.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitCheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether this note started life as a not-yet-on-disk stub (see the
  // `?new=1` path in `page.tsx`) — the sidebar only has a client-side
  // placeholder for it until the tree is refetched, so the first real write
  // needs to trigger that refetch itself rather than waiting for the user
  // to navigate somewhere and back.
  const wasNew = useRef(note.hash === NEW_FILE_HASH);

  const save = useCallback(async (flush = false) => {
    const pending = latest.current;
    if (pending === onDisk.current && !flush) return;

    if (commitCheck.current) clearTimeout(commitCheck.current);
    setStatus('saving');
    try {
      const response = await fetch('/api/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path, content: pending, baseHash: hash.current, flush }),
      });
      const data = await response.json();

      if (response.status === 409) {
        setStatus('conflict');
        setProblem(data.message ?? 'This note changed somewhere else.');
        setConflictWith({ hash: data.currentHash, content: data.currentContent });
        return;
      }
      if (!response.ok) {
        setStatus('error');
        setProblem(data.error ?? 'Save failed.');
        return;
      }

      hash.current = data.hash;
      onDisk.current = pending;
      setProblem(data.commitError ?? null);
      setCommit(data.commit ?? null);
      setConflictWith(null);

      if (wasNew.current) {
        wasNew.current = false;
        // The file is real now — hand the sidebar its authoritative row so
        // it can drop the client-only placeholder, rather than leaving that
        // placeholder up until some unrelated navigation happens to refetch.
        router.refresh();
      }

      // Someone may have typed while the request was in flight.
      if (latest.current !== pending) {
        setStatus('editing');
        return;
      }
      setStatus(data.commit ? 'committed' : 'onDisk');

      // Not committed yet: the server is holding this note's session open and
      // will write it to history once typing stops. Check back once.
      if (!data.commit && data.pending) {
        commitCheck.current = setTimeout(() => {
          void fetch(`/api/note/status?path=${encodeURIComponent(note.path)}`)
            .then((r) => r.json())
            .then((state) => {
              if (latest.current !== onDisk.current || state.pending || !state.commit) return;
              setCommit(state.commit);
              setStatus('committed');
            })
            .catch(() => undefined);
        }, COMMIT_CHECK_MS);
      }
    } catch {
      setStatus('error');
      setProblem('Could not reach the server.');
    }
  }, [note.path, router]);

  const onChange = (value: string) => {
    setContent(value);
    latest.current = value;
    setStatus('editing');
    setProblem(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  };

  // Ctrl+S flushes — it commits immediately instead of waiting out the idle
  // window — but does not start a new commit. Plenty of people press it every
  // few seconds out of habit, and treating that as a milestone would shred the
  // log into a commit per reflex.
  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void save(true);
  }, [save]);

  // The two ways out of a conflict — both explicit, neither silent. Retrying
  // with the same stale hash would just 409 again forever, so both first
  // adopt the hash the server just proved is current.
  const keepMine = useCallback(() => {
    if (!conflictWith) return;
    hash.current = conflictWith.hash;
    setConflictWith(null);
    saveNow();
  }, [conflictWith, saveNow]);

  const loadTheirs = useCallback(() => {
    if (!conflictWith) return;
    hash.current = conflictWith.hash;
    onDisk.current = conflictWith.content;
    latest.current = conflictWith.content;
    setContent(conflictWith.content);
    setConflictWith(null);
    setProblem(null);
    setStatus('onDisk');
  }, [conflictWith]);

  // Recomputed on every keystroke — parsing+resolving one note's handful of
  // links against ~40 paths is trivial, no debounce needed here (the
  // CodeMirror decoration layer gets its own, for a different reason: it
  // repaints the DOM, this just re-renders a list).
  const links = useMemo(() => {
    const notePaths = notes.map((n) => n.path);
    return parseLinks(content).map((link) => resolveLink(note.path, link, { notePaths, repoFiles }));
  }, [content, notes, repoFiles, note.path]);

  const titleByPath = useMemo(() => new Map(notes.map((n) => [n.path, n.title])), [notes]);

  // Deliberately excludes `content`: this only needs to change when the
  // *set of notes/files to resolve against* changes, not on every
  // keystroke — the decoration plugin re-parses the live doc itself, on its
  // own debounce, once CodeMirror is holding this extension.
  const linkCtx = useMemo(
    () => ({
      sourcePath: note.path,
      notePaths: notes.map((n) => n.path),
      repoFiles,
      onNavigate: (path: string) => router.push(`/?path=${encodeURIComponent(path)}`),
      onAmbiguous: (link: AmbiguousLink, coords: { x: number; y: number }) =>
        setAmbiguous({ link, x: coords.x, y: coords.y }),
    }),
    [note.path, notes, repoFiles, router],
  );

  const editorExtensions = useMemo(
    () => [
      markdown(),
      editorTheme,
      linkDecorations(linkCtx),
      EditorView.contentAttributes.of({
        'aria-label': `Contents of ${note.path}`,
        spellcheck: 'false',
      }),
    ],
    [linkCtx, note.path],
  );

  // Ctrl/Cmd-S saves now instead of waiting out the debounce. The browser's own
  // "save page" dialog is never what someone means inside a text editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  // Leaving for another note, or closing the tab, must not drop the last few
  // keystrokes — and must not leave the work sitting outside history either.
  // `keepalive` lets the request outlive the component; `flush` tells the
  // server to commit rather than start a 15s timer nobody is waiting on.
  useEffect(() => {
    const path = note.path;
    const flushOut = () => {
      // Nothing new to flush since the last successful write — most
      // consequential for a brand-new note (`note.hash` is the sentinel
      // `NEW_FILE_HASH`), where flushing here would create and commit an
      // empty file before the user typed a single character. React's Strict
      // Mode deliberately mounts, unmounts, and remounts every component in
      // dev specifically to catch a missing guard like this — it did, on the
      // very first real use of Create. Harmless-but-redundant for an
      // existing, untouched note too, so the guard is unconditional rather
      // than sentinel-specific.
      if (latest.current === onDisk.current) return;

      void fetch('/api/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          content: latest.current,
          baseHash: hash.current,
          flush: true,
        }),
        keepalive: true,
      });
    };

    const onHide = () => {
      if (document.visibilityState === 'hidden') flushOut();
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (timer.current) clearTimeout(timer.current);
      if (commitCheck.current) clearTimeout(commitCheck.current);
      flushOut();
    };
  }, [note.path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-6 px-10 pt-7 pb-4">
        <div className="min-w-0">
          <Breadcrumb path={note.path} />
          <h1 className="mt-1.5 truncate text-2xl font-semibold text-neutral-100">{note.title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <LinksMenu links={links} notes={notes} />
          <SaveStatus
            status={status}
            commit={commit}
            problem={problem}
            onRetry={saveNow}
            onKeepMine={keepMine}
            onLoadTheirs={loadTheirs}
          />
        </div>
      </header>

      <div className="mx-10 border-t border-line" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <CodeMirror
          value={content}
          onChange={(value) => onChange(value)}
          theme="none"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
            closeBrackets: false,
            bracketMatching: false,
          }}
          extensions={editorExtensions}
          className="text-sm leading-relaxed text-neutral-200"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>

      {ambiguous && (
        <AmbiguousLinkOverlay
          x={ambiguous.x}
          y={ambiguous.y}
          target={ambiguous.link.target}
          candidates={ambiguous.link.candidates.map((path) => ({
            path,
            title: titleByPath.get(path) ?? path,
          }))}
          onDismiss={() => setAmbiguous(null)}
        />
      )}
    </div>
  );
}

/** `notes / projects / api-migration / execution` — where this note lives. */
function Breadcrumb({ path }: { path: string }) {
  const folders = dirName(path).split('/');
  return (
    <p className="truncate font-mono text-xs text-neutral-500">
      {folders.map((folder, i) => (
        <span key={i}>
          {i > 0 && <span className="px-1.5 text-neutral-700">/</span>}
          {folder}
        </span>
      ))}
    </p>
  );
}

/**
 * The first of the three interface moments the brief names: can the user tell,
 * without thinking, whether their work is safe?
 *
 * There are two real guarantees here, so the pill shows two, quietly. "Saved
 * to disk" means the text survives a closed laptop. "Committed" means it is in
 * the permanent record and can be recovered later. Collapsing both into
 * "Saved" would be simpler and would claim more than the app has done at that
 * instant.
 */
function SaveStatus({
  status,
  commit,
  problem,
  onRetry,
  onKeepMine,
  onLoadTheirs,
}: {
  status: Status;
  commit: string | null;
  problem: string | null;
  onRetry: () => void;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
}) {
  if (status === 'clean') return null;

  const pill = 'flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 font-mono text-xs';

  if (status === 'editing') {
    return (
      <p className={`${pill} bg-amber-500/10 text-amber-400`} role="status">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
        Editing…
      </p>
    );
  }

  if (status === 'saving') {
    return (
      <p className={`${pill} bg-blue-500/10 text-blue-400`} role="status">
        <span className="size-1.5 animate-ping rounded-full bg-blue-400" />
        Saving to disk…
      </p>
    );
  }

  if (status === 'onDisk') {
    return (
      <p
        className={`${pill} bg-neutral-800 text-neutral-300`}
        role="status"
        title="Your text is on disk. It is not yet part of the note's history."
      >
        <span className="size-1.5 rounded-full bg-blue-400" />
        Saved to disk
      </p>
    );
  }

  if (status === 'committed') {
    return (
      <p
        className={`${pill} bg-emerald-500/10 text-emerald-400`}
        role="status"
        title="Recorded in this note's history — recoverable later."
      >
        <span className="size-1.5 rounded-full bg-emerald-400" />
        Committed · <code>{commit}</code>
      </p>
    );
  }

  if (status === 'conflict') {
    return (
      <p className={`${pill} bg-red-500/10 text-red-400`} role="status" title={problem ?? undefined}>
        <span className="size-1.5 rounded-full bg-red-400" />
        Changed elsewhere
        <button type="button" onClick={onKeepMine} className="ml-1 underline hover:text-red-300">
          Keep mine
        </button>
        <button type="button" onClick={onLoadTheirs} className="underline hover:text-red-300">
          Load theirs
        </button>
      </p>
    );
  }

  return (
    <p className={`${pill} bg-red-500/10 text-red-400`} role="status" title={problem ?? undefined}>
      <span className="size-1.5 rounded-full bg-red-400" />
      Save failed
      <button type="button" onClick={onRetry} className="ml-1 underline hover:text-red-300">
        Retry
      </button>
    </p>
  );
}
