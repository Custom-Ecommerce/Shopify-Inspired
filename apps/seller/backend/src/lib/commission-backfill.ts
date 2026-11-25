import { recordCardEntries, recordCodCommission, type LedgerOrder } from '@/lib/commission';
import { reconcileRecentReturnReversals, reconcileReturnReversals } from '@/lib/return-reconcile';
import { Order } from '@/lib/services';

/** At most this many orders per call, oldest first. */
export const BACKFILL_BATCH = 100;

/**
 * The orders that owe ledger entries and lack them: delivered-and-collected COD (one entry) and paid card orders (two),
 * found with a lookup on the entries collection so each call moves on to the next orders that still lack entries. A
 * cancelled card order is left alone.
 *
 * Sprint 6 D-116: this selects ONLY orders that lack an entry, and a COD order at 0 percent still gets its (zero) entry, so a
 * changed COD percent never touches an order that already has one and the job cannot loop on zero-commission orders.
 * CO-85 (still open, P3, before scale): the oldest 100 orders without an entry come first, so an order that can never get one (for
 * example a deleted store) stays at the front and blocks the rest, and the lookup scans every delivered order each run. A failure
 * marker or a created-after window plus an index is the planned fix; it is deliberately NOT done here.
 */
export async function ordersMissingEntries(limit: number = BACKFILL_BATCH): Promise<LedgerOrder[]> {
  return (await Order.aggregate([
    {
      $match: {
        $or: [
          { paymentMethod: 'cod', status: 'delivered', paymentStatus: 'collected' },
          { paymentMethod: 'card', paymentStatus: 'paid', status: { $ne: 'cancelled' } },
        ],
      },
    },
    { $sort: { createdAt: 1, _id: 1 } },
    { $lookup: { from: 'commissionentries', localField: '_id', foreignField: 'order', as: 'entries', pipeline: [{ $project: { type: 1 } }] } },
    { $match: { $expr: { $lt: [{ $size: '$entries' }, { $cond: [{ $eq: ['$paymentMethod', 'card'] }, 2, 1] }] } } },
    { $limit: limit },
    { $project: { entries: 0 } },
  ])) as unknown as LedgerOrder[];
}

/** Writes what is missing, with the rate that applies now. Idempotent: a second run finds nothing left to write. */
export async function backfillCommission(): Promise<{ scanned: number; written: number; failed: number }> {
  const orders = await ordersMissingEntries();
  let written = 0;
  let failed = 0;
  for (const order of orders) {
    if (order.paymentMethod === 'cod') {
      const outcome = await recordCodCommission(order);
      if (outcome === 'created') {
        written += 1;
        // The commission exists now: a return refunded before it did gets its reversal (EP-13.US03.T07).
        await reconcileReturnReversals(order._id);
      } else if (outcome === 'failed') failed += 1;
    } else {
      const outcome = await recordCardEntries(order);
      if (outcome === 'ok') written += 1;
      else if (outcome === 'failed') failed += 1;
    }
  }
  // EP-13.US03.T07 (D-110): the refunds of the last 30 days whose reversal is still missing (a ledger write that failed, or an original that
  // appeared in an earlier call). Idempotent; its counts are logged by the reconcile itself and do not change this job's answer.
  await reconcileRecentReturnReversals();
  return { scanned: orders.length, written, failed };
}
