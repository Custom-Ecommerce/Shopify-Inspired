/*
 * Wire helpers shared by the seller routes. The store a request is about comes from resolveOwnedStoreId in
 * '@/lib/data-plane' (x-store-id verified against Store.owner); the old first-store lookup was removed in
 * Sprint 4 SB-1 (CO-57).
 */

/** Wire form: id instead of _id, and no Mongoose bookkeeping field. */
export function toWire(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest };
}

/** The plain form of a Mongoose document, as JSON would carry it, so it can be mapped to the wire form. */
export function plainDoc(doc: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}
