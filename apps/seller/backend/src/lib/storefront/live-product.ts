/**
 * What makes a product Live, in one place (D-022, D-037). Every storefront read and every checkout write starts from
 * this, so a new rule cannot be added to one route and forgotten in another. A seller's own reads do not use it.
 */
export function liveProductFilter(storeId: string): Record<string, unknown> {
  return { store: storeId, isPublished: true, isDemo: { $ne: true }, deletedAt: null, moderation: null };
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

/**
 * What a seller's preview shows (D-018, D-022): everything in the store that is not in the trash, drafts and the sample
 * product included. A route uses this only after isPreviewRequest said yes for exactly this store. Checkout never does.
 */
export function previewProductFilter(storeId: string): Record<string, unknown> {
  return { store: storeId, deletedAt: null };
}

/** Preview lists and the category list. hideWhenOutOfStock is not applied: the seller is here to see everything. */
export function previewListFilter(storeId: string): Record<string, unknown> {
  return previewProductFilter(storeId);
}

export interface LiveFlags {
  isPublished?: boolean | null;
  isDemo?: boolean | null;
  deletedAt?: unknown;
  /** An admin's takedown. A read that decides Live must select it. */
  moderation?: unknown;
}

export type PreviewLabel = 'Draft' | 'Sample product' | 'Removed by admin';

/** Why a shopper would not see this product, for the tag in a preview. Null when it is Live. */
export function previewLabelOf(row: LiveFlags): PreviewLabel | null {
  if (row.moderation) return 'Removed by admin';
  if (row.isDemo === true) return 'Sample product';
  return row.isPublished === true ? null : 'Draft';
}

/** liveProductFilter for a row already read, so a refusal can name the line instead of calling the product unknown. */
export function isLiveProduct(row: LiveFlags): boolean {
  return (
    row.isPublished === true &&
    row.isDemo !== true &&
    (row.deletedAt === null || row.deletedAt === undefined) &&
    (row.moderation === null || row.moderation === undefined)
  );
}
