import { Discount } from '@/lib/services';
import type { DiscountRule } from '@/lib/storefront/pricing';

/** The code is stored in capitals and unique per store, so this finds at most one row, and never another store's. */
export async function findDiscountRule(storeId: string, code: string): Promise<DiscountRule | null> {
  return (await Discount.findOne({ store: storeId, code }).lean()) as unknown as DiscountRule | null;
}

/**
 * Takes one use in ONE conditional write, the way stock is taken. Two orders racing for the last use cannot both match.
 * False means the use was not taken.
 */
export async function claimDiscountUse(storeId: string, discountId: string): Promise<boolean> {
  const result = await Discount.updateOne(
    {
      _id: discountId,
      store: storeId,
      isActive: { $ne: false },
      archivedAt: null,
      $or: [{ maxUses: null }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }],
    },
    { $inc: { usedCount: 1 } },
  );
  return result.matchedCount === 1;
}

/**
 * Gives one use back, after an order failed to save or was cancelled. Best effort: a failure is logged, never thrown, so it
 * cannot stop a cancel. A discount deleted since the order has nothing to give back to.
 */
export async function returnDiscountUse(storeId: string, discountId: string): Promise<'returned' | 'skipped' | 'failed'> {
  try {
    const result = await Discount.updateOne({ _id: discountId, store: storeId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    return result.matchedCount === 1 ? 'returned' : 'skipped';
  } catch (err) {
    console.error('[seller-backend] could not return a discount use', { discountId, message: err instanceof Error ? err.message : 'unknown' });
    return 'failed';
  }
}
