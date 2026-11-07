import { Product } from '@/lib/services';
import { buildCartQuote, type CartQuote, type QuoteCatalogRow, type QuoteRequestLine } from '@/lib/storefront/cart-quote';
import { isLiveProduct, type LiveFlags } from '@/lib/storefront/live-product';
import type { StoreCommerce } from '@/lib/storefront/store-guard';

const HEX_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Prices a cart against this store's Live catalog. It reads only: no stock moves, and no order is written. An id
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
      : ((await Product.find({ _id: { $in: queryable }, store: storeId })
          .select('title deliveryCharge variants isPublished isDemo deletedAt moderation')
          .lean()) as unknown as Array<QuoteCatalogRow & LiveFlags & { _id: unknown }>);
  const idOf = (row: { _id: unknown }): string => String(row._id).toLowerCase();
  const catalog = new Map(rows.filter(isLiveProduct).map((row) => [idOf(row), row] as const));
  const unavailable = new Set(rows.filter((row) => !isLiveProduct(row)).map(idOf));
  return buildCartQuote(lines, catalog, commerce, unavailable);
}
