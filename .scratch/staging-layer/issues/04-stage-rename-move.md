# 04 — Stage a rename or move

**What to build:** Renaming or moving a note (the same underlying
operation in this codebase) is held as a staged intent rather than
performed immediately. The existing link-impact planning still runs up
front so the UI can warn about unfixable links before the user commits to
the rename, but no `git mv` happens until Commit.

**Blocked by:** 01 — Stage an edit and see it persist across reload;
02 — Commit staged edits to the real repository.

**Status:** ready-for-agent

- [ ] Renaming or moving a note does not perform a real `git mv` or touch
      git.
- [ ] The rename/move is staged and reflected in the pending count.
- [ ] Link-impact scanning (fixable/unfixable) still runs at the point of
      confirming the rename, unchanged from today's behavior.
- [ ] Committing a staged rename/move performs the real `git mv`, rewrites
      fixable links, and produces the existing `Rename`/`Move`/`Move and
      rename` commit message.
