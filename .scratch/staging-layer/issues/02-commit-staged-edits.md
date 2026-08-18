# 02 — Commit staged edits to the real repository

**What to build:** A Commit action that takes whatever edits are currently
staged, writes them to the real repository through the app's existing save
pipeline, and produces the same commit messages (`Create`/`Retitle`/`Edit`)
it already produces today. After a successful commit, the corresponding
staged state is cleared and the pending indicator drops.

**Blocked by:** 01 — Stage an edit and see it persist across reload.

**Status:** ready-for-agent

- [ ] Clicking Commit with one or more staged edits writes each to disk for
      real and produces a real commit per note, using the existing
      commit-message logic.
- [ ] After commit, `git status` on the notes repo is clean.
- [ ] Several staged edits to the same note made before commit produce one
      net write/commit, not one per keystroke or per prior autosave
      interval.
- [ ] If one staged note's commit fails (its underlying content changed
      since staging began), that failure is isolated — other staged notes
      in the same Commit action still commit successfully.
- [ ] A note whose commit failed remains staged afterward, with its failure
      reason visible, rather than disappearing or silently landing.
- [ ] The pending indicator reflects exactly what's left staged after a
      partially-successful commit.
