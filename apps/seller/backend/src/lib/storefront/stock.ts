import { STOCK_WARNING_THRESHOLD } from '@/lib/contracts';
import { Product, StockMovement } from '@/lib/services';
import { StorefrontHttpError, productUnavailable } from '@/lib/storefront/errors';
import { liveProductFilter } from '@/lib/storefront/live-product';

export interface Reservation {
  productId: string;
  variantId: string;
  qty: number;
  /** True when units were really taken (a tracked variant). False for a variant that does not track quantity. */
  deducted: boolean;
}

const outOfStock = (productId: string, variantId: string): StorefrontHttpError =>
  new StorefrontHttpError(409, 'OUT_OF_STOCK', 'A product in the order is out of stock.', { productId, variantId });

interface VariantStock {
  _id: unknown;
  stockQuantity: number;
}

const stockOf = (row: { variants: VariantStock[] }, variantId: string): number | null => {
  const wanted = variantId.toLowerCase();
  return row.variants.find((variant) => String(variant._id).toLowerCase() === wanted)?.stockQuantity ?? null;
};

/**
 * EP-03 CB-6: whether a stock change alters what a product page shows, so the page must be purged. A page shows
 * "Sold out" at 0 and "Only N left" from 1 to STOCK_WARNING_THRESHOLD, and nothing about larger counts. So a change
 * matters when either side is at or under the line: it ends there (6 to 5, 5 to 4, 1 to 0), or it leaves from there
 * (5 to 6, 0 to 2). A change wholly above the line (20 to 19) shows nothing new and purges nothing.
 */
export function stockShownChanged(before: number, after: number): boolean {
  return before !== after && Math.min(before, after) <= STOCK_WARNING_THRESHOLD;
}

/**
 * Takes qty units of one variant in ONE conditional write. The $elemMatch only matches while that variant still holds
 * qty units, and the positional operator decrements exactly that variant, so two shoppers racing for the last unit
 * cannot both win and stock can never go negative. No match means someone else got there first.
 *
 * A variant that does not track quantity has nothing to take: the write cannot match it, and a read confirms the
 * reservation instead. That read decides nothing about stock, so it needs no atomicity.
 *
 * Only a Live product can be reserved (D-037): the conditions sit in the write itself, so a product trashed or
 * unpublished after the order was priced is refused here, with 422 PRODUCT_UNAVAILABLE rather than out of stock.
 *
 * The movement record is a second write. It only records; the conditional update is what protects the stock, so a
 * failure there is logged and does not fail the order.
 *
 * Returns whether units were actually taken (D-066): false for a variant that does not track quantity. pageChanged says
 * the new count is one shoppers see differently (sold out, or "Only N left"; see stockShownChanged). orderId, when given, is written on the movement so the order's
 * stock history can be found.
 */
export async function reserveStock(
  storeId: string,
  productId: string,
  variantId: string,
  qty: number,
  orderId?: string,
): Promise<{ deducted: boolean; pageChanged: boolean }> {
  const owner = { _id: productId, ...liveProductFilter(storeId) };

  const after = (await Product.findOneAndUpdate(
    { ...owner, variants: { $elemMatch: { _id: variantId, trackQuantity: true, stockQuantity: { $gte: qty } } } },
    { $inc: { 'variants.$.stockQuantity': -qty } },
    { new: true },
  )
    .select('variants._id variants.stockQuantity')
    .lean()) as unknown as { variants: VariantStock[] } | null;

  if (after) {
    const remaining = stockOf(after, variantId);
    await recordMovement(storeId, productId, variantId, remaining, -qty, 'storefront_order', null, orderId);
    return { deducted: true, pageChanged: remaining !== null && stockShownChanged(remaining + qty, remaining) };
  }

  const untracked = await Product.exists({ ...owner, variants: { $elemMatch: { _id: variantId, trackQuantity: false } } });
  if (untracked) return { deducted: false, pageChanged: false };

  const live = await Product.exists({ ...owner, variants: { $elemMatch: { _id: variantId } } });
  throw live ? outOfStock(productId, variantId) : productUnavailable(productId);
}

/**
 * Gives units back to one variant after an order failed to save. Best effort: a failure is logged, never thrown. It
 * deliberately has no Live conditions: units already taken go back even if the product was trashed in the meantime.
 */
export async function releaseStock(
  storeId: string,
  productId: string,
  variantId: string,
  qty: number,
  orderId?: string,
): Promise<void> {
  try {
    const after = (await Product.findOneAndUpdate(
      { _id: productId, store: storeId, variants: { $elemMatch: { _id: variantId, trackQuantity: true } } },
      { $inc: { 'variants.$.stockQuantity': qty } },
      { new: true },
    )
      .select('variants._id variants.stockQuantity')
      .lean()) as unknown as { variants: VariantStock[] } | null;
    if (after) {
      await recordMovement(storeId, productId, variantId, stockOf(after, variantId), qty, 'storefront_order_released', null, orderId);
    }
  } catch (err) {
    console.error('[seller-backend] could not release reserved stock', { productId, variantId, qty }, err);
  }
}

/**
 * Writes one history row. An order's change has no actor; a seller's adjustment names them. orderId is set only on
 * movements an order caused (D-066); a manual adjustment has none, so the key is left out entirely.
 */
export async function recordMovement(
  storeId: string,
  productId: string,
  variantId: string,
  quantity: number | null,
  delta: number,
  reason: string,
  actor: unknown = null,
  orderId?: unknown,
): Promise<void> {
  if (quantity === null) return;
  try {
    await StockMovement.create({
      store: storeId,
      product: productId,
      variantId,
      previousQuantity: quantity - delta,
      quantity,
      delta,
      reason,
      actor,
      changedAt: new Date(),
      ...(orderId === undefined || orderId === null ? {} : { orderId }),
    });
  } catch (err) {
    console.error('[seller-backend] could not record stock movement', { productId, variantId, delta, reason }, err);
  }
}

/**
 * Gives back every reservation in the list that really took units. A line that took nothing (untracked variant) is not
 * released, so a variant switched to tracking in the meantime cannot gain units it never lost. Never throws.
 */
export async function releaseAll(storeId: string, reservations: Reservation[], orderId?: string): Promise<void> {
  for (const r of reservations) {
    if (r.deducted) await releaseStock(storeId, r.productId, r.variantId, r.qty, orderId);
  }
}
