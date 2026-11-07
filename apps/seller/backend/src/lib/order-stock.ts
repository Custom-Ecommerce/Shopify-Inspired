import mongoose from 'mongoose';
import type { OrderStockRestore, OrderStockSkipReason } from '@markaz/contracts';
import { Product } from '@/lib/services';
import { recordMovement } from '@/lib/storefront/stock';

/*
 * EP-02 OB-3 (D-066): gives a cancelled order's units back to stock.
 *
 * The caller runs this only after it won the compare-and-set that cancelled the order and set stockRestoredAt, so it
 * runs once per order however many cancel requests race. Each line is one conditional $inc on one variant, the same
 * mechanism reserveStock uses to take units, but without the Live conditions: a trashed, unpublished or taken-down
 * product still gets its units back. A product or variant that no longer exists (permanently deleted) is skipped.
 */

export interface RestoreLine {
  productId: string;
  variantId: string;
  productTitle?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  /** true: placement took the units. false: it took nothing. Missing: an order placed before the flag existed. */
  stockDeducted?: boolean | null;
}

export const ORDER_CANCELLED_REASON = 'order_cancelled';

interface VariantStock {
  _id: unknown;
  stockQuantity: number;
}

/** "T-Shirt (M)", or just the title for a product's Default variant. */
export function lineName(line: Pick<RestoreLine, 'productTitle' | 'variantTitle'>): string {
  const title = (line.productTitle ?? '').trim() || 'Item';
  const variant = (line.variantTitle ?? '').trim();
  return variant && variant !== 'Default' ? title + ' (' + variant + ')' : title;
}

const stockOf = (row: { variants: VariantStock[] }, variantId: string): number | null => {
  const wanted = variantId.toLowerCase();
  return row.variants.find((variant) => String(variant._id).toLowerCase() === wanted)?.stockQuantity ?? null;
};

/** Why a line that did not match was not restored. Reads only; the decision about stock was the conditional write. */
async function whyNotRestored(storeId: string, line: RestoreLine): Promise<OrderStockSkipReason | 'failed'> {
  const product = await Product.exists({ _id: line.productId, store: storeId });
  if (!product) return 'product_deleted';
  const variant = await Product.exists({ _id: line.productId, store: storeId, variants: { $elemMatch: { _id: line.variantId } } });
  if (!variant) return 'variant_deleted';
  // The variant is there. With no flag that means it does not track quantity now; with a true flag the write should
  // have matched, so something else went wrong.
  return line.stockDeducted === true ? 'failed' : 'not_tracked';
}

/**
 * Restores every line on its own: a line that fails is collected under failed and the others still go back.
 *   stockDeducted true   restore, even if the variant stopped tracking quantity since (the units were taken)
 *   stockDeducted false  skipped (not_deducted): nothing was taken
 *   no flag (old order)  restore only if the variant tracks quantity now, else skipped (not_tracked)
 * One StockMovement per restored line: reason order_cancelled, the order id, and the seller who cancelled.
 */
export async function restoreOrderStock(
  storeId: string,
  orderId: string,
  actorId: unknown,
  lines: readonly RestoreLine[],
): Promise<OrderStockRestore> {
  const result: OrderStockRestore = { restored: [], skipped: [], failed: [] };

  for (const line of lines) {
    const name = lineName(line);
    if (line.stockDeducted === false) {
      result.skipped.push({ name, why: 'not_deducted' });
      continue;
    }
    if (!mongoose.isValidObjectId(line.productId)) {
      result.skipped.push({ name, why: 'product_deleted' });
      continue;
    }
    if (!mongoose.isValidObjectId(line.variantId)) {
      result.skipped.push({ name, why: 'variant_deleted' });
      continue;
    }
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      result.failed.push({ name });
      continue;
    }

    try {
      const variant = line.stockDeducted === true ? { _id: line.variantId } : { _id: line.variantId, trackQuantity: true };
      const after = (await Product.findOneAndUpdate(
        { _id: line.productId, store: storeId, variants: { $elemMatch: variant } },
        { $inc: { 'variants.$.stockQuantity': qty } },
        { new: true },
      )
        .select('variants._id variants.stockQuantity')
        .lean()) as unknown as { variants: VariantStock[] } | null;

      if (after) {
        await recordMovement(storeId, line.productId, line.variantId, stockOf(after, line.variantId), qty, ORDER_CANCELLED_REASON, actorId, orderId);
        result.restored.push({ name, sku: line.sku ?? null, qty });
        continue;
      }

      const why = await whyNotRestored(storeId, line);
      if (why === 'failed') result.failed.push({ name });
      else result.skipped.push({ name, why });
    } catch (err) {
      console.error('[seller-backend] could not restore stock for a cancelled order', { orderId, productId: line.productId }, err);
      result.failed.push({ name });
    }
  }

  return result;
}

const SKIP_WORDS: Partial<Record<OrderStockSkipReason, string>> = {
  product_deleted: 'product deleted',
  variant_deleted: 'variant deleted',
};

/**
 * One line the seller can read later, naming what did not go back to stock: products or variants deleted since the
 * order, and lines that failed. Lines that took nothing at placement (not_deducted, not_tracked) are not news and are
 * left out. Null when everything that was taken went back. Cut to the history note limit.
 */
export function stockRestoreSummary(result: OrderStockRestore, max = 500): string | null {
  const parts = [
    ...result.skipped.filter((s) => SKIP_WORDS[s.why]).map((s) => s.name + ' (' + SKIP_WORDS[s.why] + ')'),
    ...result.failed.map((f) => f.name + ' (could not be restored)'),
  ];
  if (parts.length === 0) return null;
  const text = 'Stock not returned: ' + parts.join('; ');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
