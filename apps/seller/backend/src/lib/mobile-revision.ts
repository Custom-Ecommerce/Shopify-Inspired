import { HttpError } from '@/lib/http';

/*
 * Sprint 9 (EP-31.US03): the revision of a record is its updatedAt in milliseconds (0 for a record without one). Mongoose moves updatedAt on every write of
 * these collections, so no write path had to change, and a write on a revision is a compare-and-set on updatedAt.
 */

export function revisionOf(updatedAt: unknown): number {
  const time = updatedAt instanceof Date ? updatedAt.getTime() : typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

/** The part of a write's filter that makes it apply only to the revision the caller saw. */
export function revisionFilter(revision: number): Record<string, unknown> {
  return revision === 0 ? { updatedAt: { $exists: false } } : { updatedAt: new Date(revision) };
}

export interface Stamp {
  revision: number;
  updatedAt: string;
}

/** revision and updatedAt of a stored row; a row without updatedAt shows when it was created. */
export function stampOf(row: unknown): Stamp {
  const doc = (row ?? {}) as { updatedAt?: unknown; createdAt?: unknown };
  const shown = revisionOf(doc.updatedAt) || revisionOf(doc.createdAt);
  return { revision: revisionOf(doc.updatedAt), updatedAt: new Date(shown).toISOString() };
}

/** The record is not the one the caller saw. A mobile route answers 409 CONFLICT with the current record. */
export class RevisionConflictError extends HttpError {
  /** The stored row as it is now (when the thrower has it). */
  readonly current: unknown;

  constructor(current: unknown = null) {
    super(409, 'This changed since you last saw it. Check the current values and try again.', 'CONFLICT');
    this.name = 'RevisionConflictError';
    this.current = current;
  }
}
