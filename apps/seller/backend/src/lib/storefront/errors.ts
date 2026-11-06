import { NextResponse } from 'next/server';

export type StorefrontErrorCode =
  | 'STORE_NOT_FOUND'
  | 'STORE_NOT_ACTIVE'
  | 'PRODUCT_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'STOREFRONT_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'ORDER_NOT_FOUND'
  | 'EMPTY_ORDER'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_PRODUCT'
  | 'OUT_OF_STOCK'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'VARIANT_REQUIRED'
  | 'UNKNOWN_VARIANT';

/** Carries the storefront error envelope: { error: { code, message }, ...extra }. */
export class StorefrontHttpError extends Error {
  readonly status: number;
  readonly code: StorefrontErrorCode;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: StorefrontErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'StorefrontHttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Errors are never cacheable. */
export function storefrontError(err: StorefrontHttpError): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  const retryAfter = err.extra.retryAfterSeconds;
  if (typeof retryAfter === 'number') headers['Retry-After'] = String(Math.max(1, Math.ceil(retryAfter)));
  return NextResponse.json({ error: { code: err.code, message: err.message }, ...err.extra }, { status: err.status, headers });
}

/** Order and lookup responses carry customer data: never cacheable. */
export const PRIVATE_NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** Translates thrown errors into the storefront envelope. Anything unrecognised is a 500 with no detail. */
export function handleStorefrontError(err: unknown): NextResponse {
  if (err instanceof StorefrontHttpError) return storefrontError(err);
  console.error('[seller-backend] unhandled storefront route error', err);
  return storefrontError(new StorefrontHttpError(500, 'INTERNAL_ERROR', 'Internal server error'));
}

export const storeNotFound = (): StorefrontHttpError =>
  new StorefrontHttpError(404, 'STORE_NOT_FOUND', 'Store not found.');

export const databaseUnavailable = (): StorefrontHttpError =>
  new StorefrontHttpError(503, 'STOREFRONT_UNAVAILABLE', 'Storefront data is temporarily unavailable.');

/** Public, shared-cache friendly. The storefront also caches by tag, so these stay short. */
export const PUBLIC_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
} as const;
