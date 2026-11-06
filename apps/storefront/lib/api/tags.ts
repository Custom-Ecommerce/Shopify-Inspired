import "server-only";

import { storeResolveTag as kitStoreResolveTag, storeTags } from "@markaz/platform-kit/revalidate";

/**
 * Next.js fetch-cache tags used by the storefront data layer (report §4.7).
 *
 * The strings are NOT defined here. They come from the platform-kit contract,
 * the same builders the seller and admin backends use to purge, so a purge and
 * a fetch can never drift apart. Resulting formats:
 *
 *   store:${id}:static
 *   store:${id}:categories
 *   store:${id}:products
 *   store:${id}:product:${productId}
 *   store-resolve:${key}
 *
 * `server-only` because the platform-kit `/revalidate` subpath also exports a
 * `node:crypto` helper, so importing it from a client bundle must fail loudly.
 */

export const storeStaticTag = (storeId: string): string => storeTags.static(storeId);
export const storeCategoriesTag = (storeId: string): string => storeTags.categories(storeId);
export const storeProductsTag = (storeId: string): string => storeTags.products(storeId);
export const storeProductTag = (storeId: string, productId: string): string =>
  storeTags.product(storeId, productId);
export const storeResolveTag = (key: string): string => kitStoreResolveTag(key);
