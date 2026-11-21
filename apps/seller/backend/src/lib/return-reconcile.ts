import { recordCodCommission, reverseForReturn, type LedgerOrder } from '@/lib/commission';
import { databaseReady } from '@/lib/notifications';
import { completionOf, refundCapOf } from '@/lib/returns';
import { oid } from '@/lib/ledger-aggregates';
import { Order, Return } from '@/lib/services';

/*
 * Sprint 5 EP-13.US03.T07 (D-110 (4)): the reconcile of return reversals. reverseForReturn is best effort at refund time, so a return refunded while its
 * order had no commission entry yet (delivered, but the cash not yet marked collected) or whose ledger write failed would never be reversed. This
 * writes the missing reversals: it calls reverseForReturn, which is idempotent through the unique index { order, type, reversesType, returnId }, for
 * every return of the order that has a refund recorded. reverseForReturn and the append-only guard are left exactly as they are.
 *
 * Called (1) right after recordCodCommission creates the ORIGINAL entry (the order transition to delivered and the payment route), and (2) by the
 * commission backfill job for the returns refunded in the last RECONCILE_WINDOW_DAYS days.
 */

type Row = Record<string, unknown>;

export const RECONCILE_WINDOW_DAYS = 30;
/** The backfill reconciles at most this many orders per call (oldest refund first), like the ledger backfill's own batch. */
export const RECONCILE_BATCH = 100;

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);
const time = (value: unknown): number => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
};

export interface ReconcileResult {
  /** Reversals written now. */
  created: number;
  /** Returns whose reversal was already there (the reconcile finds it and writes nothing). */
  existing: number;
  /** Returns that need no reversal (no commission entry, or the amount works out to 0 rupees). */
  nothingDue: number;
  failed: number;
}

/** True when a refund is recorded: the return is refunded, or received with part of the money already paid back. */
function hasRefund(doc: Row): boolean {
  return (doc.status === 'refunded' || doc.status === 'received') && whole(doc.refundAmount) > 0;
}

/** When the return's first refund was recorded: the order the reversals were (or would have been) written in. */
function firstRefundAt(doc: Row): number {
  const refunds = Array.isArray(doc.refunds) ? (doc.refunds as Row[]) : [];
  const first = refunds.map((entry) => time(entry.at)).filter((at) => at > 0).sort((a, b) => a - b)[0];
  return first ?? (time(doc.resolvedAt) || time(doc.createdAt));
}

/**
 * Writes the missing commission reversals of ONE order: for every refunded return of it (status refunded, or received with a refund recorded)
 * that has no reversal yet, in the order the refunds were first recorded. The returned base is the return's own refund cap (the paid value of
 * what came back), the same base the refund used. Idempotent and safe to call from any number of places; never throws.
 */
export async function reconcileReturnReversals(orderId: unknown): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, existing: 0, nothingDue: 0, failed: 0 };
  if (!databaseReady()) return result;
  try {
    const order = (await Order.findOne({ _id: orderId }).select('store orderId paymentMethod subtotal discountAmount items').lean()) as unknown as Row | null;
    // Only a cash on delivery order has a commission to give back (a card order's refund is not supported yet, D-108 (7)).
    if (!order || order.paymentMethod !== 'cod') return result;
    // Every received or refunded return of the order: the rule of the whole order (completionOf, SB-6) needs the ones without a refund too.
    const everything = (await Return.find({ store: order.store, order: orderId, status: { $in: ['received', 'refunded'] } }).lean()) as unknown as Row[];
    const returns = everything.filter(hasRefund).sort((a, b) => firstRefundAt(a) - firstRefundAt(b));
    for (const doc of returns) {
      const completion = completionOf(doc, everything, order);
      const returnedBase = refundCapOf(doc, order, completion.completes ? completion.earlierBase : null);
      if (returnedBase === null || returnedBase <= 0) {
        result.nothingDue += 1;
        continue;
      }
      const outcome = await reverseForReturn({
        returnId: doc._id,
        order: { _id: order._id ?? orderId, store: order.store, orderId: String(order.orderId ?? ''), paymentMethod: order.paymentMethod },
        returnedBase,
        completesOrder: completion.completes,
      });
      if (outcome.outcome === 'created') result.created += 1;
      else if (outcome.outcome === 'exists') result.existing += 1;
      else if (outcome.outcome === 'failed') result.failed += 1;
      else result.nothingDue += 1;
    }
  } catch (err) {
    result.failed += 1;
    console.error('[seller-backend] could not reconcile the return reversals of an order', { orderId: String(orderId), error: err instanceof Error ? err.name : 'unknown' });
  }
  return result;
}

/**
 * The backfill's step: the orders that have a return with a refund recorded in the last 30 days, each reconciled once (at most 100 orders, the
 * oldest refunds first). Returns the sums. Never throws.
 */
export async function reconcileRecentReturnReversals(now: Date = new Date()): Promise<ReconcileResult & { orders: number }> {
  const total = { created: 0, existing: 0, nothingDue: 0, failed: 0, orders: 0 };
  if (!databaseReady()) return total;
  try {
    const since = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 86_400_000);
    const rows = (await Return.find({ status: { $in: ['received', 'refunded'] }, updatedAt: { $gte: since } })
      .select('order refundAmount updatedAt')
      .sort({ updatedAt: 1 })
      .limit(RECONCILE_BATCH * 5)
      .lean()) as unknown as Row[];
    const orderIds: string[] = [];
    for (const row of rows) {
      if (whole(row.refundAmount) <= 0 || row.order === null || row.order === undefined) continue;
      const id = String(row.order);
      if (!orderIds.includes(id)) orderIds.push(id);
      if (orderIds.length >= RECONCILE_BATCH) break;
    }
    for (const id of orderIds) {
      const one = await reconcileReturnReversals(oid(id));
      total.orders += 1;
      total.created += one.created;
      total.existing += one.existing;
      total.nothingDue += one.nothingDue;
      total.failed += one.failed;
    }
  } catch (err) {
    total.failed += 1;
    console.error('[seller-backend] could not reconcile the recent return reversals', err instanceof Error ? err.name : 'unknown');
  }
  return total;
}

/**
 * recordCodCommission, and when it created the ORIGINAL entry (the commission now exists, so reversals can be written), the reconcile of that
 * order's refunded returns. Used by the order transition and the payment route. Never throws.
 */
export async function recordAndReconcile(order: unknown): Promise<void> {
  const ledgerOrder = order as LedgerOrder;
  const outcome = await recordCodCommission(ledgerOrder);
  if (outcome === 'created') await reconcileReturnReversals(ledgerOrder._id);
}
