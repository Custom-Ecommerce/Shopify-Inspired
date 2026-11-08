import { variantAvailability, type StockAvailability } from '@markaz/platform-kit/commerce';

/** A variant as the checkout reads it from the catalog. */
export interface CheckoutVariant {
  _id: unknown;
  title: string;
  sku?: string | null;
  price: number;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold?: number | null;
}

export type VariantResolution<V> =
  | { kind: 'ok'; variant: V }
  | { kind: 'variant_required' }
  | { kind: 'unknown_variant' };

/**
 * Which variant a cart line means. A line may leave variantId out only when the product has exactly one variant, so a
 * shopper is never given a size or colour they did not choose. A variantId must belong to this product.
 */
export function resolveVariant<V extends { _id: unknown }>(variants: readonly V[], variantId: string | null): VariantResolution<V> {
  if (variantId !== null) {
    const wanted = variantId.toLowerCase();
    const variant = variants.find((candidate) => String(candidate._id).toLowerCase() === wanted);
    return variant ? { kind: 'ok', variant } : { kind: 'unknown_variant' };
  }
  if (variants.length === 1) return { kind: 'ok', variant: variants[0] };
  return variants.length === 0 ? { kind: 'unknown_variant' } : { kind: 'variant_required' };
}

export function availabilityOf(variant: CheckoutVariant): StockAvailability {
  return variantAvailability(variant);
}

/** Whether qty units can be bought now. A variant that does not track quantity always can. */
export function canSupply(variant: CheckoutVariant, qty: number): boolean {
  return !variant.trackQuantity || variant.stockQuantity >= qty;
}

/** The units left, or null when the variant does not track quantity. */
export function unitsLeft(variant: CheckoutVariant): number | null {
  return variant.trackQuantity ? Math.max(0, variant.stockQuantity) : null;
}
