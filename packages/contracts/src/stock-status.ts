/** How available a variant or a product is. Always derived from the variants, never stored. */
export const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
