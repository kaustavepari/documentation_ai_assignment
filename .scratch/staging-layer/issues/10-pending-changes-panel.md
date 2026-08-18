# 10 — Pending changes panel

**What to build:** A panel (in the spirit of a source-control changes view)
that lists every currently staged change — one row per staged note
identity, showing its path and its net operation (Created / Edited /
Renamed or Moved / Deleted) — so the user can review *what* is about to be
committed, not just how many changes are pending. This satisfies
requirement 4 ("the user can see what is staged **and** how many changes
are pending") in full; the existing pending count alone only covers the
second half. The panel has no selection mechanism: Commit and Discard
continue to act on the entire staged set, per "a Commit action writes
everything staged" — this is a read-only review surface, not a picker.

**Blocked by:** 08 — Net effect across the whole staged batch (the panel
reads through the collapsed net-effect view, not the raw op log, so a
staged create immediately followed by a staged delete of the same note
never appears as two misleading rows).

**Status:** ready-for-agent

- [ ] A panel lists every currently staged change, one row per note,
      showing its path and its net operation (Created / Edited / Renamed
      or Moved / Deleted).
- [ ] The panel has no checkbox/selection mechanism — Commit and Discard
      still act on the whole staged set, unchanged from tickets 02 and 09.
- [ ] The panel reflects the collapsed net-effect view: a staged create
      followed by a staged delete of the same note produces zero rows for
      that note, not two.
- [ ] The panel updates live as changes are staged, and clears rows
      immediately on a successful commit or a discard.
- [ ] The existing pending count stays consistent with the number of rows
      the panel shows.
