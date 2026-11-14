/**
 * Storefront cache-tag contract (report §4.7): the one tag map. The storefront attaches these tags to its fetches, the
 * seller backend purges them, and `/api/revalidate` accepts only tags that match `ALLOWED_TAG_PATTERNS`.
 * Pure, no I/O. The storefront's browser code may import this file, through `@markaz/platform-kit/cache-tags`.
 */

import { STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH } from "../reservation";

export const REVALIDATE_PATH = "/api/revalidate";
export const REVALIDATE_SECRET_HEADER = "x-revalidate-secret";
export const REVALIDATE_MAX_TAGS = 50;
/** Next.js ignores a longer tag. */
export const REVALIDATE_MAX_TAG_LENGTH = 256;

const OBJECT_ID = "[a-zA-Z0-9_-]{1,64}";
const PRODUCT_SLUG = "[a-zA-Z0-9_-]{1,200}";
const STORE_SLUG = `[a-z0-9-]{${STORE_SLUG_MIN_LENGTH},${STORE_SLUG_MAX_LENGTH}}`;
const STORE_KEY = "[a-z0-9-]{3,64}";

const ALLOWED_TAG_PATTERNS: readonly RegExp[] = [
  // Global taxonomy.
  /^categories$/,
  /^products$/,
  /^stores$/,
  /^themes-catalog$/,
  // Canonical store-scoped tags (§4.7 table).
  new RegExp(`^store:${OBJECT_ID}:(static|settings|categories|products)$`),
  new RegExp(`^store:${OBJECT_ID}:product:${PRODUCT_SLUG}$`),
  new RegExp(`^store-resolve:${STORE_KEY}$`),
  // Legacy tags still emitted by the Admin and Seller hooks. Remove once
  // those call sites move to the canonical names above.
  new RegExp(`^stores-${STORE_SLUG}$`),
  new RegExp(`^products-${OBJECT_ID}$`),
];

export function isAllowedRevalidateTag(tag: unknown): tag is string {
  return (
    typeof tag === "string" &&
    tag.length > 0 &&
    tag.length <= REVALIDATE_MAX_TAG_LENGTH &&
    ALLOWED_TAG_PATTERNS.some((pattern) => pattern.test(tag))
  );
}

export type RevalidateTagsResult =
  | { readonly ok: true; readonly tags: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: "MISSING_TAGS" | "TOO_MANY_TAGS" | "INVALID_TAG";
      readonly invalidTags: readonly string[];
    };

/**
 * Validates a `tags` array from a request body or from a caller. Duplicates are
 * removed. Any value that is not an allowed tag fails the whole batch.
 */
export function validateRevalidateTags(input: unknown): RevalidateTagsResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, reason: "MISSING_TAGS", invalidTags: [] };
  }
  if (input.length > REVALIDATE_MAX_TAGS) {
    return { ok: false, reason: "TOO_MANY_TAGS", invalidTags: [] };
  }
  const invalid: string[] = [];
  const valid = new Set<string>();
  for (const candidate of input) {
    if (isAllowedRevalidateTag(candidate)) {
      valid.add(candidate);
    } else {
      invalid.push(typeof candidate === "string" ? candidate.slice(0, REVALIDATE_MAX_TAG_LENGTH) : String(typeof candidate));
    }
  }
  if (invalid.length > 0) {
    return { ok: false, reason: "INVALID_TAG", invalidTags: invalid };
  }
  return { ok: true, tags: Array.from(valid) };
}

/**
 * The tag map. Use these instead of inline template strings.
 *
 *   static      every read of this store's data, so a change to the store as a whole drops all of it
 *   settings    reads whose answer depends on the store's settings, such as a product page's delivery charge
 *   categories  the category list
 *   products    product lists, and each product page
 *   product     one product page. Keyed by slug, because a page is fetched by slug and a tag must be known before the fetch
 */
export const storeTags = {
  static: (storeId: string): string => `store:${storeId}:static`,
  settings: (storeId: string): string => `store:${storeId}:settings`,
  categories: (storeId: string): string => `store:${storeId}:categories`,
  products: (storeId: string): string => `store:${storeId}:products`,
  product: (storeId: string, productSlug: string): string => `store:${storeId}:product:${productSlug}`,
} as const;

/** The store record, which is fetched by its slug or handle before its id is known. */
export const storeResolveTag = (key: string): string => `store-resolve:${key}`;
