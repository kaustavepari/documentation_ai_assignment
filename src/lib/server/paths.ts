import 'server-only';

import path from 'node:path';
import { NOTES_ROOT } from './config';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * Every write path in this app takes a path from the client, so this is the
 * one chokepoint that decides whether a request may touch the filesystem.
 *
 * Note that decoding a URL component is NOT validation: `..%2F..%2Fetc%2Fpasswd`
 * decodes to a perfectly well-formed traversal. Resolve first, then prove the
 * result is still inside the repo.
 */
export function resolveInRepo(relPath: string): string {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new PathError('Path is empty.');
  }
  if (relPath.includes('\0')) {
    throw new PathError('Path contains a null byte.');
  }

  // Clients always speak POSIX separators; Windows may hand us backslashes.
  const abs = path.resolve(NOTES_ROOT, relPath.replace(/\\/g, '/'));
  const rel = path.relative(NOTES_ROOT, abs);

  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathError(`Path escapes the notes repo: ${relPath}`);
  }
  if (rel.split(path.sep)[0] === '.git') {
    throw new PathError('Refusing to touch .git internals.');
  }
  return abs;
}

/**
 * Inverse of resolveInRepo. Always emits forward slashes, because that is what
 * git and .noteindex.json use — on Windows path.relative would give backslashes
 * and silently desync the index from the repo.
 */
export function toRepoRelative(abs: string): string {
  return path.relative(NOTES_ROOT, abs).split(path.sep).join('/');
}
