import { recordCardEntries, recordCodCommission, type LedgerOrder } from '@/lib/commission';
import { Order } from '@/lib/services';

/** At most this many orders per call, oldest first. */
export const BACKFILL_BATCH = 100;

/**
 * The orders that owe ledger entries and lack them: delivered-and-collected COD (one entry) and paid card orders (two),
 * found with a lookup on the entries collection so each call moves on to the next orders that still lack entries. A
 * cancelled card order is left alone.
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
      if (outcome === 'created') written += 1;
      else if (outcome === 'failed') failed += 1;
    } else {
      const outcome = await recordCardEntries(order);
      if (outcome === 'ok') written += 1;
      else if (outcome === 'failed') failed += 1;
    }
  }
  return { scanned: orders.length, written, failed };
}
