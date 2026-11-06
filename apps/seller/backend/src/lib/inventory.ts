import type { InventoryAdjustLine, InventoryAdjustResponse, InventoryAdjustResult, InventoryLineErrorCode } from '@markaz/contracts';
import { variantAvailability } from '@markaz/platform-kit/commerce';
import { Product } from '@/lib/services';
import { recordMovement } from '@/lib/storefront/stock';

/** A setTo that keeps losing to orders gives up rather than spin. The seller reads the new count and tries again. */
const SET_TO_ATTEMPTS = 5;

interface StockRow {
  _id: unknown;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold?: number | null;
}

interface ProductStock {
  variants: StockRow[];
}

const STOCK_FIELDS = 'variants._id variants.trackQuantity variants.stockQuantity variants.lowStockThreshold';

const findVariant = (row: ProductStock, variantId: string): StockRow | null => {
  const wanted = variantId.toLowerCase();
  return row.variants.find((variant) => String(variant._id).toLowerCase() === wanted) ?? null;
};

/** A trashed product is not in the inventory, and another store's product does not exist. */
const owned = (storeId: string, productId: string): Record<string, unknown> => ({ _id: productId, store: storeId, deletedAt: null });

function refused(line: InventoryAdjustLine, status: number, code: InventoryLineErrorCode, message: string): InventoryAdjustResult {
  return { ok: false, productId: line.productId, variantId: line.variantId, status, code, message };
}

const readProduct = async (storeId: string, productId: string): Promise<ProductStock | null> =>
  (await Product.findOne(owned(storeId, productId)).select(STOCK_FIELDS).lean()) as unknown as ProductStock | null;

/**
 * The one write that changes a variant's stock here: one conditional $inc on one array element. `stock` is the condition
 * on the variant's current count. The match and the $inc are a single atomic step in MongoDB, so an order's decrement
 * lands either before (the condition sees it) or after (the $inc adds to it), and neither is ever lost.
 */
const applyDelta = async (storeId: string, line: InventoryAdjustLine, stock: unknown, delta: number): Promise<ProductStock | null> =>
  (await Product.findOneAndUpdate(
    { ...owned(storeId, line.productId), variants: { $elemMatch: { _id: line.variantId, trackQuantity: true, stockQuantity: stock } } },
    { $inc: { 'variants.$.stockQuantity': delta } },
    { new: true },
  )
    .select(STOCK_FIELDS)
    .lean()) as unknown as ProductStock | null;

/** Why a line cannot be applied, or the variant it applies to. */
function resolveLine(line: InventoryAdjustLine, row: ProductStock | null): { variant: StockRow } | { refusal: InventoryAdjustResult } {
  if (!row) return { refusal: refused(line, 404, 'PRODUCT_NOT_FOUND', 'Product not found.') };
  const variant = findVariant(row, line.variantId);
  if (!variant) return { refusal: refused(line, 404, 'VARIANT_NOT_FOUND', 'This variant is not part of the product.') };
  if (!variant.trackQuantity) return { refusal: refused(line, 422, 'VARIANT_NOT_TRACKED', 'This variant does not track quantity.') };
  return { variant };
}

function success(line: InventoryAdjustLine, variant: StockRow | null, delta: number): InventoryAdjustResult {
  const quantity = variant?.stockQuantity ?? 0;
  return {
    ok: true,
    productId: line.productId,
    variantId: line.variantId,
    previousQuantity: quantity - delta,
    delta,
    quantity,
    availability: variantAvailability({ trackQuantity: true, stockQuantity: quantity, lowStockThreshold: variant?.lowStockThreshold }),
  };
}

async function recorded(storeId: string, actorId: unknown, line: InventoryAdjustLine, row: ProductStock, delta: number): Promise<InventoryAdjustResult> {
  const variant = findVariant(row, line.variantId);
  await recordMovement(storeId, line.productId, line.variantId, variant?.stockQuantity ?? null, delta, line.reason, actorId);
  return success(line, variant, delta);
}

/** A decrease only matches while the variant holds that many units, so stock cannot go below 0. */
async function adjustByDelta(storeId: string, actorId: unknown, line: InventoryAdjustLine, delta: number): Promise<InventoryAdjustResult> {
  const after = await applyDelta(storeId, line, { $gte: Math.max(0, -delta) }, delta);
  if (after) return recorded(storeId, actorId, line, after, delta);

  const resolved = resolveLine(line, await readProduct(storeId, line.productId));
  return 'refusal' in resolved ? resolved.refusal : refused(line, 422, 'STOCK_WOULD_GO_NEGATIVE', 'This would take stock below 0.');
}

/**
 * Compare and swap. The target becomes a delta from the count just read, and the write only matches while the variant
 * still holds exactly that count. If an order got in between, the write misses and the delta is worked out again, so a
 * setTo can never overwrite a sale it has not seen. A count already at the target changes nothing and records nothing.
 */
async function adjustToTarget(storeId: string, actorId: unknown, line: InventoryAdjustLine, target: number): Promise<InventoryAdjustResult> {
  for (let attempt = 0; attempt < SET_TO_ATTEMPTS; attempt += 1) {
    const resolved = resolveLine(line, await readProduct(storeId, line.productId));
    if ('refusal' in resolved) return resolved.refusal;

    const current = resolved.variant.stockQuantity;
    const delta = target - current;
    if (delta === 0) return success(line, resolved.variant, 0);

    const after = await applyDelta(storeId, line, current, delta);
    if (after) return recorded(storeId, actorId, line, after, delta);
  }
  return refused(line, 409, 'STOCK_CHANGED', 'Stock changed while saving. Reload and try again.');
}

/**
 * Applies each line on its own, in order, and reports each on its own: a refused line undoes nothing and stops nothing.
 * This is the only way an existing variant's stock changes outside checkout (D-034). A line always becomes a change to
 * what the database holds at that moment, so a stale page can never write a stale count.
 */
export async function adjustInventory(storeId: string, actorId: unknown, lines: readonly InventoryAdjustLine[]): Promise<InventoryAdjustResponse> {
  const results: InventoryAdjustResult[] = [];
  for (const line of lines) {
    try {
      results.push(
        line.setTo !== undefined
          ? await adjustToTarget(storeId, actorId, line, line.setTo)
          : await adjustByDelta(storeId, actorId, line, line.delta ?? 0),
      );
    } catch (err) {
      console.error('[seller-backend] could not adjust stock', { productId: line.productId, variantId: line.variantId }, err);
      results.push(refused(line, 500, 'STOCK_WRITE_FAILED', 'Could not save this line. Try again.'));
    }
  }
  const succeeded = results.filter((result) => result.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}
