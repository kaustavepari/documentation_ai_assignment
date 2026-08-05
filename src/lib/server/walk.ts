import 'server-only';

import { git } from './git';

/**
 * `git ls-files` quotes paths containing non-ASCII or spaces
 * (`"notes/…/\360\237\216\211 first-day.md"`), which would corrupt three of the
 * 36 filenames. `-z` emits raw NUL-separated paths instead, so nothing is
 * escaped and nothing needs unquoting.
 */
async function lsFiles(flags: string[]): Promise<string[]> {
  const out = await git().raw(['ls-files', ...flags, '-z', '--', 'notes']);
  return out.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/**
 * Every note.
 *
 * A note is a file under `notes/` that git is willing to track — tracked
 * already (`--cached`), or new and not ignored (`--others --exclude-standard`).
 *
 * Delegating the "is this junk?" question to the repo's own `.gitignore`
 * rather than to a hardcoded blocklist is deliberate. Every change in this app
 * has to become a commit; a file git refuses to track can never satisfy that,
 * so listing it would promise something the app cannot deliver. It also means
 * the rule follows whatever the notes repo says, instead of my guesses about
 * which filenames are disposable.
 *
 * Within that constraint there is no filtering at all: no extension whitelist,
 * no name patterns, dotfiles and hidden folders included. That is what keeps
 * `notes/drafts/.scratch/temp-debug-notes.md` and the five non-`.md` files in.
 */
export async function listNoteFiles(): Promise<string[]> {
  return lsFiles(['--cached', '--others', '--exclude-standard']);
}

/**
 * Files sitting under `notes/` that git ignores — editor swap files, `.DS_Store`
 * and anything else matching `.gitignore`.
 *
 * Reported rather than silently skipped: the brief says not to quietly drop
 * files, so the app shows what it dropped and why it is droppable.
 */
export async function listIgnoredUnderNotes(): Promise<string[]> {
  return lsFiles(['--others', '--ignored', '--exclude-standard']);
}

/** Tracked repo files outside `notes/` — the index, README, .gitignore, assets. */
export async function listOutsideNotes(): Promise<string[]> {
  const out = await git().raw(['ls-files', '-z']);
  return out
    .split('\0')
    .filter((p) => p && !p.startsWith('notes/'))
    .sort((a, b) => a.localeCompare(b));
}
