import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { OrderTransitionRequest } from '@markaz/contracts';
import { authenticate, type AuthContext } from '@/lib/auth';
import { canTransition, cardPaymentPending, nextStatuses, orderTransitionRequestSchema, transitionRefusal, ORDER_TRANSITION_REFUSAL_MESSAGES } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, Order, ORDER_ACTIONS, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  paymentMethod?: unknown;
  paymentStatus?: unknown;
}

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

const readOrder = async (id: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredOrder | null;

const unchanged = (row: unknown): Response =>
  NextResponse.json({ changed: false, order: toDashboardOrderDetail(row) }, { headers: NO_STORE });

/**
 * One audit entry per real change. statusHistory already holds the record, so a failure here is logged and the request
 * still succeeds.
 */
async function audit(ctx: AuthContext, storeId: string, row: StoredOrder, from: string, body: OrderTransitionRequest): Promise<void> {
  try {
    await writeAuditLog('order.transition', 'order', String(row._id), 'seller:' + ctx.userId, {
      storeId,
      orderId: row.orderId ?? null,
      from,
      to: body.status,
      note: body.note || null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order transition audit entry', { orderId: String(row._id) }, err);
  }
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
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const current = await readOrder(id, storeId);
    if (!current) throw notFound();

    const from = String(current.status ?? '');
    const to = body.status;
    if (from === to) return unchanged(current);

    if (!canTransition(from, to)) {
      const reason = transitionRefusal(from, to);
      throw new OrderRequestError(
        422,
        'ORDER_TRANSITION_ILLEGAL',
        reason ? ORDER_TRANSITION_REFUSAL_MESSAGES[reason] : 'This status change is not allowed.',
        { from, to, allowedNext: nextStatuses(from), reason },
      );
    }

    if (to === 'dispatched' && cardPaymentPending(current)) {
      throw new OrderRequestError(422, 'PAYMENT_PENDING', 'This card order has not been paid yet, so it cannot be dispatched.', { from, to });
    }

    const set: Record<string, unknown> = { status: to };
    if (body.courier !== undefined) set.courier = body.courier;
    if (body.trackingNumber !== undefined) set.trackingNumber = body.trackingNumber;
    if (body.trackingUrl !== undefined) set.trackingUrl = body.trackingUrl;
    const entry = { from, to, by: ctx.userObjectId, at: new Date(), note: body.note ? body.note : null };

    const updated = await Order.findOneAndUpdate(
      { _id: id, store: storeId, status: from },
      { $set: set, $push: { statusHistory: entry } },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      // Someone else changed the order between the read and the write.
      const now = await readOrder(id, storeId);
      if (!now) throw notFound();
      if (now.status === to) return unchanged(now);
      throw new OrderRequestError(409, 'ORDER_STATUS_CHANGED', 'This order changed while you were working on it. Reload it and try again.', {
        status: String(now.status ?? ''),
        allowedNext: nextStatuses(now.status),
      });
    }

    await audit(ctx, storeId, current, from, body);
    return NextResponse.json({ changed: true, order: toDashboardOrderDetail(updated) }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
