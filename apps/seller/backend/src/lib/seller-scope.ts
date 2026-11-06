import { HttpError } from '@/lib/http';
import type { AuthContext } from '@/lib/auth';
import { Store, User } from '@/lib/services';

/**
 * The store the signed-in seller owns. A seller account has one store (User.store). A seller with no store
 * gets 404: there is nothing to read or change.
 */
export async function requireSellerStoreId(ctx: AuthContext): Promise<string> {
  const user = (await User.findById(ctx.userObjectId).select('store').lean()) as { store?: unknown } | null;
  if (user && user.store) return String(user.store);
  /* patch_orders_fix: stores created through the workspace flow are linked by Store.owner, not User.store */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owned = (user ? await (Store as any).findOne({ owner: ctx.userObjectId }).sort({ createdAt: 1 }).select("_id").lean() : null) as { _id: unknown } | null;
  if (!owned) throw new HttpError(404, 'No store is linked to this account');
  return String(owned._id);
}

/** Wire form: id instead of _id, and no Mongoose bookkeeping field. */
export function toWire(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest };
}

/** The plain form of a Mongoose document, as JSON would carry it, so it can be mapped to the wire form. */
export function plainDoc(doc: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}
