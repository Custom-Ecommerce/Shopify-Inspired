/* patch_orders_fix: store scoping + order helpers shared by the orders / stores routes */
import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import { HttpError } from '@/lib/http';
import type { AuthContext } from '@/lib/auth';
import { Store } from '@/lib/services';
import { storeEqualsOf, type FieldKind } from '@/lib/where';

/** The code of a request that must name its store and did not (CO-72). */
export const STORE_ID_REQUIRED = 'STORE_ID_REQUIRED';

/** Order fields a dashboard filter may use. */
export const ORDER_FIELDS: Record<string, FieldKind> = {
  orderId: 'string',
  status: 'string',
  paymentMethod: 'string',
  customerName: 'string',
  phone: 'string',
  city: 'string',
  total: 'number',
  subtotal: 'number',
  createdAt: 'date',
  updatedAt: 'date',
};

export const ORDER_SORT_FIELDS = ['createdAt', 'updatedAt', 'total', 'status', 'orderId'] as const;

/** An order as the dashboard receives it: id instead of _id, no internal bookkeeping. */
export function publicOrder(row: Record<string, unknown>): Record<string, unknown> {
  const { _id, __v, idempotencyKey, requestFingerprint, ...rest } = row;
  void __v;
  void idempotencyKey;
  void requestFingerprint;
  return { id: String(_id), ...rest };
}

/**
 * The store this request is about, verified against the signed-in seller.
 * Order of precedence: x-store-id header, then { store: { equals } } in ?where=, then the seller's
 * first owned store. A store the seller does not own is refused with 403 (admins may name any store).
 *
 * CO-72 (Sprint 6): the last step, the silent fall back to the seller's FIRST store, is a hazard for a seller with several stores: a request
 * that forgot to say which store would act on the oldest one (and, with plan limits, count against it). A route that WRITES or COUNTS says
 * so with `{ requireStore: true }`: no store named is then 400 STORE_ID_REQUIRED and nothing is read. The other routes keep the fallback, which
 * is documented and tested as intended for them (the BFF always sends x-store-id; see the Sprint 6 report for the list).
 */
export async function resolveOwnedStoreId(
  request: NextRequest,
  ctx: AuthContext,
  where: Record<string, unknown> | null,
  options: { requireStore?: boolean } = {},
): Promise<string> {
  const header = request.headers.get('x-store-id')?.trim() ?? '';
  const fromWhere = storeEqualsOf(where) ?? '';
  if (header !== '' && fromWhere !== '' && header !== fromWhere) throw new HttpError(403, 'Store mismatch');

  const candidate = header !== '' ? header : fromWhere;
  if (candidate === '') {
    if (options.requireStore === true) throw new HttpError(400, 'Say which store this is about (the x-store-id header).', STORE_ID_REQUIRED, 'x-store-id');
    if (ctx.actor !== 'seller') throw new HttpError(400, 'A store is required');
    const first = (await Store.findOne({ owner: ctx.userObjectId }).sort({ createdAt: 1 }).select('_id').lean()) as unknown as { _id: unknown } | null;
    if (!first) throw new HttpError(404, 'No store is linked to this account');
    return String(first._id);
  }

  if (!mongoose.isValidObjectId(candidate)) throw new HttpError(403, 'Store does not belong to this account');
  if (ctx.actor === 'seller') {
    const owned = await Store.exists({ _id: candidate, owner: ctx.userObjectId });
    if (!owned) throw new HttpError(403, 'Store does not belong to this account');
  }
  return candidate;
}
