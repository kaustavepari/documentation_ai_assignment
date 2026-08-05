'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { dirName } from '@/lib/paths';

/** Only what the browser needs. The server's `Note` also carries line endings. */
type EditableNote = { path: string; title: string; content: string; hash: string };

type Status = 'clean' | 'editing' | 'saving' | 'onDisk' | 'committed' | 'error' | 'conflict';

/** Long enough not to fire mid-word, short enough that nobody notices waiting. */
const AUTOSAVE_DELAY_MS = 800;

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
export default function NoteEditor({ note }: { note: EditableNote }) {
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<Status>('clean');
  const [commit, setCommit] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Refs, not state: the debounce timer and the unmount flush need the newest
  // values without waiting for a re-render.
  const hash = useRef(note.hash);
  const latest = useRef(note.content);
  const onDisk = useRef(note.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    const pending = latest.current;
    if (pending === onDisk.current) return;

    setStatus('saving');
    try {
      const response = await fetch('/api/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path, content: pending, baseHash: hash.current }),
      });
      const data = await response.json();

      if (response.status === 409) {
        setStatus('conflict');
        setProblem(data.message ?? 'This note changed somewhere else.');
        return;
      }
      if (!response.ok) {
        setStatus('error');
        setProblem(data.error ?? 'Save failed.');
        return;
      }

      hash.current = data.hash;
      onDisk.current = pending;
      setProblem(null);
      setCommit(data.commit ?? null);
      // Someone may have typed while the request was in flight.
      if (latest.current !== pending) setStatus('editing');
      else setStatus(data.commit ? 'committed' : 'onDisk');
    } catch {
      setStatus('error');
      setProblem('Could not reach the server.');
    }
  }, [note.path]);

  const onChange = (value: string) => {
    setContent(value);
    latest.current = value;
    setStatus('editing');
    setProblem(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_DELAY_MS);
  };

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void save();
  }, [save]);

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

  // Leaving for another note must not drop the last few keystrokes.
  // `keepalive` lets the request outlive the component.
  useEffect(() => {
    const path = note.path;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (latest.current === onDisk.current) return;
      void fetch('/api/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: latest.current, baseHash: hash.current }),
        keepalive: true,
      });
    };
  }, [note.path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-6 px-10 pt-7 pb-4">
        <div className="min-w-0">
          <Breadcrumb path={note.path} />
          <h1 className="mt-1.5 truncate text-2xl font-semibold text-neutral-100">{note.title}</h1>
        </div>
        <SaveStatus status={status} commit={commit} problem={problem} onRetry={saveNow} />
      </header>

      <div className="mx-10 border-t border-line" />

      <textarea
        value={content}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-transparent px-10 py-6 font-mono text-sm leading-relaxed text-neutral-200 outline-none"
        aria-label={`Contents of ${note.path}`}
      />
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
}: {
  status: Status;
  commit: string | null;
  problem: string | null;
  onRetry: () => void;
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

  return (
    <p className={`${pill} bg-red-500/10 text-red-400`} role="status" title={problem ?? undefined}>
      <span className="size-1.5 rounded-full bg-red-400" />
      {status === 'conflict' ? 'Changed elsewhere' : 'Save failed'}
      <button type="button" onClick={onRetry} className="ml-1 underline hover:text-red-300">
        Retry
      </button>
    </p>
  );
}
