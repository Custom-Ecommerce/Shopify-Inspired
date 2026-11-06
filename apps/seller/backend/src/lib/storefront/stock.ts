import { Product } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';

type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

interface StockRow {
  stockQuantity: number;
  stockStatus: StockStatus;
  lowStockThreshold?: number | null;
}

/** Status after units were taken. Only moves a status down, never overrides a seller's manual choice upward. */
export function statusAfterReserve(row: StockRow): StockStatus | null {
  if (row.stockQuantity <= 0) return row.stockStatus === 'out_of_stock' ? null : 'out_of_stock';
  const threshold = row.lowStockThreshold;
  if (row.stockStatus === 'in_stock' && typeof threshold === 'number' && row.stockQuantity <= threshold) return 'low_stock';
  return null;
}

/** Status after units were given back. Only moves a status up when the new quantity justifies it. */
export function statusAfterRelease(row: StockRow): StockStatus | null {
  if (row.stockQuantity <= 0) return null;
  const threshold = row.lowStockThreshold;
  const low = typeof threshold === 'number' && row.stockQuantity <= threshold;
  if (row.stockStatus === 'out_of_stock') return low ? 'low_stock' : 'in_stock';
  if (row.stockStatus === 'low_stock' && !low && typeof threshold === 'number') return 'in_stock';
  return null;
}

export interface Reservation {
  productId: string;
  qty: number;
}

const outOfStock = (productId: string): StorefrontHttpError =>
  new StorefrontHttpError(409, 'OUT_OF_STOCK', 'A product in the order is out of stock.', { productId });

/**
 * Takes qty units in ONE conditional write: the filter only matches while the available quantity
 * (stock minus reserved) still covers qty, so two shoppers racing for the last unit cannot both win and
 * stock can never go negative. No match means someone else got there first: OUT_OF_STOCK.
 *
 * The history entry and the derived status are a second write; it only records and relabels, the quantity
 * guard above is what protects the stock, so a failure there is logged and does not fail the order.
 */
export async function reserveStock(storeId: string, productId: string, qty: number): Promise<void> {
  const after = (await (Product as any)
    .findOneAndUpdate(
      {
        _id: productId,
        store: storeId,
        isPublished: true,
        stockStatus: { $ne: 'out_of_stock' },
        $expr: { $gte: [{ $subtract: ['$stockQuantity', { $ifNull: ['$reservedQuantity', 0] }] }, qty] },
      },
      { $inc: { stockQuantity: -qty } },
      { new: true },
    )
    .select('stockQuantity stockStatus lowStockThreshold')
    .lean()) as StockRow | null;

  if (!after) throw outOfStock(productId);
  await recordStockChange(productId, after, qty, 'storefront_order', statusAfterReserve(after), -qty);
}

/** Gives units back after an order failed to save. Best effort: a failure is logged, never thrown. */
export async function releaseStock(storeId: string, productId: string, qty: number): Promise<void> {
  try {
    const after = (await (Product as any)
      .findOneAndUpdate({ _id: productId, store: storeId }, { $inc: { stockQuantity: qty } }, { new: true })
      .select('stockQuantity stockStatus lowStockThreshold')
      .lean()) as StockRow | null;
    if (after) await recordStockChange(productId, after, qty, 'storefront_order_released', statusAfterRelease(after), qty);
  } catch (err) {
    console.error('[seller-backend] could not release reserved stock', { productId, qty }, err);
  }
}

async function recordStockChange(
  productId: string,
  after: StockRow,
  qty: number,
  reason: string,
  nextStatus: StockStatus | null,
  delta: number,
): Promise<void> {
  try {
    const update: Record<string, unknown> = {
      $push: {
        stockHistory: { quantity: after.stockQuantity, previousQuantity: after.stockQuantity - delta, reason, changedAt: new Date() },
      },
    };
    if (nextStatus) update.$set = { stockStatus: nextStatus };
    await (Product as any).updateOne({ _id: productId }, update);
  } catch (err) {
    console.error('[seller-backend] could not record stock change', { productId, qty, reason }, err);
  }
}

/** Gives back every reservation in the list. Never throws. */
export async function releaseAll(storeId: string, reservations: Reservation[]): Promise<void> {
  for (const r of reservations) await releaseStock(storeId, r.productId, r.qty);
}
