# 01 — Stage an edit and see it persist across reload

**What to build:** Typing in the editor no longer autosaves to the real
notes repository. Instead, edits are held in a durable client-side store
(IndexedDB) and the UI shows a pending indicator whenever a note has staged,
uncommitted work. Reloading the page does not lose the staged edit. This
ticket also carries the prefactoring everything else in this feature builds
on: a pure fold/apply module (`(baseState, op) -> effectiveState`, no
IndexedDB or React dependency) and the IndexedDB adapter around it — neither
is separately demoable, so both ship bundled with the first behavior that
uses them.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Editing a note no longer writes to the real notes repository — the
      file on disk is untouched.
- [ ] `git log` in the notes repo is unchanged by editing.
- [ ] A pending indicator reflects that the note has staged work.
- [ ] Reloading the page while an edit is staged shows the same staged
      content, still pending — not the last-committed content.
- [ ] The fold/apply logic (given a base note and a staged edit, produce the
      effective content) is a pure function with no IndexedDB or React
      dependency.
- [ ] The IndexedDB adapter persists one record per staged note identity,
      upserted on each edit rather than appended as a growing log.
