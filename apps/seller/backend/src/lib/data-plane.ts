/* patch_orders_fix: store scoping + order helpers shared by the orders / stores routes */
import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import { HttpError } from '@/lib/http';
import type { AuthContext } from '@/lib/auth';
import { Store } from '@/lib/services';
import { storeEqualsOf, type FieldKind } from '@/lib/where';

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
 */
export async function resolveOwnedStoreId(
  request: NextRequest,
  ctx: AuthContext,
  where: Record<string, unknown> | null,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const StoreModel = Store as any;
  const header = request.headers.get('x-store-id')?.trim() ?? '';
  const fromWhere = storeEqualsOf(where) ?? '';
  if (header !== '' && fromWhere !== '' && header !== fromWhere) throw new HttpError(403, 'Store mismatch');

  const candidate = header !== '' ? header : fromWhere;
  if (candidate === '') {
    if (ctx.actor !== 'seller') throw new HttpError(400, 'A store is required');
    const first = (await StoreModel.findOne({ owner: ctx.userObjectId }).sort({ createdAt: 1 }).select('_id').lean()) as { _id: unknown } | null;
    if (!first) throw new HttpError(404, 'No store is linked to this account');
    return String(first._id);
  }

  if (!mongoose.isValidObjectId(candidate)) throw new HttpError(403, 'Store does not belong to this account');
  if (ctx.actor === 'seller') {
    const owned = await StoreModel.exists({ _id: candidate, owner: ctx.userObjectId });
    if (!owned) throw new HttpError(403, 'Store does not belong to this account');
  }
  return candidate;
}
