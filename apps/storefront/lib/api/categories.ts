import "server-only";

import { STOREFRONT_API_PREFIX, parseResponse, sellerGet } from "./client";
import { CategoriesResponse, type StorefrontCategory } from "./schemas";
import { storeCategoriesTag, storeProductsTag, storeStaticTag } from "./tags";

export const CATEGORIES_REVALIDATE_SECONDS = 600;

/**
 * GET /stores/:storeId/categories
 *
 * The backend returns only categories that hold at least one published product
 * in this store, so the result depends on product changes as well as category
 * changes. It is tagged with both `store:<id>:categories` and
 * `store:<id>:products`.
 */
export async function fetchCategories(storeId: string): Promise<StorefrontCategory[]> {
  const body = await sellerGet(`${STOREFRONT_API_PREFIX}/stores/${encodeURIComponent(storeId)}/categories`, {
    tags: [storeCategoriesTag(storeId), storeProductsTag(storeId), storeStaticTag(storeId)],
    revalidate: CATEGORIES_REVALIDATE_SECONDS,
  });
  return parseResponse(CategoriesResponse, body, "categories").data;
}
