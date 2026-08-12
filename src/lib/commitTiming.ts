/** Idle gap after which a note's autosaved work is written to history (sessions.ts). */
export const COMMIT_IDLE_MS = 15_000;

/**
 * When the client asks whether the commit has landed (NoteEditor.tsx).
 *
 * Nothing is in flight right when the server's idle window elapses, so the
 * save pill would otherwise sit on "Saved to disk" forever even though the
 * work reached history. One poll, slightly after the server's own window —
 * derived from it so the two can't drift out of sync.
 */
export const COMMIT_CHECK_MS = COMMIT_IDLE_MS + 1_000;
