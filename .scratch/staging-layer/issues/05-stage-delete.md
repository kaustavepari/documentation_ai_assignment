# 05 — Stage a delete

**What to build:** Deleting a note is held as a staged intent rather than
performed immediately.

**Blocked by:** 01 — Stage an edit and see it persist across reload;
02 — Commit staged edits to the real repository.

**Status:** ready-for-agent

- [ ] Deleting a note does not perform a real `git rm` or touch git.
- [ ] The delete is staged and reflected in the pending count.
- [ ] Committing a staged delete performs the real `git rm` and produces
      the existing `Delete` commit message, including its dangling-links
      summary.
