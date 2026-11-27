import { HttpError } from '@/lib/http';
import { revisionFilter, revisionOf, RevisionConflictError } from '@/lib/mobile-revision';
import { applyProductUpdate, prepareProductUpdate, ProductRequestError, productNotFound, type VariantRow } from '@/lib/products';
import { Product } from '@/lib/services';

/*
 * Sprint 9 (EP-31.US03.T03): the price of ONE variant, changed the way the portal changes a product: the whole variant list goes through
 * prepareProductUpdate (the same price and compare-at rules, minPrice recomputed) and the one write of applyProductUpdate, which keeps the stock the database
 * holds. The write also needs the revision the app saw.
 */

export interface VariantPriceChange {
  variantId: string;
  price: number;
  /** undefined keeps the stored compare-at price; null removes it. */
  compareAtPrice?: number | null;
}

export async function setVariantPrice(storeId: string, productId: string, change: VariantPriceChange, revision: number): Promise<{ changed: boolean }> {
  const current = (await Product.findOne({ _id: productId, store: storeId, deletedAt: null }).select('options variants media updatedAt').lean()) as unknown as {
    options?: Array<{ name: string; values: string[] }> | null;
    variants: VariantRow[];
    media?: unknown[] | null;
    updatedAt?: unknown;
  } | null;
  if (!current) throw productNotFound();
  const wanted = change.variantId.toLowerCase();
  const variant = current.variants.find((row) => String(row._id).toLowerCase() === wanted);
  if (!variant) throw new HttpError(404, 'This variant is not part of the product.', 'VARIANT_NOT_FOUND');

  const compareAt = change.compareAtPrice === undefined ? (variant.compareAtPrice ?? null) : change.compareAtPrice;
  if (variant.price === change.price && (variant.compareAtPrice ?? null) === compareAt) return { changed: false };
  if (revisionOf(current.updatedAt) !== revision) throw new RevisionConflictError();

  const data = {
    variants: current.variants.map((row) =>
      String(row._id).toLowerCase() === wanted
        ? { id: String(row._id), price: change.price, compareAtPrice: compareAt }
        : { id: String(row._id) },
    ),
  };
  const prepared = await prepareProductUpdate(storeId, productId, data, current);
  try {
    await applyProductUpdate(storeId, productId, data, prepared, revisionFilter(revision));
  } catch (err) {
    // The filter missed: the revision moved, or a kept variant was removed.
    if (err instanceof ProductRequestError && err.code === 'PRODUCT_CHANGED') throw new RevisionConflictError();
    throw err;
  }
  return { changed: true };
}
