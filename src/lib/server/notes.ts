import 'server-only';

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { NEW_FILE_HASH } from '../paths';
import { titleFor } from '../titles';
import { toAppContent, toDiskContent } from './eol';
import { repoLock } from './mutex';
import { PathError, resolveInRepo } from './paths';

export type Note = {
  path: string;
  title: string;
  /** Always LF. */
  content: string;
  /** SHA-256 of the bytes on disk, not of `content`. */
  hash: string;
};

/**
 * Identifies a note's exact on-disk state, so a save can prove it is editing
 * the version it was handed. Taken over the raw bytes rather than the decoded
 * string: two different byte sequences must never produce the same hash just
 * because they render the same.
 */
export function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Notes live under `notes/`. `resolveInRepo` already refuses anything outside
 * the repo; this narrows it further so the note endpoints cannot be aimed at
 * `README.md` or `.noteindex.json`, which the app manages by other means.
 *
 * Exported (not just used internally) because the structural operations —
 * create, rename, move, delete — all need this same `notes/`-confined
 * validation on paths that don't necessarily exist on disk yet.
 */
export function resolveNotePath(relPath: string): string {
  const clean = relPath.replace(/\\/g, '/');
  if (clean !== 'notes' && !clean.startsWith('notes/')) {
    throw new PathError(`Not a note: ${relPath}`);
  }
  return resolveInRepo(clean);
}

export async function readNote(relPath: string): Promise<Note> {
  const bytes = await fs.readFile(resolveNotePath(relPath));
  const raw = bytes.toString('utf8');
  const content = toAppContent(raw);

  return { path: relPath, title: titleFor(relPath, content), content, hash: hashOf(bytes) };
}

/**
 * Overwrite an existing note's content, preserving its on-disk line-ending
 * convention. No conflict check — for mechanical rewrites (link-target
 * fixups during a rename) where the caller already holds `repoLock` and
 * already knows the file exists.
 */
export async function writeNoteContentLocked(relPath: string, content: string): Promise<void> {
  const abs = resolveNotePath(relPath);
  const current = await fs.readFile(abs, 'utf8');
  await fs.writeFile(abs, Buffer.from(toDiskContent(content, current), 'utf8'));
}

export type SaveResult =
  | { ok: true; hash: string; title: string }
  | { ok: false; reason: 'conflict'; currentHash: string; currentContent: string };

/**
 * Write a note back to disk, but only if it still looks the way the caller was
 * told it looked.
 *
 * `baseHash` is what makes two tabs safe: the second save arrives holding a
 * hash of the content it started from, which no longer matches the file the
 * first save produced, so it is refused instead of overwriting. What the user
 * sees when that happens is a separate question from this function.
 *
 * This is the durability layer only — it puts bytes on disk and does not
 * commit. Committing is a separate decision about *when*, deliberately not
 * wired into the write path.
 *
 * The read-check-write sequence below is not atomic on its own — two
 * requests can both read the same on-disk state, both see their `baseHash`
 * matches, and both write, the second one silently winning with no conflict
 * ever raised to either caller. Confirmed empirically with two truly
 * concurrent calls before this lock was added: one save vanished completely,
 * and both callers were told `ok: true`. `repoLock` is the same one-at-a-time
 * serialization every other repo-touching operation in this app already
 * goes through; this was the one path that had never been brought under it.
 */
export async function writeNote(
  relPath: string,
  content: string,
  baseHash: string,
): Promise<SaveResult> {
  return repoLock.run(() => writeNoteLocked(relPath, content, baseHash));
}

async function writeNoteLocked(
  relPath: string,
  content: string,
  baseHash: string,
): Promise<SaveResult> {
  const abs = resolveNotePath(relPath);

  let current: Buffer;
  try {
    current = await fs.readFile(abs);
  } catch (error) {
    // A missing file is only expected when the caller is creating one, which
    // it signals with the sentinel hash. Any other missing-file case (a
    // stale edit whose note vanished) is not this function's problem to
    // interpret — let it propagate, same as before this branch existed.
    if (isEnoent(error) && baseHash === NEW_FILE_HASH) {
      return createNote(abs, relPath, content);
    }
    throw error;
  }

  const currentHash = hashOf(current);

  if (currentHash !== baseHash) {
    return {
      ok: false,
      reason: 'conflict',
      currentHash,
      currentContent: toAppContent(current.toString('utf8')),
    };
  }

  const bytes = Buffer.from(toDiskContent(content, current.toString('utf8')), 'utf8');
  await fs.writeFile(abs, bytes);

  return { ok: true, hash: hashOf(bytes), title: titleFor(relPath, content) };
}

/**
 * The create path: the caller believes nothing exists at `abs` yet.
 * Directories are made as needed — a brand-new folder is client-side-only
 * state until this very write (see crud-operations-spec.md), so nothing on
 * disk may exist above the file either.
 *
 * `wx` makes "must not already exist" an OS-enforced atomic check rather
 * than a check-then-write race: if two requests try to create the same new
 * note at once, the loser gets back the same conflict shape a stale edit
 * would, instead of silently clobbering the winner.
 */
async function createNote(abs: string, relPath: string, content: string): Promise<SaveResult> {
  const bytes = Buffer.from(content, 'utf8'); // no prior file to inherit an EOL convention from

  await fs.mkdir(path.dirname(abs), { recursive: true });

  try {
    const handle = await fs.open(abs, 'wx');
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isEexist(error)) throw error;
    const current = await fs.readFile(abs);
    return {
      ok: false,
      reason: 'conflict',
      currentHash: hashOf(current),
      currentContent: toAppContent(current.toString('utf8')),
    };
  }

  return { ok: true, hash: hashOf(bytes), title: titleFor(relPath, content) };
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isEexist(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
