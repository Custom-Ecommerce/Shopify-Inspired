/**
 * What makes a product Live, in one place (D-022, D-037). Every storefront read and every checkout write starts from
 * this, so a new rule cannot be added to one route and forgotten in another. A seller's own reads do not use it.
 */
export function liveProductFilter(storeId: string): Record<string, unknown> {
  return { store: storeId, isPublished: true, isDemo: { $ne: true }, deletedAt: null };
}

/**
 * Live lists and the category list. On top of the rule above, a product whose seller chose hideWhenOutOfStock stays out
 * while no variant can be bought. The $elemMatch is variantAvailability's out_of_stock rule, read by the database, so
 * nothing is stored and a stock change takes effect at once. The product page does not use this: a link keeps working.
 */
export function liveListFilter(storeId: string): Record<string, unknown> {
  return {
    ...liveProductFilter(storeId),
    $or: [
      { hideWhenOutOfStock: { $ne: true } },
      { variants: { $elemMatch: { $or: [{ trackQuantity: false }, { stockQuantity: { $gt: 0 } }] } } },
    ],
  };
}

export interface LiveFlags {
  isPublished?: boolean | null;
  isDemo?: boolean | null;
  deletedAt?: unknown;
}

/** liveProductFilter for a row already read, so a refusal can name the line instead of calling the product unknown. */
export function isLiveProduct(row: LiveFlags): boolean {
  return row.isPublished === true && row.isDemo !== true && (row.deletedAt === null || row.deletedAt === undefined);
}
