# Notes

A web app for reading and editing a Git-backed notes repository, where editing a
note becomes a commit in that repository.

The app and the notes live in **two separate repositories**. This one holds the
code; it reads and writes a clone of the notes repo that you point it at.

| | |
|---|---|
| **App** | https://github.com/kaustavepari/documentation_ai_assignment |
| **Notes** | https://github.com/kaustavepari/documentation_ai_notes |

---

## Requirements

- **Node.js 20.9+** — Next.js 16 requires it
- **Git** on your `PATH` — the app shells out to the real `git` binary rather
  than reimplementing it

---

## Setup

You need **both** repositories side by side. The app has to be told where the
notes clone lives.

### 1. Clone the notes repository

```bash
git clone https://github.com/kaustavepari/documentation_ai_notes.git notes-data
```

This is the notes repo *after* the app was used on it, so its history is part of
the submission. To start from the untouched original instead, clone
`https://github.com/documentation-ai/notes-interview.git` — the app works
against either.

### 2. Clone this repository beside it

```bash
git clone https://github.com/kaustavepari/documentation_ai_assignment.git notes-app
```

You should end up with:

```
parent/
├── notes-app/     ← this repository (the code)
└── notes-data/    ← the notes repository (the data)
```

### 3. Install, configure, run

```bash
cd notes-app
npm install
cp .env.example .env.local
npm run dev
```

Then open <http://localhost:3000>.

That is three commands rather than two. The extra one is `cp .env.example
.env.local`, because the app refuses to guess where your notes live.

### Pointing somewhere else

`.env.local` holds one setting:

```
NOTES_REPO_PATH=../notes-data
```

Relative paths resolve against the `notes-app` directory; absolute paths work
too (`C:/Users/you/code/notes-data`). If the path is missing, is not a Git
repository, or has no `notes/` directory inside it, the app says which of those
is wrong on the page rather than failing later with a filesystem error.

**The app commits to whatever repo you point it at.** Point it at a clone you do
not mind adding history to.

---

## Checking it works

<http://localhost:3000/api/health>:

```json
{
  "ok": true,
  "filesOnDisk": 36,
  "entriesInIndex": 36,
  "inSync": true,
  "ignoredUnderNotes": [],
  "outsideNotesDir": [".gitignore", ".noteindex.json", "README.md", "assets/diagrams/auth-flow.svg"]
}
```

`filesOnDisk: 36` answers the brief's own check. `inSync` compares the note list
against `.noteindex.json` **in both directions**. The two extra lists account for
every remaining file in the repo, so nothing is dropped without being shown.

---

## How saving and committing work

This is the part worth reading, and the reasoning is in
[DECISIONS.md](./DECISIONS.md).

Typing is debounced and written to disk immediately — that is the durability
guarantee, and it is complete before any git command runs. Committing is a
separate, slower decision layered on top, so a commit failure never reports the
save as failed.

The commit unit is an **editing session**: one note, one continuous stretch of
work, one commit.

- A note's work is committed after **15 seconds idle**, or immediately on
  `Ctrl`/`Cmd`-S, on navigating to another note, or on closing the tab.
- While a session stays open, further typing **amends** that commit rather than
  stacking new ones, so five minutes of editing is one line in `git log`, not
  twenty. Amending stops after ten minutes so commits eventually settle.
- Amending only continues while `HEAD` is still that session's own commit. If
  anything else committed in between, the episode was interrupted and the work
  gets its own commit.
- Timers are **per note**, not global. Two notes edited a second apart become two
  commits, because they are two intents.

Commit messages are derived from the diff, recomputed on every amend — so a
session that ends up creating a note reads `Create` however many times it was
amended along the way:

```
Create "Sourdough Starter" — notes/recipes/sourdough-starter.md +120/-0
Retitle "Old Name" → "New Name"
Edit "Frontend Setup Guide" +14/-3
```

`.noteindex.json` is updated in the **same commit** as the change that caused it,
never as a commit of its own, so `git revert` puts the note and its index entry
back in one step.

The status pill in the editor header distinguishes **Saved to disk** from
**Committed**, because those are genuinely different guarantees.

**Crash recovery.** If the process dies, the in-memory session map dies with it
and the working tree is left dirty with no record of which edits belonged
together. On restart the app commits what it finds in a single commit that says
exactly that. It does not invent intent it never observed.

---

## What works, and what does not

Honest scope, since this was time-boxed.

**Working**

- **All 36 files open and save.** Spaces, parentheses, an emoji, five non-`.md`
  extensions, and the hidden `notes/drafts/.scratch/` folder are all included. A
  note is any file under `notes/` that Git will track, so the repo's own
  `.gitignore` decides what counts rather than a hardcoded list.
- **Nested folder tree** showing each note's title from `.noteindex.json` rather
  than its filename; filename and full path are in the hover tooltip.
- **Autosave, then commit**, as described above.
- **Concurrent-edit detection.** Every save carries a SHA-256 of the bytes it
  started from. A save whose base no longer matches is refused with `409` and the
  current content is returned rather than overwritten, so two tabs cannot
  silently clobber each other.
- **Line endings preserved per file.** This repo is checked out with
  `core.autocrlf=true`, so every file is CRLF on disk while a browser textarea
  normalises to LF. Without this, one edit would rewrite every line of the file.
- **Links are parsed, resolved, and shown.** `[[wiki links]]`, markdown links and
  relative image paths are resolved against the real file list — including the
  one that points at `.mdx` and the ones that carry a folder prefix. Broken and
  ambiguous targets are surfaced in the editor rather than silently rendered.
  Backlinks for a note are available at `/api/note/backlinks`.

**Not built**

- **Create, rename, move, and delete.** The link resolution needed to make a
  rename safe is in place, but the mutations themselves are not, so Rule 3's
  rewrite half and Rule 4 are unimplemented. Nothing in the app calls `git mv` or
  `git rm`.
- **The conflict resolution interface.** The `409` is detected and surfaced as a
  "Changed elsewhere" state with a retry, but there is no side-by-side diff or
  merge UI.

---

## Layout

```
src/
├── app/
│   ├── api/health/route.ts       setup check + note/index reconciliation
│   ├── api/note/route.ts         GET and PUT a note's text
│   ├── api/note/status/route.ts  has this note reached history yet?
│   ├── api/note/backlinks/       what points at this note
│   └── page.tsx                  tree + editor; ?path= selects the open note
├── components/
│   ├── NoteTree.tsx              nested sidebar
│   ├── NoteEditor.tsx            editor, autosave, save/commit status
│   └── editor/                   link decorations, links panel, ambiguity overlay
├── lib/
│   ├── links/                    parse, resolve, and invert the link graph (pure)
│   ├── paths.ts  titles.ts  tree.ts
│   └── server/                   all filesystem and git access lives here
│       ├── config.ts             where the notes repo is, and whether it is valid
│       ├── git.ts                git handle scoped to the notes repo
│       ├── notes.ts              read and write, with the hash guard
│       ├── sessions.ts           when an edit becomes a commit
│       ├── commit.ts             the git plumbing underneath that
│       ├── recovery.ts           what to do about a dirty tree at startup
│       ├── mutex.ts              one repo-changing operation at a time
│       ├── index-file.ts         .noteindex.json
│       └── walk.ts               which files count as notes
└── instrumentation.ts            runs startup recovery once, on boot
```

Everything under `src/lib/server/` imports `server-only`, so wiring any of it
into browser code is a build error rather than a runtime surprise.
