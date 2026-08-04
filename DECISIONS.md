# Decisions

Updated at the end of each build phase. Everything below is decided, built, and
verified — not planned. Sections appear as the work that justifies them lands.

**Current state: end of Phase 0 (scaffold + server boundary).**

---

## Structure: one process, one place that touches the repo

Next.js App Router, single process, single `npm run dev`. No separate API
server to run or keep in sync.

All filesystem and git access is confined to four modules under
`src/lib/server/`, each of which imports `server-only`. That turns "don't let
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
`notes/drafts/.scratch/temp-debug-notes.md` in, along with the six files that
are not `.md` (`.markdown`, `.mdx`, `.org`, `.txt`, and the uppercase `.MD`).
There is no list of "file types I skip" — there is no such list at all.

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

---

*Still to be decided, in the phases that produce them: when to commit, how to
handle two tabs editing at once, how renames treat links, and how delete and
undo behave.*
