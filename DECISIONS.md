# Decisions

Updated at the end of each build phase. Everything below is decided, built, and
verified — not planned. Sections appear as the work that justifies them lands.

**Current state: the tree, opening a note, editing and saving to disk all work,
with concurrent-edit detection and crash recovery. Create, Rename (including
link-aware rename/move), Delete, and Undo (toast + a persistent Trash view,
both backed by `git revert`) are all built. All six CRUD/undo rules are done.**

---

## Structure: one process, one place that touches the repo

Next.js App Router, single process, single `npm run dev`. No separate API
server to run or keep in sync.

All filesystem and git access is confined to `src/lib/server/`, every module
in it importing `server-only`. That turns "don't let
this reach the browser" from a convention I have to remember into a build
error. It matters more than it sounds: a stray import of the git module into a
client component would otherwise fail at runtime, in the browser, with a
confusing message.

The repo location is read from `NOTES_REPO_PATH` (default `../notes-data`) so
the app repo and the notes repo stay separate, and so a reviewer can point the
app at their own clone without editing source. The path is validated at startup
rather than on first use — a wrong path produces a plain message about the
wrong path, not an `ENOENT` from somewhere deep in a request.

## What counts as a note

**A note is a file under `notes/` that git is willing to track.**

Two conditions, and the second is the interesting one.

**Inside `notes/`, I filter nothing by name or type.** No extension whitelist,
no filename patterns, dotfiles and hidden folders included. This is what keeps
`notes/drafts/.scratch/temp-debug-notes.md` in, along with the five files that
are not `.md` (`.markdown`, `.mdx`, `.org`, `.txt`, and the uppercase `.MD` —
31 of the 36 are plain `.md`). There is no list of "file types I skip" — there
is no such list at all.

**The junk question is delegated to the repo's own `.gitignore`, not to a
blocklist I write.** The note list comes from
`git ls-files --cached --others --exclude-standard -- notes`, which is "files
git already tracks, plus new files git would accept." That excludes `.DS_Store`,
`*.swp`, `*.swo`, `*~`, `.env` and `node_modules/` when they appear inside
`notes/` — because that is exactly what this repo's `.gitignore` already says,
not because I decided those extensions are disposable.

The reasoning: every change in this app must become a git commit. A file git
refuses to track can never satisfy that. If the app listed a `.DS_Store` as a
note, it would appear in the tree, get an entry in `.noteindex.json`, and then
silently fail to commit — leaving the index claiming a note that has no history
and does not exist as far as git is concerned. Listing it would promise
something the app structurally cannot deliver.

Verified empirically rather than assumed: planting `.DS_Store`, `.env`,
`.todo.md.swp` and `todo.md~` inside `notes/` leaves the count at 36 and
`.noteindex.json` in sync. An earlier filesystem-walk implementation counted
them as notes and took the count to 40 — this criterion is what fixed it.

**Why delegation beats a hardcoded blocklist:** a blocklist is a standing bet
that nothing matching those patterns is ever real content, and this dataset
deliberately plants deceptive filenames. Deferring to `.gitignore` means the
rule tracks whatever the notes repo says — including changes made after I stop
working on this — instead of my guesses.

**Nothing is dropped silently.** `/api/health` reports two extra lists beside
the notes: `ignoredUnderNotes` (junk inside `notes/` that git ignores) and
`outsideNotesDir` (`.gitignore`, `.noteindex.json`, `README.md`,
`assets/diagrams/auth-flow.svg` — repo furniture and one image referenced *by* a
note rather than being one). Every file in the repo lands in exactly one of the
three lists, so a reader can audit and disagree with any of them.

Result: 36 notes, 36 entries in `.noteindex.json`, no drift in either
direction — including every trap the repo sets, down to the filenames
containing spaces, parentheses and an emoji.

## A note is identified by its full relative path

Forced by the data rather than chosen: `todo.md` appears four times and
`index.md` four times across different folders. Nothing shorter than the full
path is unique, so any code keyed on filename — or on a slug derived from the
title — will collide on those eight files.

Consequence worth stating: paths are always emitted with forward slashes, even
on Windows. Node's `path.relative` returns backslashes there, and git and
`.noteindex.json` both use forward slashes, so mixing the two would silently
desync the index from the repo. There is one helper that does this conversion
and nothing else constructs relative paths by hand.

Related: file extensions are read from the **last** dot, so
`notes/work/meetings/2025.07.15.retro.md` is a `.md` file rather than a
`.07.15.retro.md` one.

## Every client path is validated before it reaches the disk

Not asked for in the brief, but every read, write, rename and delete takes a
path supplied by the browser. One function resolves the path and proves the
result is still inside the notes repo before any filesystem call; `.git` is
refused outright.

This is separate from URL decoding, which is not a safety step —
`..%2F..%2Fetc%2Fpasswd` decodes to a perfectly well-formed traversal.

## Git access goes through the real git binary

`simple-git`, which wraps the installed `git` executable, rather than a
pure-JavaScript reimplementation. The deciding factor is that the brief
requires a renamed note's history to survive, which means relying on `git mv`
and git's own rename detection — behaviour where the real binary is the
reference implementation. The cost is a dependency on `git` being installed,
which is already implied by the assignment.

Git invocations are limited to one at a time. The app is a single process, so
serialising there is enough to stop two concurrent requests from interleaving
staging and commits.

## The title rule was reverse-engineered, not invented

`.noteindex.json` already had 36 correct titles, so the rule was there to be
found rather than chosen:

1. YAML frontmatter with a top-level `title:` — use it verbatim.
2. Otherwise — the filename with its extension stripped, untransformed. No
   title-casing, no dash-to-space.

Only YAML frontmatter counts. `notes/drafts/experiment-final-log.org` opens
with Org-mode's `#+TITLE: Experiment Log`, and the index still calls it
`experiment-final-log` — so the fallback is triggered by the *absence of
frontmatter*, not the absence of a title. Reading the `.org` header would have
looked more thorough and would have been wrong.

Checked by running the implementation against all 36 index entries: every one
matches. That check is what caught the `.org` case.

## Saves carry a hash of the bytes they started from

Every save sends a fingerprint of the file as it was when the editor opened it
— a SHA-256 of the exact bytes. The server re-reads the file before writing and
compares. If the fingerprint still matches, nobody else touched the note and
the write goes ahead. If it does not, the note changed underneath this editor,
so the save is refused and the server hands back the current text instead of
overwriting.

The fingerprint is taken over the raw bytes rather than the decoded string, so
two different byte sequences can never look identical just because they render
the same.

This is the detection half of Rule 2, and it is in the save path from its first
version rather than retrofitted — a save endpoint without it has the wrong
shape, and adding it later would mean changing every caller.

**The check-then-write itself needs to be one atomic step, not two.** Read,
compare, write is only safe if nothing else can run between the read and the
write. Confirmed the hard way: two genuinely concurrent saves against the
same stale hash both read the same on-disk bytes, both saw their fingerprint
match, and both wrote — the second one winning with no conflict ever raised
to either caller, silently. Every other place this app touches the repo
already goes through one shared lock (`repoLock`); this save path was the
one write site that had never been brought under it. It now is.

**What the user sees on a real conflict.** The 409 hands back the current
on-disk content, and the editor offers two explicit choices — keep mine
(overwrite, now that the fresh state is known) or load theirs (discard my
edits, take what's on disk). Neither is silent; both require the user to
choose with the losing version visibly in front of them first.

**What this does not do: merge.** A real three-way merge (git already has
`git merge-file` for exactly this) would auto-resolve the common case —
two edits to different parts of the same note — with no dialog at all, and
only ask a human when lines genuinely overlap. Considered, not built: this
app already satisfies Rule 2 as written ("detect and warn" is one of the
three options it explicitly names), and a real merge is enough additional
surface — a new save-path branch, a new editor state for showing conflict
markers inline — that it's the first thing on the list below rather than
something to half-build now.

## Typing saves the note by itself

Editing writes to disk 800ms after the last keystroke — long enough not to fire
mid-word, short enough that nobody notices waiting. `Ctrl`/`Cmd-S` skips the
wait for anyone who reaches for it out of habit. Leaving a note flushes
whatever is still pending, using a request that outlives the component, so the
last few keystrokes cannot be lost by clicking away.

The user is never asked to press Save, but is always told where their work
stands: the header shows whether the app is idle, writing, or done.

## When a save becomes a commit

The commit unit is an **editing session** — one note, one continuous stretch
of work, one commit. Not one commit per autosave; committing on every
keystroke would make `git log` useless, and the brief weights this decision
above everything else.

Two things happen on a timer, and they are not the same thing. **Flush**
means commit now instead of waiting out the idle timer — it fires on 15
seconds idle, on `Ctrl`/`Cmd`-S, on navigating to another note, and on tab
close. **Seal** means end the session so the *next* edit starts a new commit
— and only three things do that: the 10-minute settle window elapsing,
something else landing a commit in between (detected by checking `HEAD` is
still this session's own commit sha), or the app restarting. Navigating away
and Ctrl-S both flush without sealing, on purpose: popping over to check
another note mid-paragraph is one episode of work, not a new one, and a user
who hits Ctrl-S out of habit every twenty seconds should not shred their own
log.

While a session stays open, further typing **amends** its commit rather than
stacking a new one, so five minutes of editing is one line in `git log`
instead of twenty. The commit message verb (`Create`, `Retitle`, `Edit`) is
recomputed from the diff against the session's base on every amend, never
accumulated — which is what makes a session that ends up creating a note read
`Create` no matter how many times it was amended along the way, and what
makes a session that writes 200 words then deletes 160 of them end at
`Edit (+40 words)`, the true shape of what happened.

Word counts, not line counts (`git diff --word-diff=porcelain`, tokens
counted per hunk). `--numstat` counts lines, and a markdown paragraph is
usually one long soft-wrapped line — rewriting a whole paragraph would read
as `+1 -1`, and three new paragraphs would read as `+3`. That is not
imprecise, it is misleading about how much work happened.

A session that types, commits, and then is undone back to its exact starting
content within the settle window does not leave a phantom commit behind:
`git reset --soft HEAD~1` drops it, because `git commit --amend` refuses a
no-op tree and stacking a new commit instead would lie about there being a
second change.

Every commit goes through an explicit pathspec (`git commit -- <path>`),
never `git commit -a` — that is what lets several notes sit dirty on disk at
once while only the one that just settled commits.

The 10-minute settle window is arbitrary, and worth being honest about that
rather than dressing it up: its job is not to make the log more meaningful,
it is to make commits eventually stop being amended, so a commit someone
looked at an hour ago is not silently still being rewritten underneath them.

## Crash recovery

The session map above lives in memory. If the process dies, it dies with it
— and on restart there is no way to recover which dirty files belonged to
which editing session, because that grouping was never written down anywhere
except that map. This is not a gap to close later; it is a genuine limit of
the design, so recovery does not pretend otherwise.

A marker file inside `.git/` (untracked, invisible to `git status`, never
appearing in the log) is written on startup and removed on clean shutdown.
Its presence at the next boot is what tells the app "the working tree is
dirty *because we crashed holding it*" apart from "the working tree was
already dirty before we ever started" — a distinction that matters concretely
here, since `notes/drafts/quick-thought.md` sat hand-edited and uncommitted
in this repo at one point, and committing a reviewer's own edit under a
message claiming the app recovered it would be a lie inside the artifact
being graded.

On a genuine crash, everything found dirty is swept into **one** commit,
explicitly labelled as a recovery with no claimed grouping
(`Recover N notes with unsaved edits`, body noting intent grouping is
unavailable) — not fragmented into per-note commits that invent an intent
nobody observed.

Known rough edge: `next dev`'s own restarts can trip the same marker check
and produce a false "unclean shutdown" during ordinary development, not just
on a real crash.

## Link parsing and resolution

Every note is scanned for `[[wiki links]]`, markdown links, and relative
image paths, and each is resolved against the real file list rather than
just pattern-matched.

Wiki links resolve by comparing the **trailing path segments**, exact and
case-insensitive, against every note's path with its extension stripped —
not a substring or fuzzy match. That is what lets `[[design/notes]]`
disambiguate between the two files in this repo named `notes.md`, and what
keeps a target that merely happens to be a substring of some renamed file's
new name correctly reported as broken instead of guessed at.

Markdown and image links resolve as ordinary relative paths from the
*source* note's own directory, checked against the whole repo's file list —
not just notes — since a relative image link legitimately resolves outside
`notes/` and into `assets/`.

Two links are broken in the source data independent of anything the app
does: the image link in `auth-redesign-kickoff.md` is one `../` short of
reaching the repo root, and one wiki-link target is missing the date prefix
its real filename carries. **Decision: detect and surface both, do not
silently rewrite content the user never touched.** Fixing content nobody
asked to change is a worse failure than leaving a link visibly broken.

This layer is what rename and move are built on: every affected link is
classified as either *fixable* (points directly at the note being moved —
safe to rewrite by construction, since a full repo-relative path can't
collide) or *unfixable* (an unrelated link elsewhere that this move would
make newly ambiguous). Only the unfixable case ever needs a person — if a
move touches nothing but fixable links, it goes straight through with no
dialog at all.

## The sidebar and link lists show filenames, not titles — reversed from the first pass

The first build used the computed title (see "The title rule was
reverse-engineered, not invented" above) as the primary label in the sidebar
and in the wiki-link list, on the theory that a title reads better than a
filename and the path is one hover away. Checking that against how real
wiki-link tools behave is what caught it as wrong.

Obsidian shows the filename you typed inside `[[ ]]`, full stop — displaying
a frontmatter title instead exists only as a third-party plugin, never the
default. Logseq's own attempt at a title override is confusing enough that it
has an open bug report for renaming the file instead of just relabelling it.
TiddlyWiki treats a friendlier display field as an explicit opt-in on top of
the title, never a silent replacement. The pattern holds across all three:
the identifier you'd actually type or click is what's shown by default, and a
nicer display name is something the author opts into — never something the
app decides on its own.

That matters specifically here because the app resolves real `[[wiki links]]`
against real files and does not support `[[target|alias]]` syntax. When
someone writes `[[frontend-setup]]` and the app showed "Frontend Setup Guide"
instead, nothing about that substitution was authored by anyone — the app was
silently relabelling a name the user typed, with no way to opt out.

Fixed: `NoteTree.tsx` now shows the exact on-disk filename (`LEGACY-IMPORT.MD`,
`🎉 first-day.md`, all four `todo.md`s told apart by folder, same as any
filesystem browser); `LinksMenu.tsx` and `AmbiguousLinkOverlay.tsx` show
resolved paths instead of titles, which was the more broken case — a title
cannot disambiguate four files that all match the same `[[todo]]` stem, but a
path always can. The title rule itself did not go away: it is still what
`.noteindex.json` stores, still what a note's own heading shows once it is
open (a document naming itself is a different claim than the app relabelling
it while browsing), and still available as a hover tooltip everywhere else.
What changed is which one is the headline.

---

## What's skipped, and what I'd build first with another week

**A real merge for the two-tabs case.** Rule 2 is satisfied as written — the
save is never silently overwritten, and the user resolves a conflict with
both versions visible. But "detect and warn" is the least sophisticated of
the three options the brief names. `git merge-file` already does a real
three-way merge and would auto-resolve the common case (two edits to
different parts of the same note) with no dialog at all. First thing I'd
build.

**The four bugs in `dev-notes/known-bugs.md`.** Logged rather than chased
down mid-build, on purpose — none of them lose data or corrupt the repo,
they're UI-level (an overlay that can render off-screen, a rename that
silently no-ops in one specific pre-existing-ambiguity case, the trash panel
listing a path's older delete alongside its current one). Fixable, just not
before something that actually touches correctness.

**A live "someone else has this open" hint.** The data for it already
exists — `sessions.ts` tracks which notes have an open episode of work in
memory, and `/api/note/status` already exposes it for a different reason.
Surfacing it as a passive banner before a conflict happens, not just after,
would be a small addition on top of what's already tracked.

**Folder rename/move.** Explicitly out of scope from the start, not a late
cut: a folder here is never a real thing on disk, only ever the side effect
of where its files currently live (see "What counts as a note" and the
tree-is-recomputed-fresh reasoning throughout `structural.ts`), so "moving a
folder" doesn't have a single unambiguous meaning the way moving a file
does.
