import type { OrderStockRestore } from '@markaz/contracts';
import { cancelRefusal, paidCardOrder } from '@/lib/contracts';
import { restoreOrderStock, stockRestoreSummary, type RestoreLine } from '@/lib/order-stock';
import { Order, writeAuditLog } from '@/lib/services';
import { returnDiscountUse } from '@/lib/storefront/discount-service';

/** Who is cancelling. A person has a user id for the history; a system actor has none. */
export interface CancelActor {
  userObjectId: unknown;
  /** As it appears in the audit log, for example seller:<id>. */
  auditActor: string;
}

/** The actor behind a cancel that Stripe caused: the session expired, the payment failed, or it could not be started. */
export const PAYMENT_SYSTEM_ACTOR: CancelActor = { userObjectId: null, auditActor: 'system:stripe' };

/** The reason on every order cancelled because its card payment did not happen (A-016). */
export const PAYMENT_NOT_COMPLETED_REASON = 'Payment not completed';

export interface CancelOrderInput {
  orderId: string;
  storeId: string;
  reason: string;
  note?: string | null;
  actor: CancelActor;
  /** Cancels only while the order is unpaid, as part of the same write. A paid order is never cancelled automatically. */
  onlyIfUnpaid?: boolean;
}

export type CancelOrderResult =
  | { outcome: 'cancelled'; order: unknown; stockRestore: OrderStockRestore }
  | { outcome: 'not_found' }
  /** A paid card order, which stays until refunds exist. */
  | { outcome: 'paid'; status: string }
  /** This status cannot be cancelled, or the order is already cancelled. */
  | { outcome: 'illegal'; status: string }
  /** The order moved on between the read and the write. */
  | { outcome: 'changed'; status: string };

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  paymentMethod?: unknown;
  paymentStatus?: unknown;
  items?: RestoreLine[];
  discountCode?: string | null;
  discountSnapshot?: { discountId?: string } | null;
}

const readOrder = async (orderId: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: orderId, store: storeId }).lean()) as unknown as StoredOrder | null;

/**
 * Adds one history line naming what did not go back to stock, so the seller can see it later on the order. Best effort:
 * the audit entry carries the same summary.
 */
async function noteStockSummary(orderId: string, storeId: string, actor: CancelActor, summary: string): Promise<unknown | null> {
  try {
    return await Order.findOneAndUpdate(
      { _id: orderId, store: storeId },
      { $push: { statusHistory: { from: 'cancelled', to: 'cancelled', by: actor.userObjectId, at: new Date(), note: summary, kind: 'stock' } } },
      { new: true, runValidators: true },
    ).lean();
  } catch (err) {
    console.error('[seller-backend] could not note the stock restore on the order history', { orderId }, err);
    return null;
  }
}

async function audit(
  input: CancelOrderInput,
  row: StoredOrder,
  from: string,
  stock: OrderStockRestore,
  summary: string | null,
  discountUse: string | null,
): Promise<void> {
  try {
    await writeAuditLog('order.cancel', 'order', String(row._id), input.actor.auditActor, {
      storeId: input.storeId,
      orderId: row.orderId ?? null,
      from,
      reason: input.reason,
      note: input.note || null,
      restored: stock.restored.length,
      skipped: stock.skipped,
      failed: stock.failed,
      summary,
      discountUse,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order cancel audit entry', { orderId: String(row._id) }, err);
  }
}

/**
 * The one way an order is cancelled (D-064, D-073), for a seller's request and for Stripe's events alike.
 *
 * The cancel is ONE findOneAndUpdate filtered on { _id, store, status: <read status>, stockRestoredAt absent }: it sets
 * the status, cancelledAt, cancelReason and stockRestoredAt, plus discountRestoredAt when the order used a code, and pushes
 * the history entry. Only the caller that wins it restores stock and returns the discount use, so two parallel cancels give
 * each back once (D-066, A-017). A discount deleted since the order is skipped.
 */
export async function cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult> {
  const { orderId, storeId, actor } = input;

  const current = await readOrder(orderId, storeId);
  if (!current) return { outcome: 'not_found' };
  const from = String(current.status ?? '');
  if (cancelRefusal(from) !== null) return { outcome: 'illegal', status: from };
  if (paidCardOrder(current)) return input.onlyIfUnpaid ? { outcome: 'changed', status: from } : { outcome: 'paid', status: from };

  const now = new Date();
  const cancelled = await Order.findOneAndUpdate(
    {
      _id: orderId,
      store: storeId,
      status: from,
      stockRestoredAt: { $exists: false },
      discountRestoredAt: { $exists: false },
      // In the write itself, so a payment landing after the read still wins.
      ...(input.onlyIfUnpaid ? { paymentStatus: 'unpaid' } : current.paymentMethod === 'card' ? { paymentStatus: { $ne: 'paid' } } : {}),
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: input.reason,
        stockRestoredAt: now,
        ...(current.discountCode ? { discountRestoredAt: now } : {}),
      },
      $push: { statusHistory: { from, to: 'cancelled', by: actor.userObjectId, at: now, note: input.note ? input.note : null } },
    },
    { new: true, runValidators: true },
  ).lean();

  if (!cancelled) {
    const latest = await readOrder(orderId, storeId);
    if (!latest) return { outcome: 'not_found' };
    const status = String(latest.status ?? '');
    if (status === 'cancelled') return { outcome: 'illegal', status };
    return paidCardOrder(latest) && !input.onlyIfUnpaid ? { outcome: 'paid', status } : { outcome: 'changed', status };
  }

  // Only the winner gets here. The lines come from the order as it was cancelled.
  const row = cancelled as unknown as StoredOrder;
  const stockRestore = await restoreOrderStock(storeId, orderId, actor.userObjectId, (row.items ?? []) as RestoreLine[]);
  const summary = stockRestoreSummary(stockRestore);
  const discountId = row.discountSnapshot?.discountId;
  const discountUse = discountId ? await returnDiscountUse(storeId, discountId) : null;
  const finalRow = summary ? ((await noteStockSummary(orderId, storeId, actor, summary)) ?? cancelled) : cancelled;

  await audit(input, current, from, stockRestore, summary, discountUse);
  return { outcome: 'cancelled', order: finalRow, stockRestore };
}
