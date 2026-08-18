import { NEW_FILE_HASH } from '../paths';
import type { StagedRecord, StagedState } from './types';

/**
 * The pure seam the whole feature is built on
 * (`dev-notes/staging-layer-spec.md`'s "Core seam" decision). No IndexedDB,
 * no React — every function here takes plain objects and returns plain
 * objects, so it can be reasoned about (and, if a harness is ever added,
 * tested) in complete isolation from how it's persisted or rendered.
 *
 * This ticket only exercises the 'edit' shape. `upsertEdit` is written
 * generally enough that a record already carrying a staged create or rename
 * (tickets 03/04) keeps that op and gains the new content, rather than being
 * clobbered back to a plain edit — that collapsing is what lets
 * rename-then-edit resolve to one record instead of two unrelated ones.
 */

/**
 * Overlay a staged edit onto one note's committed content — `applyOp`,
 * specialized to a single note. A record with no `content` (a staged
 * rename/delete with nothing typed) leaves the base content untouched.
 */
export function effectiveContent(committedContent: string, record: StagedRecord | undefined): string {
  if (!record || record.content === undefined) return committedContent;
  return record.content;
}

/** Whether a note has any staged work at all, for the pending indicator. */
export function hasStagedWork(record: StagedRecord | undefined): boolean {
  return record !== undefined;
}

/**
 * Upsert a staged edit for `id`. Reuses the existing record's `op` (and
 * `newPath`, if any) when one is already staged for this identity — an edit
 * on top of a staged create is still a create; an edit on top of a staged
 * rename is still that rename, now also carrying new content — so only
 * `content` (and `updatedAt`) change. A fresh identity gets a plain 'edit'
 * record.
 */
export function upsertEdit(
  state: StagedState,
  id: string,
  content: string,
  baseHash: string | undefined,
  now: number,
): StagedState {
  const existing = state[id];
  const record: StagedRecord = existing
    ? { ...existing, content, updatedAt: now }
    : { id, op: 'edit', content, baseHash, updatedAt: now };
  return { ...state, [id]: record };
}

/**
 * Stage a brand-new note's creation, the moment its name is confirmed —
 * before the first keystroke, so it counts toward the pending indicator
 * right away rather than waiting for the user to start typing. `id` is the
 * note's client-assigned path (it has no committed identity to key off of
 * yet, per the spec's "Op identity" decision); `baseHash` is the
 * `NEW_FILE_HASH` sentinel, matching what `writeNote` already expects to see
 * for a note that shouldn't exist on disk yet.
 *
 * A no-op if something is already staged for this identity — confirming a
 * name only ever happens once per note, so this should never actually
 * collide, but idempotence costs nothing and avoids clobbering real content
 * if it somehow did.
 */
export function upsertCreate(state: StagedState, id: string, now: number): StagedState {
  if (state[id]) return state;
  const record: StagedRecord = { id, op: 'create', content: '', baseHash: NEW_FILE_HASH, updatedAt: now };
  return { ...state, [id]: record };
}

/**
 * Stage a rename/move for `id` (the note's last-committed path — see
 * `types.ts`'s "Op identity"). Spreads whatever's already staged first, so
 * content staged before the rename is preserved (a rename of a note with
 * staged edits keeps carrying that content) and a second rename of the same
 * identity just replaces `newPath`/`rewriteLinks` in place rather than
 * creating a second record — the one piece of "collapse a chain to one net
 * op" (ticket 08's fuller job) that falls out for free from upserting by
 * identity.
 */
export function upsertRename(
  state: StagedState,
  id: string,
  newPath: string,
  rewriteLinks: boolean,
  now: number,
): StagedState {
  const existing = state[id];
  const record: StagedRecord = { ...existing, id, op: 'rename', newPath, rewriteLinks, updatedAt: now };
  return { ...state, [id]: record };
}

/**
 * Stage a delete for `id`. A delete wins outright over whatever else was
 * staged for this identity — any staged content or rename becomes moot the
 * moment the user says "get rid of it," so both are dropped here rather
 * than carried forward.
 *
 * `baseHash` is preserved from the existing record if there is one. This
 * matters for ticket 08: a create-then-delete before ever committing should
 * collapse to nothing happening at all, and the only way to tell "this
 * identity never existed on disk" apart from "this identity is a real note
 * being deleted" at that point is the `NEW_FILE_HASH` sentinel a staged
 * create's `baseHash` carries — overwriting it here would erase the one
 * signal that later collapse needs.
 */
export function upsertDelete(state: StagedState, id: string, now: number): StagedState {
  const existing = state[id];
  const record: StagedRecord = { id, op: 'delete', baseHash: existing?.baseHash, updatedAt: now };
  return { ...state, [id]: record };
}

/** Drop whatever is staged for `id` — used once a commit or discard lands. */
export function removeRecord(state: StagedState, id: string): StagedState {
  if (!(id in state)) return state;
  const next = { ...state };
  delete next[id];
  return next;
}

export function pendingCountOf(state: StagedState): number {
  return Object.keys(state).length;
}
