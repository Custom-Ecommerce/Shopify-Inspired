import mongoose from 'mongoose';

/**
 * Sprint 5 EP-11.US04.T02 (D-106): the `sellers` mirror row, made at store creation.
 *
 * The admin console and the sync dispatcher look a store's owner up in the shared database's `sellers` collection (the row
 * whose _id is the owner's user id). scripts/bootstrap-admin-data.mjs fills it for the sellers that existed when it ran; a
 * seller who signed up afterwards had none, so a commission rate change for their store stayed OWNER_TRANSLATION_PENDING.
 * Creating a store now makes the row, with the same shape as the script (see scripts/lib/bootstrap-admin-plan.mjs):
 *
 *   _id       the owner's user id (ObjectId)
 *   sellerId  the same id as text
 *
 * The write is an idempotent upsert with $setOnInsert only: a second store of the same owner, a repeat, a lost race and a row
 * the bootstrap made all change nothing. Best effort: it never throws, because the store already exists and a seller must
 * not be told their store failed over a mirror row (the bootstrap script remains the backfill).
 */

export interface SellerMirrorCollection {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options: { upsert: boolean }): Promise<unknown>;
}

export interface SellerMirrorDeps {
  /** True when the database connection is open. Without it nothing is attempted (a driver call would wait for a connection). */
  ready?: () => boolean;
  collection?: () => SellerMirrorCollection;
  now?: () => Date;
}

/** The filter and update of the upsert, pure so a test can read them. */
export function sellerMirrorWrite(ownerId: string, now: Date): { filter: Record<string, unknown>; update: Record<string, unknown> } {
  const _id = new mongoose.Types.ObjectId(ownerId);
  return { filter: { _id }, update: { $setOnInsert: { sellerId: ownerId, createdAt: now, updatedAt: now } } };
}

const defaultReady = (): boolean => mongoose.connection.readyState === 1;
const defaultCollection = (): SellerMirrorCollection => mongoose.connection.collection('sellers') as unknown as SellerMirrorCollection;

/** Returns true when the row exists afterwards (created or already there), false when it could not be written. Never throws. */
export async function ensureSellerMirror(owner: unknown, deps: SellerMirrorDeps = {}): Promise<boolean> {
  const ownerId = String(owner ?? '');
  if (!mongoose.isValidObjectId(ownerId)) return false;
  try {
    if (!(deps.ready ?? defaultReady)()) return false;
    const { filter, update } = sellerMirrorWrite(ownerId, (deps.now ?? (() => new Date()))());
    await (deps.collection ?? defaultCollection)().updateOne(filter, update, { upsert: true });
    return true;
  } catch (err) {
    // 11000: two stores created at once both upserted; the row is there.
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000) return true;
    console.error('[seller-backend] could not write the sellers mirror row', err instanceof Error ? err.name : 'unknown');
    return false;
  }
}
