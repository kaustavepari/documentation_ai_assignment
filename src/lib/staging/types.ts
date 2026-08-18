/**
 * The shape of one staged mutation. Deliberately dependency-free — no
 * IndexedDB, no React — so it can be shared by the pure fold logic
 * (`fold.ts`), the IndexedDB adapter (`db.ts`), and the React store
 * (`StagingProvider.tsx`) without any of them leaking into the others.
 *
 * See `dev-notes/staging-layer-spec.md`'s "IndexedDB schema" and "Op
 * identity" sections — this type is that schema.
 */
export type StagedOp = 'edit' | 'create' | 'delete' | 'rename';

/**
 * One staged mutation, keyed by the note's identity as of the last commit —
 * not by whatever path it currently displays under. A staged create has no
 * prior committed path, so it is keyed by its client-assigned path instead
 * (see ticket 03).
 *
 * Upserted in place per identity, never appended — five staged edits to the
 * same note are one record, not five. `op` is only the most recent
 * *user-facing* label for the record (what ticket 06 lists it as); which
 * fields are populated is what commit-time replay (ticket 02) actually acts
 * on.
 */
export type StagedRecord = {
  id: string;
  op: StagedOp;
  /** Staged text — present for 'edit' and 'create'. */
  content?: string;
  /** Staged destination path — present for 'rename' (covers move too). */
  newPath?: string;
  /**
   * Whether fixable links should be rewritten at commit time — the user's
   * answer to the link-impact check that already runs at confirm time
   * (`/api/note/link-impact`), captured now because that scan isn't re-run
   * at commit. Present only alongside `newPath`.
   */
  rewriteLinks?: boolean;
  /**
   * SHA-256 of the note's on-disk bytes when staging began (`hashOf` in
   * `server/notes.ts`) — carried through to the commit-time conflict check.
   * Absent for a staged create, which has nothing on disk to fingerprint.
   */
  baseHash?: string;
  /** Local bookkeeping only (ordering, debugging) — not read by fold logic. */
  updatedAt: number;
};

/** All currently staged records, keyed by `id`. */
export type StagedState = Record<string, StagedRecord>;
