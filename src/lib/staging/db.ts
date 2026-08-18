import type { StagedRecord } from './types';

/**
 * The IndexedDB adapter — the durable half of the staging layer. Thin on
 * purpose: every function here just moves `StagedRecord`s in and out of one
 * object store. The interesting logic lives in `fold.ts`, which knows
 * nothing about IndexedDB at all.
 *
 * One object store, one record per staged identity (`keyPath: 'id'`), so a
 * `put` naturally upserts — never an append-only log, matching the schema
 * decision in `dev-notes/staging-layer-spec.md`.
 *
 * IndexedDB is mandatory per the brief's own constraint (not localStorage):
 * a staged edit can be arbitrarily large note content, and IndexedDB is the
 * only browser store built for that plus async, non-blocking access.
 */

const DB_NAME = 'notes-staging';
const DB_VERSION = 1;
const STORE = 'staged';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the staging database.'));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Every staged record, read once — used to seed the in-memory store on load. */
export async function loadAllStaged(): Promise<StagedRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = tx(db, 'readonly').getAll();
    request.onsuccess = () => resolve(request.result as StagedRecord[]);
    request.onerror = () => reject(request.error ?? new Error('Could not read staged changes.'));
  });
}

/** Upserts one record — `put` replaces whatever was stored under this `id`. */
export async function putStaged(record: StagedRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = tx(db, 'readwrite').put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not persist the staged change.'));
  });
}

export async function deleteStaged(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = tx(db, 'readwrite').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not clear the staged change.'));
  });
}

/** Used by Discard (ticket 09) — clears every staged record at once. */
export async function clearAllStaged(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = tx(db, 'readwrite').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not clear staged changes.'));
  });
}
