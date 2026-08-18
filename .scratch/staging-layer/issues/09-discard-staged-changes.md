# 09 — Discard staged changes

**What to build:** A Discard action clears all staged state (in-memory and
IndexedDB) and returns the tree and any open note to exactly the
last-committed state, with nothing pending afterward.

**Blocked by:** 06 — Sidebar tree reflects staged state; 07 — Opening a
note reflects staged state.

**Status:** ready-for-agent

- [ ] Discard clears the pending indicator to zero.
- [ ] The tree reverts to showing exactly committed state — no staged
      creates, deletes, or renames remain visible.
- [ ] An open note that had staged edits reverts to its last-committed
      content.
- [ ] No server round-trip or git operation occurs as part of discard.
