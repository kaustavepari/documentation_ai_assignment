# 03 — Stage a create

**What to build:** Confirming a new note's name stages its creation instead
of touching the real repository. The note is visible wherever staged notes
are visible (per ticket 01's pending indicator) with nothing written to
disk. Committing (ticket 02's action) writes it for real.

**Blocked by:** 01 — Stage an edit and see it persist across reload;
02 — Commit staged edits to the real repository.

**Status:** ready-for-agent

- [ ] Confirming a new note's name does not create a file on disk.
- [ ] The new note is staged and reflected in the pending count.
- [ ] Typing content into a staged-new note holds that content the same way
      an edit to an existing note does (durable across reload).
- [ ] Committing a staged create writes the real file and produces a
      `Create` commit, same message shape as today's.
