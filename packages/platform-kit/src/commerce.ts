/**
 * Commerce rules shared by the seller backend and the storefront data layer. Pure: no I/O, no framework.
 *
 * It lives here because this is the one package both sides depend on. No theme carries a copy of these rules (D-029).
 */

export type StockAvailability = "in_stock" | "low_stock" | "out_of_stock";

export interface StockedVariant {
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold?: number | null;
}

/** A variant that does not track quantity is always in stock. */
export function variantAvailability(variant: StockedVariant): StockAvailability {
  if (!variant.trackQuantity) return "in_stock";
  if (variant.stockQuantity <= 0) return "out_of_stock";
  const threshold = variant.lowStockThreshold;
  if (threshold !== null && threshold !== undefined && variant.stockQuantity <= threshold) return "low_stock";
  return "in_stock";
}

/** The best status among the variants wins: out of stock only when every variant is. */
export function productAvailability(statuses: readonly StockAvailability[]): StockAvailability {
  if (statuses.includes("in_stock")) return "in_stock";
  if (statuses.includes("low_stock")) return "low_stock";
  return "out_of_stock";
}

/** The saving as a whole percent of the compare-at price. 0 when there is no real discount. */
export function discountPercent(price: number, compareAt: number | null | undefined): number {
  if (compareAt === null || compareAt === undefined) return 0;
  if (!Number.isFinite(price) || !Number.isFinite(compareAt) || price < 0 || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
