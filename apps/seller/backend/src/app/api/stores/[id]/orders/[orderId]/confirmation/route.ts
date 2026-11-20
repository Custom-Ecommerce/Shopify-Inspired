import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { ORDER_CONFIRMATION_DECIDED, orderConfirmationRequestSchema } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { auditConfirmation, decideConfirmation } from '@/lib/order-confirmation';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail } from '@/lib/orders';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/stores/:id/orders/:orderId/confirmation { result: confirmed | unreachable | cancel, note? } (Sprint 5 EP-11.US01.T03,
 * D-107): the seller's phone confirmation decision on a COD order that is waiting for it (confirmationStatus unconfirmed). The note
 * is plain text, up to 200 characters, and an empty note is none. Strictly validated, unknown fields refused.
 *
 * Order: authenticate -> seller only -> parse (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId -> the store ->
 * findOne({ _id, store }) -> ONE compare-and-set on confirmationStatus (a cancel is the cancel path's own compare-and-set, which
 * carries the same condition, so stock and the discount use go back exactly once) -> the order as it is now -> best-effort audit.
 * The audit entry never holds the note, the phone or the email.
 *
 *   200 { result, confirmationStatus, order }   the decision was recorded; order is the dashboard detail
 *   400 ACCOUNT_BODY_INVALID { field }          bad JSON, an unknown field, a result that is not one of the three, a note over 200
 *   401 no session   403 an admin, or a store the seller does not own
 *   404 an order that is not in this store (another store's order id is simply not found)
 *   409 ORDER_CONFIRMATION_DECIDED { status }   the order is confirmed or cancelled (final), a parallel decision won, or the order never
 *                                               waited for one (a card order, an older order, mode off). An order marked unreachable can
 *                                               be decided again (D-109): confirmed, cancel, or unreachable once more, each logged.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; orderId: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const params = await context.params;
    const body = await readAccountBody(request, orderConfirmationRequestSchema);
    assertCan(ctx.actor, 'update', 'orderConfirmation', body.note === null ? ['result'] : ['result', 'note']);

    const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
    const storeId = String(store._id);
    if (!mongoose.isValidObjectId(params.orderId)) throw new HttpError(404, 'Order not found');

    const input = {
      storeId,
      orderId: params.orderId,
      actor: { userObjectId: ctx.userObjectId, auditActor: 'seller:' + ctx.userId },
      request: body,
    };
    const decision = await decideConfirmation(input);
    if (decision.outcome === 'not_found') throw new HttpError(404, 'Order not found');
    if (decision.outcome === 'closed') {
      throw new OrderRequestError(
        409,
        ORDER_CONFIRMATION_DECIDED,
        decision.status === 'not_required' ? 'This order does not need a confirmation.' : 'This order has already been decided.',
        { status: decision.status },
      );
    }

    await auditConfirmation(input, decision.order, decision.result);
    const order = toDashboardOrderDetail(decision.order);
    return NextResponse.json({ result: decision.result, confirmationStatus: order.confirmationStatus, order }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
