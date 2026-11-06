/** Stock status option set, as in apps/admin/src/collections/Products.ts (stockStatus). */
export const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
