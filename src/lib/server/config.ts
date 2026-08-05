import 'server-only';

import fs from 'node:fs';
import path from 'node:path';

/**
 * Absolute path to the notes repo (the clone of `notes-interview`).
 *
 * Configured via NOTES_REPO_PATH so the app repo and the notes repo stay
 * separate — see README. Relative values resolve against the app's cwd.
 */
// turbopackIgnore: the notes repo is intentionally outside this project and
// only known at runtime, so there is nothing here for the bundler to trace.
// Without this, Turbopack pulls the whole project into the server bundle.
export const NOTES_ROOT = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  process.env.NOTES_REPO_PATH ?? '../notes-data',
);

/** Where the notes themselves live, inside the repo. */
export const NOTES_DIR = path.join(NOTES_ROOT, 'notes');

/** The index file the app must keep in sync with the filesystem. */
export const INDEX_FILE = path.join(NOTES_ROOT, '.noteindex.json');

/**
 * The same file as a git pathspec. Git wants repo-relative forward slashes;
 * `INDEX_FILE` is absolute and, on Windows, backslashed — passing that to
 * `git add` is asking for trouble.
 */
export const INDEX_PATHSPEC = '.noteindex.json';

export type RepoCheck =
  | { ok: true; root: string }
  | { ok: false; root: string; problem: string };

/**
 * Fail loudly and early rather than throwing a confusing ENOENT deep inside a
 * request. Called by the health route and on first write.
 */
export function checkRepo(): RepoCheck {
  if (!fs.existsSync(NOTES_ROOT)) {
    return {
      ok: false,
      root: NOTES_ROOT,
      problem: 'Directory does not exist. Set NOTES_REPO_PATH in .env.local.',
    };
  }
  if (!fs.existsSync(path.join(NOTES_ROOT, '.git'))) {
    return {
      ok: false,
      root: NOTES_ROOT,
      problem: 'Not a git repository — every edit here becomes a commit, so this must be a git repo.',
    };
  }
  if (!fs.existsSync(NOTES_DIR)) {
    return { ok: false, root: NOTES_ROOT, problem: 'No notes/ directory inside the repo.' };
  }
  return { ok: true, root: NOTES_ROOT };
}
