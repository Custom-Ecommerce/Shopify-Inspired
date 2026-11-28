import type { OrderTransitionRequest } from '@markaz/contracts';
import { auditActorOf, type AuthContext } from '@/lib/auth';
import { canTransition, cardPaymentPending, nextStatuses, transitionRefusal, ORDER_NOT_CONFIRMED, ORDER_NOT_CONFIRMED_MESSAGE, ORDER_TRANSITION_REFUSAL_MESSAGES } from '@/lib/contracts';
import { confirmationStatusOf } from '@/lib/fraud';
import { HttpError } from '@/lib/http';
import { revisionFilter, revisionOf, RevisionConflictError } from '@/lib/mobile-revision';
import { notifyOrderStatus } from '@/lib/notifications';
import { OrderRequestError } from '@/lib/orders';
import { recordAndReconcile } from '@/lib/return-reconcile';
import { Order, writeAuditLog } from '@/lib/services';

/*
 * The one status move of an order, shared by the portal route (POST /api/orders/:id/transition) and the phone (POST /api/mobile/v1/orders/:id/status).
 * The rules and the write were the route's own (EP-02 OB-2); Sprint 9 moved them here unchanged and added the optional revision of the phone.
 */

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  paymentMethod?: unknown;
  paymentStatus?: unknown;
  confirmationStatus?: unknown;
  updatedAt?: unknown;
}

const notFound = (): HttpError => new HttpError(404, 'Order not found');

const readOrder = async (id: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredOrder | null;

/**
 * One audit entry per real change. statusHistory already holds the record, so a failure here is logged and the request
 * still succeeds.
 */
async function audit(ctx: AuthContext, storeId: string, row: StoredOrder, from: string, body: OrderTransitionRequest): Promise<void> {
  try {
    await writeAuditLog('order.transition', 'order', String(row._id), auditActorOf(ctx), {
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
 * Moves one order of a store to body.status. Answers { changed: false } when it already has that status. Throws 404, the ORDER_ codes of the route, and, only
 * when `revision` is given, RevisionConflictError when the order is not the one that revision names.
 */
export async function transitionOrder(
  ctx: AuthContext,
  storeId: string,
  id: string,
  body: OrderTransitionRequest,
  options: { revision?: number } = {},
): Promise<{ changed: boolean; order: unknown }> {
  const current = await readOrder(id, storeId);
  if (!current) throw notFound();

  const from = String(current.status ?? '');
  const to = body.status;
  if (from === to) return { changed: false, order: current };
  if (options.revision !== undefined && revisionOf(current.updatedAt) !== options.revision) throw new RevisionConflictError(current);

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
  // Sprint 5 EP-11.US01 (D-107): the dispatch waits for the phone confirmation. A check inside this same read-then-compare-and-set
  // flow, with no extra write. Only the dispatch is refused; every other move is as before.
  if (to === 'dispatched' && confirmationStatusOf(current) === 'unconfirmed') {
    throw new OrderRequestError(422, ORDER_NOT_CONFIRMED, ORDER_NOT_CONFIRMED_MESSAGE, { from, to });
  }

  const set: Record<string, unknown> = { status: to };
  if (body.courier !== undefined) set.courier = body.courier;
  if (body.trackingNumber !== undefined) set.trackingNumber = body.trackingNumber;
  if (body.trackingUrl !== undefined) set.trackingUrl = body.trackingUrl;
  const entry = { from, to, by: ctx.userObjectId, at: new Date(), note: body.note ? body.note : null };

  const updated = await Order.findOneAndUpdate(
    // A stored confirmation status is part of the filter, so the dispatch is judged on the value that was checked above.
    {
      _id: id,
      store: storeId,
      status: from,
      ...(current.confirmationStatus === undefined ? {} : { confirmationStatus: current.confirmationStatus }),
      ...(options.revision === undefined ? {} : revisionFilter(options.revision)),
    },
    { $set: set, $push: { statusHistory: entry } },
    { new: true, runValidators: true },
  ).lean();

  if (!updated) {
    // Someone else changed the order between the read and the write.
    const now = await readOrder(id, storeId);
    if (!now) throw notFound();
    if (now.status === to) return { changed: false, order: now };
    if (options.revision !== undefined) throw new RevisionConflictError(now);
    throw new OrderRequestError(409, 'ORDER_STATUS_CHANGED', 'This order changed while you were working on it. Reload it and try again.', {
      status: String(now.status ?? ''),
      allowedNext: nextStatuses(now.status),
    });
  }

  await audit(ctx, storeId, current, from, body);
  // EP-07.US01.T04: only the winner of the compare-and-set gets here, so each status emails the customer once.
  notifyOrderStatus(storeId, updated, to);
  // EP-05 (D-088): a delivered order that is already collected owes its COD commission now. Best effort, never throws.
  if (to === 'delivered') await recordAndReconcile(updated as never);
  return { changed: true, order: updated };
}
