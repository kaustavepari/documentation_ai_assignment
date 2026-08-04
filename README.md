# Notes

A web app for reading and editing a Git-backed notes repository, where every
change becomes a commit.

The app and the notes live in **two separate repositories** — this one holds the
code, and it reads and writes a clone of the notes repo that you point it at.

## Requirements

- **Node.js 20.9+** (Next.js 16 requires it)
- **Git** on your `PATH` — the app shells out to the real `git` binary

## Setup

Three commands rather than two, because the app needs to be told where your
notes clone lives:

```bash
npm install
cp .env.example .env.local     # then edit if your notes repo is elsewhere
npm run dev
```

`.env.local` holds a single setting:

```
NOTES_REPO_PATH=../notes-data
```

Point it at your clone of the notes repository. Relative paths resolve against
this directory; absolute paths work too. The default assumes the notes repo sits
beside this one:

```
parent/
├── notes-app/     ← this repository
└── notes-data/    ← your clone of the notes repo
```

Then open <http://localhost:3000>.

If the path is wrong or is not a Git repository, the app says so plainly rather
than failing later with a filesystem error.

## Checking the setup

`GET /api/health` reports what the app can see:

```json
{
  "ok": true,
  "filesOnDisk": 36,
  "entriesInIndex": 36,
  "inSync": true,
  "files": ["notes/archive/2024/q1/LEGACY-IMPORT.MD", "..."],
  "ignoredUnderNotes": [],
  "outsideNotesDir": [".gitignore", ".noteindex.json", "README.md", "assets/diagrams/auth-flow.svg"]
}
```

`inSync` compares the note list against `.noteindex.json` in both directions.
The two extra lists account for every remaining file in the repository, so
nothing is dropped without being shown.

## Current state

Scaffold and server layer only. The note tree and editor are the next phase;
`/` is a placeholder until then.

See [DECISIONS.md](./DECISIONS.md) for the reasoning behind the choices made so
far, including what counts as a note and why path handling works the way it does.

## Layout

```
src/
├── app/
│   ├── api/health/route.ts   setup check + note/index reconciliation
│   ├── layout.tsx
│   └── page.tsx
└── lib/server/               all filesystem and git access lives here
    ├── config.ts             where the notes repo is, and whether it is valid
    ├── git.ts                git handle scoped to the notes repo
    ├── paths.ts              path validation, traversal refusal, path helpers
    └── walk.ts               which files count as notes
```

Everything under `src/lib/server/` imports `server-only`, so wiring any of it
into browser code is a build error rather than a runtime surprise.
