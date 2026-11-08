/** Shared display text for the seller dashboard. */

/** Money on the orders screens: "Rs. 4,500". A fixed locale, so the server and the browser always print the same thing. */
export const formatRs = (amount: number): string => `Rs. ${amount.toLocaleString("en-US")}`;

const STOCK_STATUS_LABELS: Record<string, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
};

const withSpaces = (value: string): string => value.replace(/_/g, " ");

/** "in_stock" becomes "In stock". Anything else is shown readably rather than hidden. */
export function stockStatusLabel(status: string): string {
  const known = STOCK_STATUS_LABELS[status];
  if (known) return known;
  const text = withSpaces(status);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STOCK_REASON_LABELS: Record<string, string> = {
  storefront_order: "Customer order",
  storefront_order_released: "Order not saved, stock returned",
  order_cancelled: "Order cancelled, stock returned",
};

/** The reason on a stock history row. A seller's own typed reason, or an unknown one, is shown as it is, without underscores. */
export function stockReasonLabel(reason: string): string {
  return STOCK_REASON_LABELS[reason] ?? withSpaces(reason);
}
