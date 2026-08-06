# Known bugs

Found during manual testing. Bugs 1–4 are triage'd rather than fixed —
none of them lose data or corrupt the repo, they're UI-level — and are
left open at submission time. Bug 5 is different in kind (a real data-loss
race, not a UI issue) and is fixed; kept here for the record rather than
dropped once resolved.

---

## 1. Rename silently no-ops when the only affected link was already ambiguous before the rename

**Repro:**
1. Two notes share a stem: `notes/archive/2024/q1/LEGACY-IMPORT.MD` and
   `notes/archive/2024/q2/LEGACY-IMPORT.md`.
2. A third note (`notes/archive/2025/q1/old-year-goals.md`) contains
   `[[LEGACY-IMPORT.MD]]` — already ambiguous (matches both) before touching
   anything.
3. Rename either `LEGACY-IMPORT` file to something else via the tree's
   inline rename.

**Expected:** the rename completes — since the impact scan for this exact
case (confirmed via a direct, read-only `POST /api/note/link-impact` against
the running server) returns `{fixable: [], unfixable: []}`, the app's own
logic says this should go through the fast path with no modal at all.

**Actual:** nothing happens. The row reverts to the original name. The
server log shows the `link-impact` call succeeding but **no follow-up
`POST /api/note/rename` ever fires** — so the bug is client-side, between
receiving the plan and calling `performRename`. Hard-refreshing the browser
(ruling out a stale JS bundle from a mid-session dev-server restart) didn't
change anything, and no error surfaced in the browser console either.

**Not yet found:** why `performRename` doesn't run despite `plan.unfixable.
length === 0`. Next step when we come back to this: add a temporary
`console.log` right before the `if (plan.unfixable.length === 0)` check in
`AppShell.tsx`'s `confirmRename`, reproduce again, and read what `plan`
actually looked like in the browser at that moment — the direct API call
proves the *server* returns the right shape, but not that the *client*
receives or branches on it correctly.

## 2. A pre-existing ambiguous/broken link is invisible to the rename feature entirely

Separate from bug #1, and arguably a real gap rather than just a bug: the
link-impact scan (`planLinkRewrite` in `lib/links/rewrite.ts`) only
considers links that are currently in `state: 'resolved'` — a link that's
already `ambiguous` or `broken` today never enters either the `fixable` or
`unfixable` bucket, no matter what the rename does. Concretely: renaming one
of two same-stem files away *should* resolve the other's ambiguity (a good
side effect), but nothing in the current feature notices or reports that.
Worth deciding later whether this needs surfacing (e.g. a third bucket,
"already broken, unaffected by this change") or is legitimately out of
scope.

## 3. Ambiguous-link overlay can render off-screen near the bottom of a long note

**What happens:** with `notes/archive/2025/q1/old-year-goals.md` open, an
ambiguous `[[LEGACY-IMPORT.MD]]` link near the bottom of the visible scroll
area renders its candidate-picker overlay partly or entirely below the fold.

**Bug — overlay positioning:** `AmbiguousLinkOverlay` is positioned via
`view.coordsAtPos(hit.from)` (`linkDecorations.ts:149`), i.e. screen
coordinates of the click at the moment it happened, with no clamping against
the viewport (`AmbiguousLinkOverlay.tsx` just uses `{ position: 'fixed',
left: x, top: y + 4 }` as-is). When the ambiguous link is near the bottom of
the visible scroll area, the overlay's candidate list renders partly or
entirely below the fold — present in the DOM, invisible on screen, unusable
without first scrolling the link itself higher up.

**Related, smaller UX note:** candidates in the overlay are ordinary
`<Link>` navigations (`AmbiguousLinkOverlay.tsx`) — misclicking the wrong
one navigates away with no undo besides the browser's back button. Likely
amplified by the positioning bug above (clicking a barely-visible or
off-screen panel invites mis-clicks); worth re-checking whether it's still
an issue once the positioning itself is fixed, rather than assumed to need
its own separate fix.

**Not yet fixed:** the overlay needs to clamp its position to the viewport
(flip above the click point instead of below when there isn't room, and/or
clamp `top`/`left` to stay fully on-screen) — same category of fix as
`LinksMenu.tsx`'s anchored-popover positioning, just needs the actual
viewport bounds check added, which no popover in this app currently does.

## 4. Trash panel can list the same current path twice, from two different deletes

**What happens:** the Trash panel can show two separate rows for the same
current path — one from an older delete, one from a more recent delete of
the same path (deleted, recreated, deleted again) — each with its own
independently-clickable Restore button.

**Root cause:** `listTrash()` (`lib/server/trash.ts`) surfaces every
un-restored `Delete "..."` commit in history independently. It was built and
verified against the case of one delete → one restore, but never against a
path that was deleted, recreated, and deleted *again* — each delete is a
distinct commit with no relationship to the others, so both legitimately
match "a delete with no later restore" and both get listed, even though only
one of them reflects what's actually sitting in git's history right now for
that path. Restoring the older one would `git revert` a commit several
generations behind the path's current state, which is likely to either
conflict for real or produce a confusing result — untested which, since this
was found right as the two-entry list itself was the more obviously broken
part.

**Not yet fixed:** `listTrash` needs to either dedupe to only the most
recent un-restored delete per current path, or the panel needs to make the
relationship between stacked deletes of the same path explicit instead of
presenting them as two unrelated, independently restorable items.

## 5. `writeNote`'s check-then-write was not atomic — two concurrent saves could silently lose one — FIXED

**Status: Fixed.** Data-loss bug in the exact mechanism Rule 2 depends on,
found during a final review pass, not left open like 1–4 above.

**Repro (deterministic, not timing-dependent):**
1. Open a note, note its `hash` (call it `H0`).
2. From server-side code (or two near-simultaneous browser tabs saving at
   the same instant), fire two saves in parallel, both with `baseHash: H0`
   but different content:
   ```ts
   const [a, b] = await Promise.all([
     writeNote(path, contentA, H0),
     writeNote(path, contentB, H0),
   ]);
   ```

**Expected:** exactly one save succeeds (`ok: true`); the other gets the
`conflict` result (`ok: false, reason: 'conflict'`), since its `baseHash`
no longer matches what the first save just wrote.

**Actual (before the fix):** both calls returned `ok: true`. `writeNote`
did `fs.readFile` → compare hash → `fs.writeFile` with nothing serializing
the sequence, so both concurrent calls could read the same on-disk bytes,
both see their `baseHash` match, and both write — the second one winning
silently. Confirmed by inspecting the final file content: tab A's entire
edit was gone, with no trace and no error surfaced to either caller.

**Root cause:** a classic check-then-act (TOCTOU) race. Every other place
this app touches the repo — commits, structural operations (rename/move/
delete/restore) — already serializes through one shared lock (`repoLock`
in `lib/server/mutex.ts`). `writeNote` in `lib/server/notes.ts` was the one
write path that had never been brought under it.

**Fix:** `writeNote` now runs its whole body inside `repoLock.run(...)`,
same as every other repo-touching operation. Verified the fix closes the
race by re-running the exact repro above against a scratch clone, twice:
one call now consistently succeeds and the other consistently gets the
conflict result, every time — a lock-based fix is deterministic, not
probabilistic, so this isn't "less likely to happen," it cannot happen.

**How to re-verify:** the repro above, run directly against `writeNote`
(no server needed) — a stale hash's `Promise.all` pair should always split
one `ok: true` / one `ok: false, reason: 'conflict'`.
