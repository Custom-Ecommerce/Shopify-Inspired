import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { OrderCancelRequest } from '@markaz/contracts';
import { authenticate } from '@/lib/auth';
import { cancelRefusal, canCancel, nextStatuses, ORDER_CANCEL_REFUSAL_MESSAGES, orderCancelRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { cancelOrder } from '@/lib/order-cancel';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';
import { expireCardSession } from '@/lib/storefront/card-payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const notFound = (): HttpError => new HttpError(404, 'Order not found');

async function readBody(request: NextRequest): Promise<OrderCancelRequest> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  }
  const parsed = orderCancelRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? String(issue.path[0]) : null;
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid body.'), { field });
  }
  return parsed.data;
}

function illegal(status: string, paidCard = false): OrderRequestError {
  const reason = paidCard ? 'card_paid' : (cancelRefusal(status) ?? 'unknown_status');
  return new OrderRequestError(422, 'ORDER_CANCEL_ILLEGAL', ORDER_CANCEL_REFUSAL_MESSAGES[reason], { status, reason });
}

/**
 * POST /api/orders/:id/cancel   body: { reason (3..200), note? (max 500) }
 *
 * Cancels an order that has not been dispatched (D-064) and gives its stock and discount use back exactly once: see
 * cancelOrder, which Stripe's events use too. Store owner only (D-067).
 *
 *   200 { order, stockRestore: { restored, skipped, failed } }
 *   400 ORDER_BODY_INVALID { field }
 *   401 no session   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's order
 *   409 ORDER_STATUS_CHANGED { status, allowedNext, canCancel }   the order moved on between the read and the write
 *   422 ORDER_CANCEL_ILLEGAL { status, reason }                     dispatched or later, already cancelled, unknown status, or a
 *                                                                   paid card order (reason card_paid), until refunds exist
 *
 * Cancelling an unpaid card order also closes its Stripe session, so the shopper cannot pay for it.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { operation, collection } = ORDER_ACTIONS.cancel;
    // The role check first, so an admin is refused whatever the body holds.
    assertCan(ctx.actor, operation, collection, ['reason']);
    const { id } = await context.params;

    const body = await readBody(request);
    // The keys that survived parsing: unknown keys were dropped, so they are neither checked nor stored.
    assertCan(ctx.actor, operation, collection, Object.keys(body));

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const result = await cancelOrder({
      orderId: id,
      storeId,
      reason: body.reason,
      note: body.note,
      actor: { userObjectId: ctx.userObjectId, auditActor: 'seller:' + ctx.userId },
    });

    if (result.outcome === 'not_found') throw notFound();
    if (result.outcome === 'illegal') throw illegal(result.status);
    if (result.outcome === 'paid') throw illegal(result.status, true);
    if (result.outcome === 'changed') {
      throw new OrderRequestError(409, 'ORDER_STATUS_CHANGED', 'This order changed while you were working on it. Reload it and try again.', {
        status: result.status,
        allowedNext: nextStatuses(result.status),
        canCancel: canCancel(result.status),
      });
    }

    const cancelled = result.order as { orderId?: string; paymentMethod?: unknown; stripeSessionId?: string | null };
    if (cancelled.paymentMethod === 'card' && cancelled.stripeSessionId) {
      await expireCardSession({ orderId: cancelled.orderId, stripeSessionId: cancelled.stripeSessionId });
    }

    return NextResponse.json({ order: toDashboardOrderDetail(result.order), stockRestore: result.stockRestore }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
