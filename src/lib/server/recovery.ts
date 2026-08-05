import 'server-only';

import { unlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { commitPaths, formatStat, wordStat } from './commit';
import { INDEX_PATHSPEC, NOTES_ROOT } from './config';
import { git } from './git';
import { repoLock } from './mutex';

/**
 * Crash recovery.
 *
 * If the process dies, the session map dies with it. On restart the working
 * tree is dirty and there is *no* intent information left — which of those
 * files belonged together was never in the filesystem. It cannot be
 * reconstructed, so this does not pretend to: everything recovered goes into
 * one commit that says exactly what it is.
 *
 * The app never invents intent it did not observe.
 */

/**
 * Lives inside `.git/`, so it is never tracked, never shows up in
 * `git status`, and never lands in the log.
 */
const MARKER = path.join(NOTES_ROOT, '.git', 'notes-app-running');

export type StartupReport =
  | { kind: 'clean' }
  | { kind: 'recovered'; sha: string; paths: string[] }
  | { kind: 'preexisting'; paths: string[] };

/** Paths under `notes/` (plus the index) that differ from HEAD. */
async function dirtyPaths(): Promise<string[]> {
  const out = await git().raw([
    'status', '--porcelain', '-z', '--untracked-files=all', '--', 'notes', INDEX_PATHSPEC,
  ]);

  const paths: string[] = [];
  // Porcelain v1 with -z: `XY <path>\0`, and renames add a second NUL-separated
  // path. Nothing here is quoted, which is the whole point of -z — three of
  // these filenames contain spaces or an emoji.
  const fields = out.split('\0').filter(Boolean);
  for (const field of fields) {
    if (field.length > 3 && field[2] === ' ') paths.push(field.slice(3));
  }
  return paths;
}

/**
 * Decide what an already-dirty tree at startup means, and act on it.
 *
 * The marker is what separates the two cases. Without it the app cannot tell
 * "we crashed holding unsaved work" from "this repo was already dirty when we
 * arrived" — and committing a reviewer's own hand-edits under a message
 * claiming the app recovered them would put a lie in the log.
 */
export async function runStartupRecovery(): Promise<StartupReport> {
  return repoLock.run(async () => {
    const crashed = await fs
      .access(MARKER)
      .then(() => true)
      .catch(() => false);

    await fs.writeFile(MARKER, `${process.pid}\n`, 'utf8').catch(() => undefined);
    installShutdownHooks();

    const paths = await dirtyPaths();
    if (paths.length === 0) return { kind: 'clean' };
    if (!crashed) return { kind: 'preexisting', paths };

    const lines: string[] = [];
    for (const p of paths) {
      const stat = formatStat(await wordStat('HEAD', [p]));
      lines.push(`  ${p}${stat ? ` ${stat}` : ''}`);
    }

    const message = [
      `Recover ${paths.length} note${paths.length === 1 ? '' : 's'} with unsaved edits`,
      '',
      'Autosaved to disk but not committed before the app exited.',
      'Intent grouping is unavailable for recovered edits.',
      '',
      ...lines,
    ].join('\n');

    const sha = await commitPaths({ paths, message });
    return { kind: 'recovered', sha, paths };
  });
}

let hooked = false;

function installShutdownHooks(): void {
  if (hooked) return;
  hooked = true;

  const clear = () => {
    try {
      // Sync: async cleanup does not reliably finish inside a signal handler.
      unlinkSync(MARKER);
    } catch {
      // Already gone, or the repo moved. Either way there is nothing to undo.
    }
  };

  process.once('exit', clear);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      clear();
      process.exit(0);
    });
  }
}
