# 06 — Sidebar tree reflects staged state

**What to build:** The sidebar tree is derived from committed state with
every staged op folded on top: a staged delete removes the note from the
tree, a staged rename/move shows it under its new name/location, and a
staged create shows it in place — all before anything is committed.

**Blocked by:** 03 — Stage a create; 04 — Stage a rename or move;
05 — Stage a delete.

**Status:** ready-for-agent

- [ ] A note staged for deletion is absent from the tree.
- [ ] A note staged for rename or move appears in the tree under its new
      name/location, not its old one.
- [ ] A note staged for creation appears in the tree.
- [ ] These three behaviors compose correctly together (e.g. staging a
      delete on one note and a rename on another at the same time shows
      both correctly at once).
- [ ] The note count / pending indicator shown alongside the tree stays
      consistent with what the tree displays.
