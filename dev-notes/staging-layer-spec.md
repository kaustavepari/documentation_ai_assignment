# Spec: Staged changes and explicit commit

Source: `dev-notes/new_feature.txt`. Written before implementation, per
`to-spec` — synthesized from codebase analysis, not from an interview.

## Problem Statement

Right now every mutating action in this app — edit, create, rename, move,
delete — becomes a real git commit on its own, automatically, the moment it
happens (autosave's idle timer for edits, immediately on confirm for
structural operations). A user reorganising their notes as one piece of work
— create a file, rename two others, move a folder, delete something stale,
over about two minutes — produces five or six separate commits with no
single point at which they can review the whole thing and say "yes, that is
the change I meant to make." The decision to commit belongs to the code, not
to the user.

## Solution

Interpose a staging layer between the user's actions and the repository.
Every mutation is held as client-side state, durable across a reload via
IndexedDB, and shown wherever the app currently shows notes — the sidebar
tree, the open editor — as if it had already happened, without the real
notes filesystem or git history changing at all. The user reviews what's
pending and commits explicitly; only then are the real files written and a
real commit (or commits) produced. Discard clears the staged state and
returns the user to the last committed state with nothing to look at but
that.

## User Stories

1. As a user editing a note, I want my keystrokes to be held as a pending
   change rather than written straight to the repo, so that nothing reaches
   history until I say so.
2. As a user, I want `git log` to stay exactly as it was while I have
   unsaved staged work, so that the history only ever reflects decisions I
   actually finalized.
3. As a user, I want to see a pending-changes count somewhere in the UI at
   all times while something is staged, so I always know whether there's
   uncommitted work.
4. As a user, I want to reload the page in the middle of editing a note and
   find my edit still there, still pending, so a refresh can never silently
   discard my work.
5. As a user, I want to create a new note and have it show up in the sidebar
   immediately, even though nothing has been written to the real repo yet.
6. As a user, I want to rename a note and see it appear under its new name
   in the sidebar right away, without a commit having happened.
7. As a user, I want to move a note into a different folder and see it show
   up there immediately, staged rather than committed.
8. As a user, I want to delete a note and have it disappear from the tree
   immediately, without the underlying file actually being removed from the
   repo yet.
9. As a user, I want to open a note that has staged edits and see those
   edits, not the last-committed content, so what I see always matches what
   I actually did.
10. As a user, I want to open a note that was staged-renamed under its new
    path and have it work exactly as if the rename had already happened.
11. As a user, I want a note staged for deletion to behave as if it's gone —
    absent from the tree, not openable by its old path — even though it
    still physically exists in the repo until I commit.
12. As a user, I want to stage a create, a rename, and a delete together and
    see all three reflected as pending at once, with git log still
    untouched by any of them.
13. As a user, I want a single Commit action that writes everything I've
    staged to the real repository in one deliberate step.
14. As a user, after committing, I want `git status` on the notes repo to be
    clean — nothing left uncommitted that I thought I'd just committed.
15. As a user, I want the repository to end up reflecting the net result of
    my staged work, not a mechanical replay of every intermediate step I
    took to get there.
16. As a user, if I create a note and then delete that same note before
    committing, I want the repository to end up completely unchanged by
    either action once I commit.
17. As a user, if I edit the same note five times before committing, I want
    that to become one clean write, not five redundant ones.
18. As a user, if I rename a note twice before committing (A → B → C), I
    want the repository to end up with one rename, A → C, not two.
19. As a user, I want each distinct net change (a create, a rename, an
    edit, a delete) to still produce its own clearly labeled commit at
    commit time, so `git log` stays as readable as it already is today —
    not one opaque "batch commit" covering everything at once.
20. As a user, I want `.noteindex.json` to be correct immediately after
    commit, in the same hand-rolled formatting it already has, not
    reformatted wholesale.
21. As a user, I want the option to discard everything I've staged and
    return cleanly to the last committed state, with the tree and every
    open note reverting to match.
22. As a user, if committing one staged change fails (e.g. the note was
    changed by something else since I started editing it), I want that
    failure isolated to that one item — other staged changes that can still
    commit cleanly should not be blocked by it.
23. As a user, I want the failed item from a partial commit to remain
    staged afterward, with a visible reason, rather than silently vanishing
    or silently landing anyway.
24. As a user, I want staging to work the same way regardless of which
    state-management approach the app uses internally — that choice should
    be invisible to me.
25. As a developer maintaining this codebase, I want the fold/collapse logic
    that computes "what does the user's staged work actually amount to" to
    be a pure function, independent of IndexedDB and independent of React,
    so it can be reasoned about and tested in isolation.
26. As a developer, I want the actual git-writing code (`writeNote`,
    `renameNote`, `deleteNote`, index rebuilding) to be reused unchanged at
    commit time, rather than reimplemented for the staged path.

## Implementation Decisions

**Core seam: one pure fold module.** A single dependency-free module owns
two pure functions: `applyOp(state, op) -> state` (overlay one staged op
onto a base snapshot — same shape as `tree.ts`'s existing
`withClientFile`/`withClientFolder`, generalized to all four op types
instead of just create) and a collapse function that reduces a per-path
sequence of ops down to at most one net op before replay (an edit
overwrites the previous edit's content in place; create-then-delete on the
same identity collapses to nothing; a rename chain collapses to one
rename). Everything else in the feature is a thin adapter around this
module: IndexedDB for persistence, the existing git-writing pipeline for
replay.

**Op identity.** Staged records are keyed by the note's path *as of last
commit* (its stable identity), not by its current displayed path — a
record carries an optional `newPath` field for staged renames/moves. This
is what lets rename-then-edit-then-rename-again resolve to one record at
collapse time instead of being treated as unrelated ops on different keys.
A staged create has no prior committed path, so it is keyed by its
client-assigned path at creation time instead.

**IndexedDB schema.** One object store, one record per staged identity:
`{ id, op: 'edit' | 'create' | 'delete' | 'rename' | 'move', content?, newPath?, baseHash? }`.
Not an append-only event log — each user action upserts the record for its
identity in place, so redundant edits never accumulate as separate rows.
`baseHash` is carried over from the same SHA-256 fingerprinting the app
already uses (`hashOf` in `notes.ts`) so the existing conflict check can run
unmodified at commit time.

**In-memory mirror.** Actions update in-memory state synchronously (for
instant UI feedback) and persist to IndexedDB in parallel (for durability
across reload) — not sequentially through IndexedDB. On load, the client
reads every staged record once and seeds the in-memory store with it before
first paint. State-management container (Context+reducer, Zustand, etc.) is
left to the implementer's judgment per the brief's own framing; a reducer
maps directly onto "upsert one record per dispatched action" and is the
natural default, but the choice doesn't affect the module boundary above.

**Consistent reads.** `page.tsx` keeps doing exactly what it does today —
one server-side snapshot of committed state, unchanged. The staged overlay
is applied client-side, after hydration, in `AppShell`/`NoteEditor`, by
folding IndexedDB-backed state onto that snapshot — generalizing the
existing `withClientFile`/`withClientFolder` overlay in `tree.ts` rather
than introducing a second mechanism. This covers the sidebar tree (hide
staged deletes, relabel staged renames/moves, show staged creates) and the
open editor (staged content wins over server-provided content for any path
with a staged edit or create). Staged-awareness of link/backlink resolution
is treated as a stretch goal, not a baseline requirement — see Out of
Scope.

**Commit is one new server endpoint, not a client-side git call.**
`writeNote`/`renameNote`/`deleteNote` are `server-only` and cannot run in
the browser. The client collapses its own op log to net ops (reusing the
same pure collapse function, which also gives the client a natural "here's
what will actually happen" preview) and POSTs that net-op list to a new
endpoint. The endpoint executes each net op through the existing primitive
for its op type, under the existing `repoLock`, and reports per-op
success/failure back to the client.

**One real commit per net op, not one squashed batch commit.** Each net op
is replayed through the exact commit-message logic that already exists for
its type (`Create`/`Retitle`/`Edit`/`Rename`/`Move`/`Delete`, as built in
`sessions.ts`/`structural.ts`), producing several small, well-labeled
commits landing together rather than one commit whose message would have to
summarize an arbitrary mix of unrelated changes. This preserves the
existing "one operation, one meaningful commit" philosophy documented in
`DECISIONS.md` instead of inventing new batch-message logic.

**Partial commit failure is isolated per op, not all-or-nothing.** Each net
op already goes through the existing atomic write/rollback behavior
(`writeNote`'s conflict check, `structural.ts`'s `rollbackStructural`)
independently of the others. If op N of a batch fails (e.g. its `baseHash`
no longer matches disk because something else touched the repo since
staging began), ops before and after it are unaffected: successful ops
become real commits and are cleared from the client's staged state; the
failed op remains staged, with its failure reason surfaced, so the user can
retry or discard just that one.

**Discard** clears the client's staged state (in-memory and IndexedDB) for
either one identity or everything, with no server round-trip required,
since nothing staged has touched the real repo.

## Testing Decisions

The assignment's own brief lists tests as explicitly out of scope for this
build, and this codebase currently has no test framework or `__tests__`
tree to extend — there is no prior art to point to. Per that, no test
harness will be introduced as part of this work. The seam decision above is
made anyway, deliberately, so that if tests are added later the highest-
value one is trivial to write: the fold/collapse module takes and returns
plain objects, touches neither IndexedDB nor React, and its correctness
(net-effect collapsing in particular) is exactly the kind of logic that's
risky to leave unverified by hand. If time permits within the build window,
a small number of inline sanity checks against that module (not a formal
suite) are reasonable; they are not a commitment.

## Out of Scope

Carried over from `dev-notes/new_feature.txt` directly: undo/redo history,
branching or named change sets, new conflict-resolution UI, syncing staged
state between tabs or devices, auth, tests, deployment, visual redesign.

Additional calls made during this analysis, stated explicitly rather than
left ambiguous:

- Staged-aware link/backlink resolution (a staged rename updating how
  `[[wiki links]]` elsewhere resolve, before commit) is not a baseline
  requirement — the brief's three named read-consistency cases are the
  tree and the editor, not the link graph. Attempted only if stage two
  (create/rename/move/delete staging) and stage three (consistent reads for
  tree/editor) both land with time remaining.
- No server-side knowledge of staged state at any point before Commit — the
  server only ever sees the final, collapsed net-op list.
- Cross-tab conflict detection beyond the existing single-hash check
  (`baseHash` captured when a note's editing session starts) is not
  attempted — consistent with "syncing between tabs" being explicitly out
  of scope upstream.

## Further Notes

The brief itself sets the expectation of landing "somewhere in stage two"
within the 50-minute window and explicitly asks for what was skipped and
why, rather than full completion. This spec is written to support stopping
at any of its four build-order phases (edits-only staging → all four
op types staged → consistent reads → net effect and discard) and still
leaving the seam and schema decisions above intact for whichever phase is
reached, rather than requiring all of them to be true for any of them to be
correct.
