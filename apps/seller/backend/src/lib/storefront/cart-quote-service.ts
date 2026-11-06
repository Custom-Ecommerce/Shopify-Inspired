import { Product } from '@/lib/services';
import { buildCartQuote, type CartQuote, type QuoteCatalogRow, type QuoteRequestLine } from '@/lib/storefront/cart-quote';
import type { StoreCommerce } from '@/lib/storefront/store-guard';

const HEX_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Prices a cart against this store's published catalog. It reads only: no stock moves, and no order is written. An id
 * that cannot be a product is never sent to the database, because the database would reject it as a cast error.
 */
export async function loadCartQuote(
  storeId: string,
  commerce: StoreCommerce,
  lines: QuoteRequestLine[],
): Promise<CartQuote> {
  const queryable = lines.map((line) => line.productId).filter((id) => HEX_ID.test(id));
  const rows =
    queryable.length === 0
      ? []
      : ((await (Product as any)
          .find({ _id: { $in: queryable }, store: storeId, isPublished: true })
          .select('title price deliveryCharge stockQuantity reservedQuantity stockStatus')
          .lean()) as Array<QuoteCatalogRow & { _id: unknown }>);
  const catalog = new Map(rows.map((row) => [String(row._id).toLowerCase(), row] as const));
  return buildCartQuote(lines, catalog, commerce);
}
