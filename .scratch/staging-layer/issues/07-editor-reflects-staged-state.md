# 07 — Opening a note reflects staged state

**What to build:** Opening a note — by its current effective path,
including a staged-renamed note's new path — shows staged content when it
exists, instead of the last-committed content.

**Blocked by:** 01 — Stage an edit and see it persist across reload;
03 — Stage a create; 04 — Stage a rename or move.

**Status:** ready-for-agent

- [ ] Opening a note with staged edits shows those edits, not disk content.
- [ ] Opening a staged-new note (created but not committed) shows its
      staged content.
- [ ] Opening a note by its staged-renamed path works and shows the right
      content; the old path no longer resolves to it.
- [ ] Opening an untouched note (nothing staged for it) behaves exactly as
      it does today.
