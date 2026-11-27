import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { OrderTransitionRequest } from '@markaz/contracts';
import { authenticate } from '@/lib/auth';
import { orderTransitionRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { transitionOrder } from '@/lib/order-transition';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const notFound = (): HttpError => new HttpError(404, 'Order not found');

async function readBody(request: NextRequest): Promise<OrderTransitionRequest> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  }
  const parsed = orderTransitionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? String(issue.path[0]) : null;
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid body.'), { field });
  }
  return parsed.data;
}

/**
 * POST /api/orders/:id/transition   body: { status, note?, courier?, trackingNumber?, trackingUrl? }
 *
 * Moves an order one step along pending -> confirmed -> processing -> dispatched -> delivered (D-064, D-065). Only the store
 * owner (D-067). Never reads or writes products or stock.
 *
 *   200 { changed: true, order }    moved; order is the dashboard detail with the new allowedNext
 *   200 { changed: false, order }   the order already had this status (repeat, or a parallel request won): nothing written
 *   400 ORDER_BODY_INVALID { field }                      bad JSON, unknown status, note over 500, courier/tracking on a
 *                                                         non-dispatch move, tracking link not http(s)
 *   401 no session   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's order
 *   409 ORDER_STATUS_CHANGED { status, allowedNext }      the order changed between the read and the write
 *   422 ORDER_TRANSITION_ILLEGAL { from, to, allowedNext, reason }
 *   422 PAYMENT_PENDING   a card order that has not been paid cannot be dispatched
 *   422 ORDER_NOT_CONFIRMED   a COD order still waiting for the seller's phone confirmation cannot be dispatched (Sprint 5 EP-11.US01)
 *
 * The write is one findOneAndUpdate filtered on { _id, store, status: from }: a compare-and-set, so two parallel requests can
 * never both move the order or add two history entries.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { operation, collection } = ORDER_ACTIONS.transition;
    // The role check first, so an admin is refused whatever the body holds.
    assertCan(ctx.actor, operation, collection, ['status']);
    const { id } = await context.params;

    const body = await readBody(request);
    // The keys that survived parsing: unknown keys were dropped, so they are neither checked nor stored.
    assertCan(ctx.actor, operation, collection, Object.keys(body));

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'orders.write' });

    // Sprint 9: the rules and the one compare-and-set are in lib/order-transition.ts, which the phone route uses too.
    const { changed, order } = await transitionOrder(ctx, storeId, id, body);
    return NextResponse.json({ changed, order: toDashboardOrderDetail(order) }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
