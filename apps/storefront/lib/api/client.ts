import "server-only";

import type { z } from "zod";

import {
  ProductNotFoundError,
  RateLimitedError,
  StoreNotActiveError,
  StoreNotFoundError,
  StorefrontUnavailableError,
  type StorefrontApiError,
} from "./errors";
import { StorefrontErrorEnvelope } from "./schemas";

/** Path prefix of the public storefront API on the seller backend. */
export const STOREFRONT_API_PREFIX = "/api/storefront/v1";

/** Per-attempt timeout. Each attempt gets a fresh signal. */
export const SELLER_TIMEOUT_MS = 4000;

/** Network-level failures get exactly one more attempt. HTTP responses never do. */
const NETWORK_RETRIES = 1;

export type QueryValue = string | number | boolean | undefined | null;

export interface SellerGetOptions {
  /** Query-string parameters. `undefined`/`null`/empty-string values are dropped. */
  query?: Record<string, QueryValue>;
  /** Next.js data-cache tags for this request. */
  tags?: readonly string[];
  /**
   * Next.js data-cache TTL in seconds. Omit to opt out of the data cache
   * (`cache: "no-store"`); Next 15 does not cache `fetch` by default anyway.
   */
  revalidate?: number;
}

/** Read per call, not at module load, so the value tracks the runtime env. */
function baseUrl(): string {
  return (process.env.SELLER_BACKEND_API_URL || "http://localhost:4001").replace(/\/+$/, "");
}

function buildUrl(path: string, query: SellerGetOptions["query"]): string {
  const url = new URL(`${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(name, String(value));
    }
  }
  return url.toString();
}

/**
 * One attempt. `fetch` only rejects for network-level failures (DNS, refused
 * connection, reset, timeout/abort); any HTTP status resolves normally.
 */
function attempt(url: string, options: SellerGetOptions): Promise<Response> {
  const next =
    options.revalidate !== undefined
      ? { revalidate: options.revalidate, ...(options.tags?.length ? { tags: [...options.tags] } : {}) }
      : undefined;

  return fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SELLER_TIMEOUT_MS),
    ...(next ? { next } : { cache: "no-store" as const }),
  });
}

async function fetchWithRetry(url: string, options: SellerGetOptions): Promise<Response> {
  let lastError: unknown;
  for (let tries = 0; tries <= NETWORK_RETRIES; tries += 1) {
    try {
      return await attempt(url, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw new StorefrontUnavailableError("Could not reach the seller backend.", { cause: lastError });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Maps a non-2xx response to a typed error. The backend's `error.code` is
 * authoritative for 404/403; the status alone is never enough, so a 404 from a
 * misrouted or older backend ("route not found") surfaces as UNAVAILABLE
 * instead of silently reading as "store not found".
 */
async function toApiError(response: Response): Promise<StorefrontApiError> {
  const upstreamStatus = response.status;
  const parsed = StorefrontErrorEnvelope.safeParse(await readJson(response));
  const code = parsed.success ? parsed.data.error.code : undefined;
  const message = parsed.success ? parsed.data.error.message : undefined;

  if (upstreamStatus === 429) {
    return new RateLimitedError(message, {
      upstreamStatus,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  if (upstreamStatus === 404 && code === "STORE_NOT_FOUND") {
    return new StoreNotFoundError(message, { upstreamStatus });
  }
  if (upstreamStatus === 404 && code === "PRODUCT_NOT_FOUND") {
    return new ProductNotFoundError(message, { upstreamStatus });
  }
  if (upstreamStatus === 403 && code === "STORE_NOT_ACTIVE") {
    return new StoreNotActiveError(message, {
      upstreamStatus,
      storeStatus: parsed.success ? parsed.data.status : undefined,
    });
  }
  // 5xx, and any 4xx the storefront has no specific meaning for.
  return new StorefrontUnavailableError(message, { upstreamStatus });
}

/**
 * GET `path` on the seller backend and return the decoded JSON body, untouched.
 *
 * - Timeout: 4s per attempt (`AbortSignal.timeout`).
 * - Retry: exactly one retry, only when `fetch` itself fails (network error or
 *   timeout). 4xx and 5xx responses are never retried.
 * - Errors: every failure is thrown as a `StorefrontApiError` subclass.
 *
 * Callers must validate the result with the Zod schemas before using it.
 */
export async function sellerGet(path: string, options: SellerGetOptions = {}): Promise<unknown> {
  const response = await fetchWithRetry(buildUrl(path, options.query), options);

  if (!response.ok) throw await toApiError(response);

  try {
    return await response.json();
  } catch (cause) {
    throw new StorefrontUnavailableError("Seller backend returned a non-JSON body.", {
      upstreamStatus: response.status,
      cause,
    });
  }
}

/**
 * Validates a decoded body against a schema. A body that does not match is a
 * backend contract violation, so it is reported as UNAVAILABLE (never leaked
 * to callers as a half-valid object). Zod issues are kept on `cause` for logs.
 */
export function parseResponse<S extends z.ZodTypeAny>(schema: S, body: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new StorefrontUnavailableError(`Seller backend returned an unexpected ${label} response.`, {
      cause: result.error,
    });
  }
  return result.data;
}
