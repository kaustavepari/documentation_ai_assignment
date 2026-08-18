'use client';

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AmbiguousLinkOverlay from '@/components/editor/AmbiguousLinkOverlay';
import LinksMenu from '@/components/editor/LinksMenu';
import { linkDecorations, type AmbiguousLink } from '@/components/editor/linkDecorations';
import { useStaging } from '@/components/staging/StagingProvider';
import { dirName } from '@/lib/paths';
import { parseLinks } from '@/lib/links/parse';
import { resolveLink } from '@/lib/links/resolve';
import { effectiveContent } from '@/lib/staging/fold';

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

type Status = 'clean' | 'editing' | 'pending';

/** Long enough not to fire mid-word, short enough that nobody notices waiting. */
const STAGE_DELAY_MS = 800;

/**
 * The editor. Typing here no longer touches the real repository at all — see
 * `dev-notes/staging-layer-spec.md`. Every change is held in the staging
 * layer (`StagingProvider`, durable via IndexedDB) and shown as if it had
 * already happened; nothing reaches disk or git until a Commit action
 * (ticket 02) replays it through the app's existing save pipeline.
 *
 * Split into an outer component that waits on `useStaging().ready` and an
 * inner one that owns the actual editing state: the inner component's
 * initial state is seeded from whatever's staged for this note, and that can
 * only be known correctly once the one-time IndexedDB read has completed —
 * mounting CodeMirror before then risks a flash of committed content that a
 * staged edit is about to override.
 */
export default function NoteEditor(props: { note: EditableNote; notes: NoteEntry[]; repoFiles: string[] }) {
  const staging = useStaging();
  if (!staging.ready) return <LoadingPane />;
  return <EditorPane {...props} />;
}

function LoadingPane() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-neutral-600">Loading staged changes…</p>
    </div>
  );
}

function EditorPane({ note, notes, repoFiles }: { note: EditableNote; notes: NoteEntry[]; repoFiles: string[] }) {
  const router = useRouter();
  const staging = useStaging();
  const record = staging.records[note.path];

  const [content, setContent] = useState(() => effectiveContent(note.content, record));
  const [status, setStatus] = useState<Status>(record ? 'pending' : 'clean');
  const [ambiguous, setAmbiguous] = useState<{ link: AmbiguousLink; x: number; y: number } | null>(null);

  // Refs, not state: the debounce timer and the unmount flush need the
  // newest value without waiting for a re-render.
  const latest = useRef(content);
  // What was last actually staged (in-memory + IndexedDB) — distinct from
  // `latest`, which tracks every keystroke. Lets the debounced/flushed
  // `stage()` below skip a redundant write when nothing changed since the
  // last one landed.
  const lastStaged = useRef(content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { stageEdit } = staging;
  // The hash a fresh staged record should carry as its `baseHash`. Once a
  // commit has landed for this note, `staging.noteHashes` holds the sha that
  // write actually produced; `note.hash` (this component's original mount-time
  // prop) would otherwise go stale the moment that happens, since nothing
  // remounts this component when a commit lands elsewhere in the app.
  const currentHash = staging.noteHashes[note.path] ?? note.hash;
  const stage = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current === lastStaged.current) return;
    stageEdit(note.path, latest.current, currentHash);
    lastStaged.current = latest.current;
    setStatus('pending');
  }, [stageEdit, note.path, currentHash]);

  // A record can disappear out from under this component without it having
  // triggered the change — a successful Commit (ticket 02) clears it once
  // the content is safely in history. Reflect that instead of leaving the
  // pill stuck on "Pending" for content that's no longer staged.
  useEffect(() => {
    if (!record && latest.current === lastStaged.current) setStatus('clean');
  }, [record]);

  const onChange = (value: string) => {
    setContent(value);
    latest.current = value;
    setStatus('editing');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(stage, STAGE_DELAY_MS);
  };

  // Ctrl/Cmd-S stages immediately instead of waiting out the debounce.
  // There's no server round trip to skip here — this only shortens the
  // local delay before the pending indicator (and IndexedDB) catch up.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        stage();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage]);

  // Leaving for another note, hiding the tab, or closing it must not drop
  // the last few keystrokes. Unlike the old autosave path, this never needs
  // `keepalive` — it's a local IndexedDB write, not a network request that
  // the browser would cancel on unload.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stage();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stage();
    };
  }, [stage]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-6 px-10 pt-7 pb-4">
        <div className="min-w-0">
          <Breadcrumb path={note.path} />
          <h1 className="mt-1.5 truncate text-2xl font-semibold text-neutral-100">{note.title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <LinksMenu links={links} notes={notes} />
          <StagingStatus status={status} />
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
 * Only one durability guarantee exists now: held locally, surviving a reload,
 * not yet part of the note's real history. "Committed" (ticket 02) is a
 * separate, later promise this pill doesn't make yet.
 */
function StagingStatus({ status }: { status: Status }) {
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

  return (
    <p
      className={`${pill} bg-neutral-800 text-neutral-300`}
      role="status"
      title="Held locally, survives a reload. Not part of this note's history until you commit."
    >
      <span className="size-1.5 rounded-full bg-blue-400" />
      Pending
    </p>
  );
}
