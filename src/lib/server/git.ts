import 'server-only';

import simpleGit, { type SimpleGit } from 'simple-git';
import { NOTES_ROOT } from './config';

let instance: SimpleGit | null = null;

/**
 * Git handle scoped to the notes repo.
 *
 * maxConcurrentProcesses: 1 serialises every git invocation. This app is a
 * single Node process, so that alone removes a whole class of races — two
 * requests can't interleave `add`/`commit` and produce a commit containing
 * someone else's staged file.
 */
export function git(): SimpleGit {
  if (!instance) {
    instance = simpleGit({ baseDir: NOTES_ROOT, maxConcurrentProcesses: 1 });
  }
  return instance;
}
