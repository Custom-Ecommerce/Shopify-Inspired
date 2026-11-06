/**
 * Typed errors for the seller storefront API (report §4.6).
 *
 * Every class carries a stable `code` that matches the backend's error
 * namespace (`{ error: { code } }`), so callers can branch with `instanceof`
 * or on `code`. Pure module: safe to import anywhere, including type positions
 * in shared code.
 */

export type StorefrontErrorCode =
  | "STORE_NOT_FOUND"
  | "STORE_NOT_ACTIVE"
  | "PRODUCT_NOT_FOUND"
  | "STOREFRONT_UNAVAILABLE"
  | "RATE_LIMITED";

export interface StorefrontApiErrorOptions {
  /** HTTP status the seller backend answered with, when there was a response. */
  upstreamStatus?: number;
  cause?: unknown;
}

export abstract class StorefrontApiError extends Error {
  abstract readonly code: StorefrontErrorCode;
  readonly upstreamStatus: number | undefined;

  constructor(message: string, options: StorefrontApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.upstreamStatus = options.upstreamStatus;
  }
}

export class StoreNotFoundError extends StorefrontApiError {
  readonly code = "STORE_NOT_FOUND" as const;
  constructor(message = "Store not found.", options: StorefrontApiErrorOptions = {}) {
    super(message, { upstreamStatus: 404, ...options });
  }
}

export class StoreNotActiveError extends StorefrontApiError {
  readonly code = "STORE_NOT_ACTIVE" as const;
  /** Effective store state reported by the backend (pending, suspended, archived). */
  readonly storeStatus: string | undefined;
  constructor(
    message = "This store is not available.",
    options: StorefrontApiErrorOptions & { storeStatus?: string } = {},
  ) {
    super(message, { upstreamStatus: 403, ...options });
    this.storeStatus = options.storeStatus;
  }
}

export class ProductNotFoundError extends StorefrontApiError {
  readonly code = "PRODUCT_NOT_FOUND" as const;
  constructor(message = "Product not found.", options: StorefrontApiErrorOptions = {}) {
    super(message, { upstreamStatus: 404, ...options });
  }
}

/**
 * The backend could not be reached or answered with something unusable:
 * network failure or timeout (after the retry), 5xx, a 4xx the storefront does
 * not understand, or a body that is not the documented envelope.
 */
export class StorefrontUnavailableError extends StorefrontApiError {
  readonly code = "STOREFRONT_UNAVAILABLE" as const;
  constructor(
    message = "Storefront data is temporarily unavailable.",
    options: StorefrontApiErrorOptions = {},
  ) {
    super(message, options);
  }
}

export class RateLimitedError extends StorefrontApiError {
  readonly code = "RATE_LIMITED" as const;
  /** Seconds from the `Retry-After` header, when the backend sent a numeric one. */
  readonly retryAfterSeconds: number | undefined;
  constructor(
    message = "Too many requests.",
    options: StorefrontApiErrorOptions & { retryAfterSeconds?: number } = {},
  ) {
    super(message, { upstreamStatus: 429, ...options });
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isStorefrontApiError(error: unknown): error is StorefrontApiError {
  return error instanceof StorefrontApiError;
}
