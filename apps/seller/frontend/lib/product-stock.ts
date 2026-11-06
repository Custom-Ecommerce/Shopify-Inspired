import type { Product, ProductVariant, StockStatus } from "@markaz/contracts";

/**
 * Read helpers for the dashboard pages that still show a product as one row. These pages are rebuilt with the product
 * routes, which will send the derived status; until then they show the first variant.
 */
export function firstVariant(product: Product): ProductVariant | undefined {
  return product.variants[0];
}

export function stockStatusOf(variant: ProductVariant | undefined): StockStatus {
  if (!variant) return "out_of_stock";
  if (!variant.trackQuantity) return "in_stock";
  if (variant.stockQuantity <= 0) return "out_of_stock";
  const threshold = variant.lowStockThreshold;
  return threshold !== null && variant.stockQuantity <= threshold ? "low_stock" : "in_stock";
}
