'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { deleteStaged, loadAllStaged, putStaged } from '@/lib/staging/db';
import { removeRecord, upsertCreate, upsertDelete, upsertEdit, upsertRename } from '@/lib/staging/fold';
import type { StagedRecord, StagedState } from '@/lib/staging/types';

type Action =
  | { type: 'hydrate'; records: StagedRecord[] }
  | { type: 'upsert'; record: StagedRecord }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear' };

function reducer(state: StagedState, action: Action): StagedState {
  switch (action.type) {
    case 'hydrate': {
      const next: StagedState = {};
      for (const record of action.records) next[record.id] = record;
      return next;
    }
    case 'upsert':
      return { ...state, [action.record.id]: action.record };
    case 'remove':
      return action.ids.reduce(removeRecord, state);
    case 'clear':
      return {};
    default:
      return state;
  }
}

type StagingContextValue = {
  /**
   * False until the initial IndexedDB read completes. Consumers that need to
   * show correct staged-or-not content (the editor) should wait for this
   * rather than risk a flash of committed content that a staged edit is
   * about to override.
   */
  ready: boolean;
  records: StagedState;
  /**
   * Stage an edit for `id` (a note's last-committed path, or its
   * client-assigned path if it doesn't have one yet — see `types.ts`).
   * Updates in-memory state synchronously for instant UI feedback and
   * persists to IndexedDB in parallel, per the spec's "in-memory mirror"
   * decision — not sequentially through IndexedDB, which would make every
   * keystroke wait on a database round trip.
   */
  stageEdit: (id: string, content: string, baseHash: string | undefined) => void;
  /**
   * Stage a brand-new note's creation at `id` (its client-assigned path),
   * the moment its name is confirmed — before the first keystroke, so it
   * counts as pending right away. A no-op if `id` is already staged.
   */
  stageCreate: (id: string) => void;
  /**
   * Stage a rename/move for `id` to `newPath`. `rewriteLinks` is the user's
   * already-made answer to the link-impact check (ticket 04) — captured now
   * since that scan runs at confirm time, not at commit.
   */
  stageRename: (id: string, newPath: string, rewriteLinks: boolean) => void;
  /** Stage a delete for `id` — overrides whatever else was staged for it. */
  stageDelete: (id: string) => void;
  /**
   * Drop whatever is staged for these identities — called once Commit
   * (ticket 02) has written them for real, or a wholesale Discard
   * (ticket 09) is issued. In-memory and IndexedDB together; no server
   * round trip, since by definition nothing here is safe to assume the
   * server still needs told about.
   */
  clearStaged: (ids: string[]) => void;
  /**
   * The most recently committed on-disk hash for a note, if this session
   * has learned one — distinct from the `note.hash` a page load hands the
   * editor, which goes stale the moment Commit (ticket 02) writes a new
   * version for real. Staging a *fresh* edit right after a commit (nothing
   * currently staged for that identity) needs this, or it would send the
   * commit endpoint a `baseHash` that no longer matches disk and get an
   * honest — but wrong — conflict.
   */
  noteHashes: Record<string, string>;
  setNoteHash: (path: string, hash: string) => void;
};

const StagingContext = createContext<StagingContextValue | null>(null);

export function StagingProvider({ children }: { children: React.ReactNode }) {
  const [records, dispatch] = useReducer(reducer, {} as StagedState);
  const ready = useHydrated(dispatch);

  // Mirrors `records` synchronously so `stageEdit` can read the latest
  // staged state without depending on it directly — depending on it would
  // recreate the callback (and thus break memoization for every consumer)
  // on every single keystroke.
  const recordsRef = useRef(records);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const stageEdit = useCallback((id: string, content: string, baseHash: string | undefined) => {
    const merged = upsertEdit(recordsRef.current, id, content, baseHash, Date.now());
    const record = merged[id];
    recordsRef.current = merged;
    dispatch({ type: 'upsert', record });
    // Fire-and-forget: the in-memory dispatch above is the UI-facing
    // guarantee. IndexedDB persistence happens in parallel per the spec's
    // "in-memory mirror" decision, not sequentially in front of it.
    void putStaged(record);
  }, []);

  const stageCreate = useCallback((id: string) => {
    const merged = upsertCreate(recordsRef.current, id, Date.now());
    if (merged === recordsRef.current) return; // already staged — no-op per upsertCreate's contract
    const record = merged[id];
    recordsRef.current = merged;
    dispatch({ type: 'upsert', record });
    void putStaged(record);
  }, []);

  const stageRename = useCallback((id: string, newPath: string, rewriteLinks: boolean) => {
    const merged = upsertRename(recordsRef.current, id, newPath, rewriteLinks, Date.now());
    const record = merged[id];
    recordsRef.current = merged;
    dispatch({ type: 'upsert', record });
    void putStaged(record);
  }, []);

  const stageDelete = useCallback((id: string) => {
    const merged = upsertDelete(recordsRef.current, id, Date.now());
    const record = merged[id];
    recordsRef.current = merged;
    dispatch({ type: 'upsert', record });
    void putStaged(record);
  }, []);

  const clearStaged = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    recordsRef.current = ids.reduce((state, id) => {
      if (!(id in state)) return state;
      const next = { ...state };
      delete next[id];
      return next;
    }, recordsRef.current);
    dispatch({ type: 'remove', ids });
    for (const id of ids) void deleteStaged(id);
  }, []);

  const [noteHashes, setNoteHashes] = useState<Record<string, string>>({});
  const setNoteHash = useCallback((path: string, hash: string) => {
    setNoteHashes((prev) => (prev[path] === hash ? prev : { ...prev, [path]: hash }));
  }, []);

  const value = useMemo<StagingContextValue>(
    () => ({ ready, records, stageEdit, stageCreate, stageRename, stageDelete, clearStaged, noteHashes, setNoteHash }),
    [ready, records, stageEdit, stageCreate, stageRename, stageDelete, clearStaged, noteHashes, setNoteHash],
  );

  return <StagingContext.Provider value={value}>{children}</StagingContext.Provider>;
}

/** Reads every staged record once, on mount, and seeds the reducer with it. */
function useHydrated(dispatch: React.Dispatch<Action>): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadAllStaged()
      .then((records) => {
        if (cancelled) return;
        dispatch({ type: 'hydrate', records });
        setReady(true);
      })
      .catch(() => {
        // No staged records recoverable — proceed as if there were none
        // rather than blocking the app on a database that failed to open.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);
  return ready;
}

export function useStaging(): StagingContextValue {
  const ctx = useContext(StagingContext);
  if (!ctx) throw new Error('useStaging must be used within a StagingProvider.');
  return ctx;
}
