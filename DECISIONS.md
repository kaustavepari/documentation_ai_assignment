# Decisions

Updated at the end of each build phase. Everything below is decided, built, and
verified — not planned. Sections appear as the work that justifies them lands.

**Current state: the tree, opening a note, editing and saving to disk all work,
with concurrent-edit detection and crash recovery. Create, Rename (including
link-aware rename/move), Delete, and Undo (toast plus a persistent Trash view,
both backed by `git revert`) are all built. All six CRUD/undo rules are
complete.**

---

## Structure: one process, one place that touches the repo

Next.js App Router, single process, single `npm run dev`. No separate API
server is required to run or keep in sync.

All filesystem and git access is confined to `src/lib/server/`, with every
module in it importing `server-only`. This turns the requirement that this
logic not reach the browser from a convention into a build error. This
matters beyond style: a stray import of the git module into a client
component would otherwise fail at runtime, in the browser, with a confusing
message.

The repo location is read from `NOTES_REPO_PATH` (default `../notes-data`) so
that the app repo and the notes repo remain separate, and so that a reviewer
can point the app at their own clone without editing source. The path is
validated at startup rather than on first use, so that a wrong path produces
a plain message about the wrong path rather than an `ENOENT` surfacing from
deep within a request.

## What counts as a note

**A note is a file under `notes/` that git is willing to track.**

Two conditions apply, and the second is the more consequential one.

**No filtering by name or type is applied inside `notes/`.** No extension
allowlist, no filename patterns; dotfiles and hidden folders are included.
This is what keeps `notes/drafts/.scratch/temp-debug-notes.md` in scope,
along with the five files that are not `.md` (`.markdown`, `.mdx`, `.org`,
`.txt`, and the uppercase `.MD` — 31 of the 36 are plain `.md`). No list of
excluded file types exists; there is no such list at all.

**The question of what counts as junk is delegated to the repo's own
`.gitignore`, not to a blocklist maintained in the app.** The note list comes
from `git ls-files --cached --others --exclude-standard -- notes`, which
returns "files git already tracks, plus new files git would accept." That
excludes `.DS_Store`, `*.swp`, `*.swo`, `*~`, `.env`, and `node_modules/` when
they appear inside `notes/` — because that is what this repo's `.gitignore`
specifies, not because those extensions were independently judged disposable.

The reasoning: every change in this app must become a git commit. A file git
refuses to track can never satisfy that condition. If the app listed a
`.DS_Store` as a note, it would appear in the tree, receive an entry in
`.noteindex.json`, and then silently fail to commit — leaving the index
claiming a note that has no history and does not exist as far as git is
concerned. Listing it would promise something the app is structurally unable
to deliver.

This was verified empirically rather than assumed: planting `.DS_Store`,
`.env`, `.todo.md.swp`, and `todo.md~` inside `notes/` leaves the count at 36
and `.noteindex.json` in sync. An earlier filesystem-walk implementation
counted them as notes and produced a count of 40; this criterion is what
corrected it.

**Rationale for delegation over a hardcoded blocklist:** a blocklist is a
standing bet that nothing matching its patterns is ever real content, and
this dataset deliberately plants deceptive filenames. Deferring to
`.gitignore` means the rule tracks whatever the notes repo specifies —
including changes made after this phase of work concludes — rather than a
fixed set of assumptions.

**Nothing is dropped silently.** `/api/health` reports two additional lists
alongside the notes: `ignoredUnderNotes` (junk inside `notes/` that git
ignores) and `outsideNotesDir` (`.gitignore`, `.noteindex.json`, `README.md`,
`assets/diagrams/auth-flow.svg` — repo furniture and one image referenced *by*
a note rather than being one itself). Every file in the repo lands in exactly
one of the three lists, so any of them can be audited and disputed
independently.

Result: 36 notes, 36 entries in `.noteindex.json`, no drift in either
direction — including every trap the repo sets, down to filenames containing
spaces, parentheses, and an emoji.

## A note is identified by its full relative path

This follows from the data rather than being a stylistic choice: `todo.md`
appears four times and `index.md` four times across different folders.
Nothing shorter than the full path is unique, so any code keyed on filename —
or on a slug derived from the title — will collide on those eight files.

A consequence worth stating explicitly: paths are always emitted with
forward slashes, even on Windows. Node's `path.relative` returns backslashes
there, while git and `.noteindex.json` both use forward slashes; mixing the
two would silently desync the index from the repo. One helper performs this
conversion, and no other code constructs relative paths directly.

Related: file extensions are read from the **last** dot, so
`notes/work/meetings/2025.07.15.retro.md` is treated as a `.md` file rather
than a `.07.15.retro.md` one.

## Every client path is validated before it reaches the disk

Not required by the brief, but every read, write, rename, and delete accepts
a path supplied by the browser. One function resolves the path and confirms
the result remains inside the notes repo before any filesystem call; `.git`
is refused outright.

This is distinct from URL decoding, which is not itself a safety step —
`..%2F..%2Fetc%2Fpasswd` decodes to a well-formed traversal.

## Git access goes through the real git binary

`simple-git`, which wraps the installed `git` executable, is used in place of
a pure-JavaScript reimplementation. The deciding factor is that the brief
requires a renamed note's history to survive, which depends on `git mv` and
git's own rename detection — behavior for which the real binary is the
reference implementation. The tradeoff is a dependency on `git` being
installed, which the assignment already implies.

Git invocations are limited to one at a time. Because the app is a single
process, serializing at that level is sufficient to prevent two concurrent
requests from interleaving staging and commits.

## The title rule was reverse-engineered, not invented

`.noteindex.json` already contained 36 correct titles, so the rule was
recovered from the data rather than chosen independently:

1. YAML frontmatter with a top-level `title:` — used verbatim.
2. Otherwise — the filename with its extension stripped, left untransformed.
   No title-casing, no dash-to-space conversion.

Only YAML frontmatter is honored. `notes/drafts/experiment-final-log.org`
opens with Org-mode's `#+TITLE: Experiment Log`, and the index still records
it as `experiment-final-log` — confirming that the fallback is triggered by
the *absence of frontmatter*, not the absence of a title. Reading the `.org`
header would have appeared more thorough while producing an incorrect
result.

This was confirmed by running the implementation against all 36 index
entries and matching every one. That check is what surfaced the `.org` case.

## Saves carry a hash of the bytes they started from

Every save sends a fingerprint of the file as it existed when the editor
opened it — a SHA-256 of the exact bytes. The server re-reads the file before
writing and compares fingerprints. If the fingerprint still matches, no other
process has touched the note and the write proceeds. If it does not match,
the note was changed underneath this editor, so the save is refused and the
server returns the current on-disk text instead of overwriting it.

The fingerprint is computed over the raw bytes rather than the decoded
string, so that two different byte sequences can never be treated as
identical merely because they render the same.

This constitutes the detection half of Rule 2, and it has been part of the
save path since its first version rather than retrofitted — a save endpoint
without it has the wrong shape, and adding it later would require changing
every caller.

**The check-then-write step must be atomic.** Read, compare, write is only
safe if nothing else executes between the read and the write. This was
confirmed directly: two genuinely concurrent saves against the same stale
hash both read the same on-disk bytes, both found their fingerprint matched,
and both wrote — the second silently overwriting the first with no conflict
ever raised to either caller. Every other point at which this app touches the
repo already goes through one shared lock (`repoLock`); this save path was
the one write site not yet brought under it. It has since been corrected.

**What the user sees on a real conflict.** The 409 response returns the
current on-disk content, and the editor presents two explicit choices: keep
mine (overwrite, now that the fresh state is known) or load theirs (discard
local edits, take what is on disk). Neither path is silent; both require the
user to choose with the losing version visible beforehand.

**What this does not do: merge.** A true three-way merge (git already
provides `git merge-file` for this purpose) would auto-resolve the common
case — two edits to different parts of the same note — with no dialog at
all, prompting a person only when lines genuinely overlap. This was
considered and deferred: the app already satisfies Rule 2 as written
("detect and warn" is one of the three options it explicitly names), and a
full merge represents enough additional surface area — a new save-path
branch, a new editor state for inline conflict markers — that it is recorded
below as the top priority for further work rather than partially built now.

## Typing saves the note automatically

Editing writes to disk 800ms after the last keystroke — long enough not to
fire mid-word, short enough that the delay is not noticeable. `Ctrl`/`Cmd-S`
skips the wait for users who reach for it by habit. Leaving a note flushes
whatever is still pending, using a request that outlives the component, so
that the last few keystrokes cannot be lost when navigating away.

The user is never required to press Save, but is always informed of where
their work stands: the header indicates whether the app is idle, writing, or
done.

## When a save becomes a commit

The commit unit is an **editing session** — one note, one continuous stretch
of work, one commit. Not one commit per autosave; committing on every
keystroke would render `git log` unusable, and the brief weights this
decision above all others.

Two mechanisms run on a timer, and they are distinct. **Flush** commits
immediately instead of waiting out the idle timer; it fires after 15 seconds
idle, on `Ctrl`/`Cmd`-S, on navigating to another note, and on tab close.
**Seal** ends the session so that the *next* edit starts a new commit; only
three conditions trigger it: the 10-minute settle window elapsing, another
process landing a commit in between (detected by confirming `HEAD` is still
this session's own commit sha), or the app restarting. Navigating away and
Ctrl-S both flush without sealing, by design: checking another note
mid-paragraph constitutes one episode of work rather than a new one, and a
user who invokes Ctrl-S out of habit every twenty seconds should not
fragment their own log.

While a session remains open, further typing **amends** its commit rather
than stacking a new one, so that five minutes of editing appears as one line
in `git log` rather than twenty. The commit message verb (`Create`,
`Retitle`, `Edit`) is recomputed from the diff against the session's base on
every amend rather than accumulated — which is what allows a session that
ultimately creates a note to read `Create` regardless of how many amends
occurred along the way, and what allows a session that writes 200 words and
then deletes 160 of them to conclude as `Edit (+40 words)`, an accurate
reflection of what occurred.

Word counts are used rather than line counts (`git diff --word-diff=porcelain`,
tokens counted per hunk). `--numstat` counts lines, and a markdown paragraph
is typically a single long soft-wrapped line — rewriting an entire paragraph
would register as `+1 -1`, and three new paragraphs would register as `+3`.
That result would not merely be imprecise; it would misrepresent the scale of
the work performed.

A session that types, commits, and is then undone back to its exact starting
content within the settle window does not leave a phantom commit behind:
`git reset --soft HEAD~1` removes it, because `git commit --amend` refuses a
no-op tree, and stacking a new commit instead would misrepresent a second
change as having occurred.

Every commit goes through an explicit pathspec (`git commit -- <path>`),
never `git commit -a` — this is what allows several notes to remain dirty on
disk simultaneously while only the one that has just settled is committed.

The 10-minute settle window is arbitrary, and this is stated plainly rather
than presented otherwise: its purpose is not to make the log more meaningful,
but to ensure commits eventually stop being amended, so that a commit
reviewed an hour earlier is not silently still being rewritten underneath the
viewer.

## Crash recovery

The session map described above resides in memory. If the process
terminates, the map is lost with it, and on restart there is no way to
recover which dirty files belonged to which editing session, since that
grouping was never recorded anywhere except that map. This is treated as a
genuine limit of the design rather than a gap to be closed later, and
recovery does not present it otherwise.

A marker file inside `.git/` (untracked, invisible to `git status`, never
appearing in the log) is written on startup and removed on clean shutdown.
Its presence at the next boot distinguishes "the working tree is dirty
because the app crashed while holding it" from "the working tree was already
dirty before the app started" — a distinction with concrete consequences
here, since `notes/drafts/quick-thought.md` was found hand-edited and
uncommitted in this repo at one point, and committing a reviewer's own edit
under a message claiming the app had recovered it would misrepresent the
artifact under review.

On a genuine crash, everything found dirty is swept into **one** commit,
explicitly labeled as a recovery with no claimed grouping
(`Recover N notes with unsaved edits`, with a body noting that intent
grouping is unavailable) — rather than fragmented into per-note commits that
would invent an intent never actually observed.

Known limitation: `next dev`'s own restarts can trip the same marker check
and produce a false "unclean shutdown" during ordinary development, not only
during an actual crash.

## Link parsing and resolution

Every note is scanned for `[[wiki links]]`, markdown links, and relative
image paths, and each is resolved against the real file list rather than
pattern-matched alone.

Wiki links are resolved by comparing the **trailing path segments**, exact
and case-insensitive, against every note's path with its extension stripped
— not by substring or fuzzy match. This is what allows `[[design/notes]]` to
disambiguate between the two files in this repo named `notes.md`, and what
ensures a target that merely happens to be a substring of some renamed
file's new name is correctly reported as broken rather than guessed at.

Markdown and image links are resolved as ordinary relative paths from the
*source* note's own directory, checked against the whole repo's file list —
not notes alone — since a relative image link can legitimately resolve
outside `notes/` and into `assets/`.

Two links are broken in the source data independent of anything the app
does: the image link in `auth-redesign-kickoff.md` is one `../` short of
reaching the repo root, and one wiki-link target is missing the date prefix
present in its real filename. **Decision: both are detected and surfaced,
and neither is silently rewritten in content the user never touched.**
Correcting content nobody asked to change is judged a worse failure than
leaving a link visibly broken.

This layer underlies rename and move: every affected link is classified as
either *fixable* (points directly at the note being moved, and is safe to
rewrite by construction, since a full repo-relative path cannot collide) or
*unfixable* (an unrelated link elsewhere that the move would newly render
ambiguous). Only the unfixable case requires a person; a move that touches
nothing but fixable links proceeds without a dialog.

## The sidebar and link lists show filenames, not titles — reversed from the first implementation

The first implementation used the computed title (see "The title rule was
reverse-engineered, not invented" above) as the primary label in the sidebar
and in the wiki-link list, on the premise that a title reads more clearly and
the path remains one hover away. Checking that premise against how
established wiki-link tools behave established it as incorrect.

Obsidian shows the filename typed inside `[[ ]]`, without exception;
displaying a frontmatter title instead exists only as a third-party plugin,
never the default. Logseq's own attempt at a title override is confusing
enough to have an open bug report requesting that it rename the file rather
than merely relabel it. TiddlyWiki treats a friendlier display field as an
explicit opt-in layered on top of the title, never a silent replacement. The
pattern holds across all three: the identifier a user would actually type or
click is what is shown by default, and a nicer display name is something the
author opts into — never something the app decides unilaterally.

This matters specifically here because the app resolves real `[[wiki links]]`
against real files and does not support `[[target|alias]]` syntax. When a
user writes `[[frontend-setup]]` and the app displayed "Frontend Setup Guide"
instead, that substitution was not authored by anyone — the app was silently
relabeling a name the user typed, with no means of opting out.

Resolution: `NoteTree.tsx` now shows the exact on-disk filename
(`LEGACY-IMPORT.MD`, `🎉 first-day.md`, all four `todo.md`s distinguished by
folder, consistent with any filesystem browser); `LinksMenu.tsx` and
`AmbiguousLinkOverlay.tsx` show resolved paths instead of titles, which was
the more significant defect — a title cannot disambiguate four files that
all match the same `[[todo]]` stem, whereas a path always can. The title rule
itself remains in place: it is still what `.noteindex.json` stores, still
what a note's own heading displays once opened (a document naming itself is
a distinct claim from the app relabeling it while browsing), and still
available as a hover tooltip elsewhere. What changed is which representation
is the default.

---

## What has been deferred, and the priority for further work

**A real merge for the two-tabs case.** Rule 2 is satisfied as written — the
save is never silently overwritten, and the user resolves a conflict with
both versions visible. However, "detect and warn" is the least sophisticated
of the three options the brief names. `git merge-file` already performs a
real three-way merge and would auto-resolve the common case (two edits to
different parts of the same note) with no dialog at all. This is the
top-priority item for further work.

**The four bugs recorded in `dev-notes/known-bugs.md`.** These were logged
rather than resolved mid-build, deliberately: none of them lose data or
corrupt the repo — they are UI-level (an overlay that can render
off-screen, a rename that silently no-ops in one specific
pre-existing-ambiguity case, the trash panel listing a path's older delete
alongside its current one). Fixable, but not prioritized ahead of work that
touches correctness directly.

**A live "someone else has this open" indicator.** The underlying data
already exists — `sessions.ts` tracks which notes have an open editing
session in memory, and `/api/note/status` already exposes it for a different
purpose. Surfacing it as a passive banner before a conflict occurs, rather
than only after, would be a small addition on top of what is already
tracked.

**Folder rename/move.** Explicitly out of scope from the outset, not a late
cut: a folder here is never a real entity on disk, only ever the side effect
of where its files currently reside (see "What counts as a note" and the
tree-is-recomputed-fresh reasoning throughout `structural.ts`), so "moving a
folder" does not have a single unambiguous meaning in the way that moving a
file does.
