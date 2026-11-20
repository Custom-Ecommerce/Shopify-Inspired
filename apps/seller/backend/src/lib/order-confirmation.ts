import type { ConfirmationLogResult, OrderConfirmationRequest } from '@markaz/contracts';
import { CONFIRMATION_LOG_MAX } from '@/lib/contracts';
import { confirmationStatusOf } from '@/lib/fraud';
import { cancelOrder, type CancelActor } from '@/lib/order-cancel';
import { Order, writeAuditLog } from '@/lib/services';

/*
 * Sprint 5 EP-11.US01.T03 (D-107): the seller's phone confirmation decision on a COD order. The seller phoned or messaged the
 * customer and says: confirmed, unreachable, or cancel.
 *
 * Exactly ONE decision per order. confirmed and unreachable are one compare-and-set on { _id, store, confirmationStatus:
 * unconfirmed, status: not cancelled }, which sets the new status and pushes the log entry together, so two parallel requests leave
 * one decision and one log entry (the loser reads 409). A cancel goes through cancelOrder, the one cancel path, whose compare-and-set
 * carries the same confirmationStatus condition and the log entry: stock and the discount use go back once, as for any cancel.
 *
 * The decision is the seller's call about the customer. It does not move the order's own status (pending, confirmed, ...): the
 * seller does that in the normal order flow, and a dispatch is only refused while the order is still unconfirmed.
 */

/** The reason stored on an order the seller cancelled on the call. */
export const CONFIRMATION_CANCEL_REASON = 'Declined on the confirmation call';

export type DecisionOutcome =
  | { outcome: 'decided'; result: ConfirmationLogResult; order: unknown }
  | { outcome: 'not_found' }
  /** A decision was already made, or the order never waited for one. `status` is the confirmation status now. */
  | { outcome: 'closed'; status: string };

export interface DecisionInput {
  storeId: string;
  orderId: string;
  actor: CancelActor;
  request: OrderConfirmationRequest;
}

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  confirmationStatus?: unknown;
}

const readOrder = async (orderId: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: orderId, store: storeId }).lean()) as unknown as StoredOrder | null;

const closedOutcome = (order: StoredOrder): DecisionOutcome =>
  String(order.status) === 'cancelled' ? { outcome: 'closed', status: 'cancelled' } : { outcome: 'closed', status: confirmationStatusOf(order) };

export async function decideConfirmation(input: DecisionInput): Promise<DecisionOutcome> {
  const { storeId, orderId, actor, request } = input;
  const current = await readOrder(orderId, storeId);
  if (!current) return { outcome: 'not_found' };
  if (confirmationStatusOf(current) !== 'unconfirmed' || String(current.status) === 'cancelled') return closedOutcome(current);

  const at = new Date();
  const note = request.note;

  if (request.result === 'cancel') {
    const entry = { at, by: actor.userObjectId, result: 'cancelled' as const, note };
    const result = await cancelOrder({
      orderId,
      storeId,
      reason: CONFIRMATION_CANCEL_REASON,
      // The seller's note stays in confirmationLog. cancelOrder writes its note into the audit entry, and no audit entry holds note text.
      note: null,
      actor,
      confirmationEntry: entry,
    });
    if (result.outcome === 'cancelled') return { outcome: 'decided', result: 'cancelled', order: result.order };
    if (result.outcome === 'not_found') return { outcome: 'not_found' };
    // Another decision, a cancel or a dispatch got there first.
    const latest = await readOrder(orderId, storeId);
    return latest ? closedOutcome(latest) : { outcome: 'not_found' };
  }

  const result: 'confirmed' | 'unreachable' = request.result;
  const updated = await Order.findOneAndUpdate(
    { _id: orderId, store: storeId, confirmationStatus: 'unconfirmed', status: { $ne: 'cancelled' } },
    {
      $set: { confirmationStatus: result },
      $push: { confirmationLog: { $each: [{ at, by: actor.userObjectId, result, note }], $slice: -CONFIRMATION_LOG_MAX } },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) {
    const latest = await readOrder(orderId, storeId);
    return latest ? closedOutcome(latest) : { outcome: 'not_found' };
  }
  return { outcome: 'decided', result, order: updated };
}

/**
 * One audit entry per decision, best effort. It holds the store, the order number, the result and whether a note was written. NEVER
 * the note text, the phone or the email.
 */
export async function auditConfirmation(input: DecisionInput, row: unknown, result: ConfirmationLogResult): Promise<void> {
  try {
    await writeAuditLog('order.confirmation', 'order', input.orderId, input.actor.auditActor, {
      storeId: input.storeId,
      orderId: (row as { orderId?: string } | null)?.orderId ?? null,
      result,
      hasNote: input.request.note !== null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order confirmation audit entry', { orderId: input.orderId }, err instanceof Error ? err.name : 'unknown');
  }
}
