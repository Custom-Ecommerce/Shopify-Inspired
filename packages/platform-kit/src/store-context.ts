/**
 * Store-context constants (blueprint §3.3, §4.6 `store-context`, §6.8).
 * Phase 1 stub: names and the error-code catalogue only. Parsing helpers
 * are added in Phase 4/6.
 */

/** Header client code sends on `/api/dashboard/*` calls. */
export const STORE_ID_HEADER = "x-store-id";

/** Cookie remembering the last-used store. A hint only; never authorizes. */
export const LAST_STORE_COOKIE = "last-store";

/** Error codes shared by backends and the seller dashboard. */
export const STORE_ERROR_CODES = {
  STORE_FORBIDDEN: "STORE_FORBIDDEN",
} as const;

export type StoreErrorCode = (typeof STORE_ERROR_CODES)[keyof typeof STORE_ERROR_CODES];

/**
 * Storefront error codes (report §4.6). Returned in `{ error: { code, message } }`
 * by the seller public read API and mirrored by the storefront's `lib/api/errors.ts`.
 */
export const STOREFRONT_ERROR_CODES = {
  STORE_NOT_FOUND: "STORE_NOT_FOUND",
  STORE_NOT_ACTIVE: "STORE_NOT_ACTIVE",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  STOREFRONT_UNAVAILABLE: "STOREFRONT_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type StorefrontErrorCode = (typeof STOREFRONT_ERROR_CODES)[keyof typeof STOREFRONT_ERROR_CODES];
