import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { toSellerCart } from '@/lib/abandoned-carts';
import { readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { ABANDONED_CART_NOT_FOUND, ABANDONED_CART_STATUS_CHANGED, abandonedCartContactedRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { AbandonedCart, assertCan, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const notFound = (): HttpError => new HttpError(404, 'Cart not found', ABANDONED_CART_NOT_FOUND);


async function audit(action: string, storeId: string, cartId: string, userId: string): Promise<void> {
  try {
    // Ids and the time only: never the phone, the email or the items.
    await writeAuditLog(action, 'store', storeId, 'seller:' + userId, { storeId, cartId, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the abandoned cart audit entry', err instanceof Error ? err.name : 'unknown');
  }
}

/**
 * PATCH /api/stores/:id/abandoned-carts/:cartId { status: 'contacted' } (Sprint 5 EP-28.US01.T04): the seller messaged this shopper. ONE
 * compare-and-set on { _id, store, status: open }: a cart that is already contacted or recovered answers 409 and nothing is overwritten.
 *
 *   200 { cart }   400 ACCOUNT_BODY_INVALID { field }   403 an admin, or another seller's store   404 not this store's cart
 *   409 ABANDONED_CART_STATUS_CHANGED
 *
 * Order: authenticate -> seller only -> parse the body (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner })
 * -> findOne({ _id, store }) -> the one compare-and-set -> the re-read it returns -> best-effort audit.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; cartId: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    await readAccountBody(request, abandonedCartContactedRequestSchema);
    assertCan(ctx.actor, 'update', 'abandonedCarts', ['status']);
    const params = await context.params;
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
    const storeId = String(store._id);
    if (!mongoose.isValidObjectId(params.cartId)) throw notFound();

    const current = (await AbandonedCart.findOne({ _id: params.cartId, store: oid(storeId) }).lean()) as unknown as Record<string, unknown> | null;
    if (!current) throw notFound();
    const updated = (await AbandonedCart.findOneAndUpdate(
      { _id: params.cartId, store: oid(storeId), status: 'open' },
      { $set: { status: 'contacted', contactedAt: new Date() } },
      { new: true },
    ).lean()) as unknown as Record<string, unknown> | null;
    if (!updated) throw new HttpError(409, 'This cart was already marked, or the shopper has ordered. Reload the list.', ABANDONED_CART_STATUS_CHANGED);

    await audit('abandoned_cart.contacted', storeId, params.cartId, ctx.userId);
    return NextResponse.json({ cart: toSellerCart(updated) }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/stores/:id/abandoned-carts/:cartId: the seller clears one cart. ONE findOneAndDelete on { _id, store }, so another store's cart is
 * simply not found.
 *
 *   200 { removed: true, id }   403 an admin, or another seller's store   404 not this store's cart
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; cartId: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'delete', 'abandonedCarts');
    const params = await context.params;
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
    const storeId = String(store._id);
    if (!mongoose.isValidObjectId(params.cartId)) throw notFound();

    const removed = await AbandonedCart.findOneAndDelete({ _id: params.cartId, store: oid(storeId) }).lean();
    if (!removed) throw notFound();
    await audit('abandoned_cart.delete', storeId, params.cartId, ctx.userId);
    return NextResponse.json({ removed: true, id: params.cartId }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
