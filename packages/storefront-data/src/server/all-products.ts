import type { StorefrontProductSummary, StorefrontTransport } from "../transport/types";

export interface AllProductsOptions {
  /** Safety cap on the number of pages read. */
  maxPages?: number;
  limit?: number;
}

/**
 * The whole catalogue, up to maxPages pages of limit products. Used where a theme groups products by category, builds a
 * menu or searches. A store larger than the cap is truncated.
 * A transport without paging answers with its single list.
 */
export async function loadAllProducts(
  transport: StorefrontTransport,
  options: AllProductsOptions = {},
): Promise<StorefrontProductSummary[]> {
  const { maxPages = 5, limit = 48 } = options;
  if (!transport.listProducts) return transport.getProducts();
  const all: StorefrontProductSummary[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await transport.listProducts({ page, limit });
    all.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return all;
}
