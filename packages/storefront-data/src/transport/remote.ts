import type { z } from "zod";
import { storeTags } from "@markaz/platform-kit/cache-tags";
import { PREVIEW_CREDENTIAL_HEADER } from "@markaz/platform-kit/preview";
import { ORDER_OUTCOME_UNKNOWN_CODE, OrderRejectedError, TransportUnavailableError } from "./errors";
import type { ProductListPage, ProductQuery } from "./types";
import type {
  CartQuote,
  CartQuoteInput,
  OrderLookupInput,
  OrderRejection,
  OrderTransport,
  StorefrontCategory,
  StorefrontOrder,
  StorefrontOrderTracking,
  StorefrontProductDetail,
  StorefrontProductSummary,
  StorefrontTransport,
  SubmitOrderPayload,
  SubmitOrderResult,
} from "./types";
import {
  WireCartQuoteEnvelope,
  WireErrorEnvelope,
  WireOrderCreated,
  WireOrderLookup,
  WireOrderTrackingEnvelope,
  WireCategoryList,
  WireProductDetailEnvelope,
  WireProductList,
  WireRefusal,
} from "./wire";

/** Path prefix of the public storefront API on the seller backend. Matches apps/storefront/lib/api/client.ts. */
export const STOREFRONT_API_PREFIX = "/api/storefront/v1";

/** Same-origin path of the BFF. Matches the route files under apps/storefront/app/api/storefront. */
export const BFF_BASE_PATH = "/api/storefront";

/** Per-attempt timeout to the seller backend. Matches the app's existing seller client. */
export const DEFAULT_REMOTE_TIMEOUT_MS = 4000;

/** Per-attempt timeout from the browser to the BFF. The BFF adds one backend hop, so this is wider. */
export const DEFAULT_BFF_TIMEOUT_MS = 10000;

/**
 * Placing an order writes stock and the order, so it gets longer than a read. The backend hop is shorter than the browser
 * hop, so the BFF can still answer the browser when the backend does not answer it.
 */
export const DEFAULT_SUBMIT_REMOTE_TIMEOUT_MS = 20000;
export const DEFAULT_SUBMIT_BFF_TIMEOUT_MS = 25000;

/** How long a catalog read may be kept when no purge arrives. The seller backend purges these tags on every change. */
export const CATALOG_REVALIDATE_SECONDS = 600;
/** Free-text searches are unbounded in variety, so they are kept briefly. */
export const SEARCH_REVALIDATE_SECONDS = 60;

/**
 * "http" (the default) calls the seller backend. "stub" never touches the network: every call rejects with
 * not_implemented. Use stub only for a storefront that runs without a seller backend.
 */
export type RemoteMode = "stub" | "http";

export interface RemoteTransportOptions {
  /** Seller backend origin, for example http://localhost:4001. Server-side only: never sent to a browser. */
  baseUrl: string;
  /** The store this transport is bound to. Every call is scoped to it. */
  storeId: string;
  mode?: RemoteMode;
  timeoutMs?: number;
  /** Timeout for placing an order. Defaults to DEFAULT_SUBMIT_REMOTE_TIMEOUT_MS. */
  submitTimeoutMs?: number;
  /** Injected in tests. Defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  /**
   * The shopper's IP as the BFF trusts it. Sent as x-forwarded-for, so the backend's per-client limits apply to the
   * shopper and not to the storefront server. Omit it for calls that are not made on a shopper's behalf.
   */
  clientIp?: string | null;
  /**
   * A preview the backend accepted for this store. Sent as a header on every call, never in a URL. With one set every
   * call is no-store, so a preview answer has no cache entry at all. A credential: never log it.
   */
  previewToken?: string | null;
}

export interface BffTransportOptions {
  /** Same-origin prefix. Defaults to BFF_BASE_PATH, which keeps every call on the store's own host. */
  basePath?: string;
  timeoutMs?: number;
  /** Timeout for placing an order. Defaults to DEFAULT_SUBMIT_BFF_TIMEOUT_MS. */
  submitTimeoutMs?: number;
  /** Injected in tests. Defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

interface Exchange {
  status: number;
  body: unknown;
}

interface ExchangeRequest {
  body?: unknown;
  headers?: Record<string, string>;
  /** Reads may retry once after a network failure. Writes never do: the caller retries with its key. */
  retry: boolean;
  /** Overrides the exchanger's timeout for this call. */
  timeoutMs?: number;
  /** Lets the storefront's data cache keep this read under these tags. Ignored for a preview, which is never kept. */
  cached?: { tags: string[]; revalidateSeconds: number };
}

type Exchanger = (method: "GET" | "POST", path: string, request: ExchangeRequest) => Promise<Exchange>;

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** Removes trailing slashes without a regular expression. */
export function normalizeBaseUrl(url: string): string {
  let end = url.length;
  while (end > 0 && url.charAt(end - 1) === "/") end -= 1;
  return url.slice(0, end);
}

function errorCode(body: unknown): string | undefined {
  const parsed = WireErrorEnvelope.safeParse(body);
  return parsed.success ? parsed.data.error.code : undefined;
}

/** fetch rejects for network failures and for timeouts (AbortSignal.timeout gives "TimeoutError"). */
function toTransportError(error: unknown): TransportUnavailableError {
  const name = typeof error === "object" && error !== null ? String((error as { name?: unknown }).name) : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new TransportUnavailableError("timeout", "The seller backend did not answer in time.");
  }
  return new TransportUnavailableError("network", "Could not reach the seller backend.");
}

/** Maps an exchange to the typed body, or throws a typed error. Never returns a half-valid object. */
function unwrap<S extends z.ZodTypeAny>(exchange: Exchange, schema: S, label: string): z.infer<S> {
  if (exchange.status < 200 || exchange.status > 299) {
    throw new TransportUnavailableError(
      "http",
      "The seller backend answered " + exchange.status + " for " + label + ".",
      exchange.status,
    );
  }
  const parsed = schema.safeParse(exchange.body);
  if (!parsed.success) {
    throw new TransportUnavailableError(
      "invalid_response",
      "The seller backend returned an unexpected " + label + " body.",
      exchange.status,
    );
  }
  return parsed.data;
}

/**
 * Maps a refusal body to the typed rejection the UI handles. Returns null for any code the client does not model,
 * so those stay transport failures. The codes are the backend's STOREFRONT_ERROR_CODES. The product codes carry
 * the product id at the top level of the envelope.
 */
export function toOrderRejection(body: unknown): OrderRejection | null {
  const parsed = WireRefusal.safeParse(body);
  if (!parsed.success) return null;
  const { code, message } = parsed.data.error;
  const { productId, retryAfterSeconds, field } = parsed.data;
  switch (code) {
    case "EMPTY_ORDER":
      return { code: "empty_order" };
    case "INVALID_QUANTITY":
      return { code: "invalid_quantity", productId };
    case "UNKNOWN_PRODUCT":
      return { code: "unknown_product", productId };
    case "PRODUCT_UNAVAILABLE":
      return { code: "product_unavailable", productId };
    case "VARIANT_REQUIRED":
      return { code: "variant_required", productId };
    case "UNKNOWN_VARIANT":
      return { code: "unknown_variant", productId };
    case "OUT_OF_STOCK":
      return { code: "out_of_stock", productId };
    case "PAYMENT_METHOD_UNAVAILABLE":
      return { code: "payment_method_unavailable" };
    case "IDEMPOTENCY_CONFLICT":
      return { code: "idempotency_conflict" };
    case "RATE_LIMITED":
      return { code: "rate_limited", retryAfterSeconds: retryAfterSeconds ?? null };
    case "INVALID_REQUEST":
      return { code: "invalid_request", message: message ?? "Invalid request.", ...(field === undefined ? {} : { field }) };
    case "STORE_NOT_ACTIVE":
      return { code: "store_inactive" };
    // Reads as an invalid request, whose message every theme already shows, so no theme needs a new case.
    case "PREVIEW_ORDER_BLOCKED":
      return { code: "invalid_request", message: message ?? "This is a preview, so no order was placed." };
    default:
      return null;
  }
}

/**
 * Throws OrderRejectedError when a non-2xx body is a refusal the client models. Anything else returns, and the
 * caller's unwrap turns the non-2xx status into a TransportUnavailableError.
 */
function throwIfRefused(result: Exchange): void {
  if (result.status >= 200 && result.status <= 299) return;
  const rejection = toOrderRejection(result.body);
  if (rejection) throw new OrderRejectedError(rejection);
}

/**
 * One HTTP exchanger. The seller backend and the BFF speak the same envelope, so both use this. The client IP is
 * forwarded only when the caller sets one; a browser never does.
 */
function makeExchanger(options: {
  base: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  clientIp?: string | null;
  previewToken?: string | null;
}): Exchanger {
  const forwarded: Record<string, string> =
    options.clientIp && options.clientIp !== "unknown" ? { "x-forwarded-for": options.clientIp } : {};
  if (options.previewToken) forwarded[PREVIEW_CREDENTIAL_HEADER] = options.previewToken;

  return async (method, path, request) => {
    const attempts = request.retry ? 2 : 1;
    const caching: RequestInit & { next?: { revalidate: number; tags: string[] } } =
      request.cached && !options.previewToken
        ? { next: { revalidate: request.cached.revalidateSeconds, tags: request.cached.tags } }
        : { cache: "no-store" };
    let lastError: unknown = undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await options.fetchImpl(options.base + path, {
          method,
          headers: {
            accept: "application/json",
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            ...forwarded,
            ...request.headers,
          },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs),
          ...caching,
        });
        const body: unknown = await response.json().catch(() => undefined);
        return { status: response.status, body };
      } catch (error) {
        lastError = error;
      }
    }
    throw toTransportError(lastError);
  };
}

/**
 * The order operations, over any exchanger. The paths are the same on the seller backend (under a store) and on the
 * BFF (under /api/storefront), so one implementation serves both, and the error mapping cannot drift between them.
 */
function makeOrderTransport(exchange: Exchanger, requireHttp: () => void, submitTimeoutMs: number): OrderTransport {
  return {
    async quoteCart(input: CartQuoteInput): Promise<CartQuote> {
      requireHttp();
      const result = await exchange("POST", "/cart/quote", { body: { lines: input.lines }, retry: true });
      throwIfRefused(result);
      return unwrap(result, WireCartQuoteEnvelope, "cart quote").data;
    },

    async submitOrder(payload: SubmitOrderPayload): Promise<SubmitOrderResult> {
      requireHttp();
      const result = await exchange("POST", "/orders", {
        body: { customer: payload.customer, lines: payload.lines },
        headers: { "idempotency-key": payload.idempotencyKey },
        retry: false,
        timeoutMs: submitTimeoutMs,
      });
      // A gateway error with no body, or the BFF saying the backend never answered: the order may have been saved.
      if (result.status >= 500 && (result.body === undefined || errorCode(result.body) === ORDER_OUTCOME_UNKNOWN_CODE)) {
        throw new TransportUnavailableError("network", "The order placement got no clear answer.", result.status);
      }
      throwIfRefused(result);
      return unwrap(result, WireOrderCreated, "order").data;
    },

    async lookupOrder(input: OrderLookupInput): Promise<StorefrontOrder | null> {
      requireHttp();
      const result = await exchange("POST", "/orders/lookup", {
        body: { orderId: input.orderId, phone: input.phone },
        retry: true,
      });
      if (result.status === 404 && errorCode(result.body) === "ORDER_NOT_FOUND") return null;
      throwIfRefused(result);
      return unwrap(result, WireOrderLookup, "order lookup").data;
    },

    async trackOrder(input: OrderLookupInput): Promise<StorefrontOrderTracking | null> {
      requireHttp();
      const result = await exchange("POST", "/orders/track", {
        body: { orderId: input.orderId, phone: input.phone },
        retry: true,
      });
      if (result.status === 404 && errorCode(result.body) === "ORDER_NOT_FOUND") return null;
      throwIfRefused(result);
      return unwrap(result, WireOrderTrackingEnvelope, "order tracking").data;
    },

    async getProductsByIds(ids: string[]): Promise<StorefrontProductSummary[]> {
      requireHttp();
      if (ids.length === 0) return [];
      const result = await exchange("GET", "/products?ids=" + ids.map(encodeURIComponent).join(","), { retry: true });
      throwIfRefused(result);
      return unwrap(result, WireProductList, "product list").data;
    },
  };
}

/**
 * Creates a transport bound to one store on the seller backend. Server-side only: it holds the backend origin.
 *
 * Endpoints (under /api/storefront/v1/stores/:storeId):
 *   GET  /products              product list (first page)
 *   GET  /products/:slug        product detail; 404 PRODUCT_NOT_FOUND becomes null
 *   POST /cart/quote            price a cart without moving stock
 *   POST /orders                create order, with an Idempotency-Key header; refusals become OrderRejectedError
 *   POST /orders/lookup         the shopper's order by id and phone; 404 ORDER_NOT_FOUND becomes null
 *   POST /orders/track          customer tracking by id and phone (journey only); 404 ORDER_NOT_FOUND becomes null
 *   GET  /products?ids=         the Live products among these ids
 *
 * Reads retry once, and only when fetch itself fails. HTTP responses are never retried. Writes are never retried
 * automatically: the caller retries with the same idempotency key.
 */
export function createRemoteTransport(options: RemoteTransportOptions): StorefrontTransport {
  const mode: RemoteMode = options.mode ?? "http";
  const storeBase =
    normalizeBaseUrl(options.baseUrl) + STOREFRONT_API_PREFIX + "/stores/" + encodeURIComponent(options.storeId);
  const exchange = makeExchanger({
    base: storeBase,
    timeoutMs: options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? defaultFetch,
    clientIp: options.clientIp,
    previewToken: options.previewToken,
  });

  const requireHttp = (): void => {
    if (mode === "stub") {
      throw new TransportUnavailableError(
        "not_implemented",
        "The remote transport is in stub mode (STOREFRONT_REMOTE_MODE=stub), so the seller backend was not called. Unset it to use http.",
      );
    }
  };

  const orders = makeOrderTransport(exchange, requireHttp, options.submitTimeoutMs ?? DEFAULT_SUBMIT_REMOTE_TIMEOUT_MS);

  const { storeId } = options;
  const productListTags = [storeTags.products(storeId), storeTags.static(storeId)];
  const catalogRead = (tags: string[], revalidateSeconds = CATALOG_REVALIDATE_SECONDS) => ({ retry: true, cached: { tags, revalidateSeconds } });

  return {
    kind: "remote",
    quoteCart: orders.quoteCart,
    submitOrder: orders.submitOrder,
    lookupOrder: orders.lookupOrder,
    trackOrder: orders.trackOrder,
    getProductsByIds: orders.getProductsByIds,

    async getProducts(): Promise<StorefrontProductSummary[]> {
      requireHttp();
      const result = await exchange("GET", "/products", catalogRead(productListTags));
      return unwrap(result, WireProductList, "product list").data;
    },

    async listCategories(): Promise<StorefrontCategory[]> {
      requireHttp();
      const result = await exchange("GET", "/categories", catalogRead([storeTags.categories(storeId), ...productListTags]));
      return unwrap(result, WireCategoryList, "category list").data;
    },

    async listProducts(query: ProductQuery = {}): Promise<ProductListPage> {
      requireHttp();
      const params = new URLSearchParams();
      if (query.category) params.set("category", query.category);
      if (query.q) params.set("q", query.q);
      if (query.sort) params.set("sort", query.sort);
      if (query.page) params.set("page", String(query.page));
      if (query.limit) params.set("limit", String(query.limit));
      const qs = params.toString();
      const read = catalogRead(productListTags, query.q ? SEARCH_REVALIDATE_SECONDS : CATALOG_REVALIDATE_SECONDS);
      const result = await exchange("GET", "/products" + (qs ? "?" + qs : ""), read);
      const list = unwrap(result, WireProductList, "product list");
      return { items: list.data, page: list.page, totalPages: list.totalPages };
    },

    async getProduct(slug: string): Promise<StorefrontProductDetail | null> {
      requireHttp();
      // The delivery charge on a product page falls back to the store's rate, so a settings change must drop it too.
      const tags = [storeTags.product(storeId, slug), storeTags.settings(storeId), ...productListTags];
      const result = await exchange("GET", "/products/" + encodeURIComponent(slug), catalogRead(tags));
      if (result.status === 404 && errorCode(result.body) === "PRODUCT_NOT_FOUND") return null;
      return unwrap(result, WireProductDetailEnvelope, "product").data;
    },
  };
}

/**
 * Creates the browser's order client. It calls the same-origin BFF, never the seller backend, so it holds no address
 * or secret. The BFF takes the store from the host, not from anything this client sends.
 */
export function createBffTransport(options: BffTransportOptions = {}): OrderTransport {
  const exchange = makeExchanger({
    base: normalizeBaseUrl(options.basePath ?? BFF_BASE_PATH),
    timeoutMs: options.timeoutMs ?? DEFAULT_BFF_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? defaultFetch,
  });
  return makeOrderTransport(exchange, () => undefined, options.submitTimeoutMs ?? DEFAULT_SUBMIT_BFF_TIMEOUT_MS);
}
/* @theme-integration-patch:remote */
