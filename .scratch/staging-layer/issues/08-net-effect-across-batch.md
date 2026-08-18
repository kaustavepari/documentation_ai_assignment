# 08 — Net effect across the whole staged batch

**What to build:** Before replaying staged ops at commit time, the batch is
collapsed per note identity so the repository ends up reflecting only the
net result of the user's staged work, not a replay of every intermediate
step.

**Blocked by:** 02 — Commit staged edits to the real repository;
03 — Stage a create; 04 — Stage a rename or move; 05 — Stage a delete.

**Status:** ready-for-agent

- [ ] Creating a note and then deleting that same note while staged, then
      committing, leaves the repository completely unchanged — no trace of
      either operation.
- [ ] Editing a note and then deleting it while staged, then committing,
      results in only the delete — no phantom edit commit.
- [ ] Renaming a note twice while staged (A → B → C), then committing,
      results in one rename (A → C) in the repository, not two.
- [ ] `.noteindex.json` after commit reflects only the net state, in its
      existing hand-rolled formatting.
