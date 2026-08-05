import 'server-only';

/**
 * Serialises async work that must not interleave.
 *
 * The app is a single Node process, so an in-process queue is enough — no file
 * locks, no database. Two things need it:
 *
 *   - `.noteindex.json`, which every create/rename/move/delete rewrites. The
 *     race there is broader than Rule 2: tab A renaming note X while tab B
 *     deletes note Y both read-modify-write the same JSON and one clobbers the
 *     other, even though they touched unrelated notes.
 *   - The commit path, where an amend decision reads HEAD and then writes it.
 *     Without serialisation another commit can land in between and the amend
 *     silently targets the wrong commit.
 *
 * What it does not protect against: a second process, or someone running git
 * by hand in the same repo.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    // Chain onto the tail whether or not the previous job threw, otherwise one
    // failure would wedge the queue permanently.
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Guards every write to the repo: commits, index rewrites, structural ops. */
export const repoLock = new Mutex();
