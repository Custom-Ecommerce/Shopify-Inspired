import "server-only";

import { STOREFRONT_API_PREFIX, parseResponse, sellerGet } from "./client";
import {
  ProductDetailResponse,
  ProductListResponse,
  type StorefrontProductDetail,
} from "./schemas";
import { storeProductTag, storeProductsTag, storeSettingsTag, storeStaticTag } from "./tags";

export const PRODUCTS_REVALIDATE_SECONDS = 600;

/**
 * Free-text searches are unbounded in variety, so they get a short TTL to keep
 * arbitrary `q` values from filling the data cache for ten minutes each.
 */
export const PRODUCT_SEARCH_REVALIDATE_SECONDS = 60;

export const PRODUCT_SORTS = ["newest", "price_asc", "price_desc", "rating"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export interface ProductListParams {
  /** Category slug. */
  category?: string;
  /** Title search. The backend trims it and caps it at 80 characters. */
  q?: string;
  sort?: ProductSort;
  page?: number;
  /** The backend clamps this to 1..48. */
  limit?: number;
}

export type ProductList = ProductListResponse;

/**
 * GET /stores/:storeId/products
 *
 * Returns the parsed page envelope (`data`, `page`, `totalPages`, `totalDocs`,
 * `limit`). Tagged `store:<id>:products`, which the seller purges on any
 * product change in that store.
 */
export async function fetchProducts(storeId: string, params: ProductListParams = {}): Promise<ProductList> {
  const body = await sellerGet(`${STOREFRONT_API_PREFIX}/stores/${encodeURIComponent(storeId)}/products`, {
    query: {
      category: params.category,
      q: params.q?.trim(),
      sort: params.sort,
      page: params.page,
      limit: params.limit,
    },
    tags: [storeProductsTag(storeId), storeStaticTag(storeId)],
    revalidate: params.q?.trim() ? PRODUCT_SEARCH_REVALIDATE_SECONDS : PRODUCTS_REVALIDATE_SECONDS,
  });
  return parseResponse(ProductListResponse, body, "product list");
}

/**
 * GET /stores/:storeId/products/:slug
 *
 * Tagged with this product's slug, the store's product list, and its settings
 * (the delivery charge falls back to the store's rate). Throws
 * `ProductNotFoundError` when absent.
 */
export async function fetchProductBySlug(storeId: string, slug: string): Promise<StorefrontProductDetail> {
  const body = await sellerGet(
    `${STOREFRONT_API_PREFIX}/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(slug)}`,
    {
      tags: [storeProductTag(storeId, slug), storeProductsTag(storeId), storeSettingsTag(storeId), storeStaticTag(storeId)],
      revalidate: PRODUCTS_REVALIDATE_SECONDS,
    },
  );
  return parseResponse(ProductDetailResponse, body, "product").data;
}
