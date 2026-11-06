import { z } from "zod";
import { MAX_LINE_QTY } from "../domain/cart";
import { OrderRejectedError, TransportUnavailableError } from "../transport/errors";
import type { OrderRejection, OrderTransport } from "../transport/types";

/*
 * The BFF: the same-origin endpoints a storefront's browser code calls. They run on the storefront server, so the seller
 * backend's address and everything server-side stay out of the browser. This file is the logic only and imports
 * nothing from Next.js: the route files under apps/storefront/app/api/storefront are thin wrappers around createBffRoutes.
 *
 * Every request passes the same gates, in order: same origin, JSON body, a known store, an idempotency key where one is
 * needed, a bounded body, and a valid shape. Money is never read from the browser. The seller backend prices every
 * quote and order itself.
 */

/** The store behind a tenant key, as the BFF needs it. Built by the app from the store resolver; never from the body. */
export type BffStoreLookup =
  | { outcome: "ok"; transport: OrderTransport }
  | { outcome: "not-found" }
  | { outcome: "inactive"; status: string }
  | { outcome: "error" };

export interface BffRouteContext {
  /** The tenant label that middleware sets (x-markaz-tenant) for a store host. Null for any other host. */
  tenantKey: string | null;
  /** The shopper's IP as the edge proxy reports it. Forwarded to the backend for its per-client limits. */
  clientIp: string | null;
}

export interface BffDeps {
  /** Resolves the store behind a tenant key. Supplied by the app; this module never reads the environment. */
  lookupStore(tenantKey: string, clientIp: string | null): Promise<BffStoreLookup>;
}

export interface BffRoutes {
  quote(request: Request, context: BffRouteContext): Promise<Response>;
  submit(request: Request, context: BffRouteContext): Promise<Response>;
  lookup(request: Request, context: BffRouteContext): Promise<Response>;
}

/** A real checkout is a few hundred bytes. Anything past this is not one. Matches the backend's cap. */
export const BFF_MAX_BODY_BYTES = 32 * 1024;

/** Matches STOREFRONT_IDEMPOTENCY_KEY_PATTERN in @markaz/contracts. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const NO_STORE = { "Cache-Control": "no-store" } as const;

const lineSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  qty: z.number(),
});

const quoteBody = z.object({
  lines: z.array(lineSchema).max(50),
});

const submitBody = z.object({
  customer: z.object({
    customerName: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(1).max(32),
    address: z.string().trim().min(10).max(300),
  }),
  lines: z.array(lineSchema).max(50),
});

const lookupBody = z.object({
  orderId: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(32),
});

/** The browser gets one shape for every refusal: { error: { code, message }, ...extra }, as the backend sends it. */
function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE, ...extraHeaders },
  });
}

function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  const headers: Record<string, string> = {};
  const retryAfter = extra.retryAfterSeconds;
  if (typeof retryAfter === "number") headers["retry-after"] = String(Math.max(1, Math.ceil(retryAfter)));
  return jsonResponse(status, { error: { code, message }, ...extra }, headers);
}

function withProduct(productId: string | undefined): Record<string, unknown> {
  return productId === undefined ? {} : { productId };
}

/**
 * The HTTP status, code, message and extra fields for a refusal. Mirrors the seller backend's table, so the browser reads
 * the same codes whether the order came from a server page or the BFF. toOrderRejection in remote.ts is the inverse.
 */
export function rejectionToEnvelope(rejection: OrderRejection): {
  status: number;
  code: string;
  message: string;
  extra: Record<string, unknown>;
} {
  switch (rejection.code) {
    case "empty_order":
      return { status: 400, code: "EMPTY_ORDER", message: "The order has no items.", extra: {} };
    case "invalid_quantity":
      return {
        status: 400,
        code: "INVALID_QUANTITY",
        message: "Quantity must be a whole number from 1 to " + MAX_LINE_QTY + ".",
        extra: withProduct(rejection.productId),
      };
    case "unknown_product":
      return {
        status: 422,
        code: "UNKNOWN_PRODUCT",
        message: "A product in the order is not available.",
        extra: withProduct(rejection.productId),
      };
    case "out_of_stock":
      return {
        status: 409,
        code: "OUT_OF_STOCK",
        message: "A product in the order is out of stock.",
        extra: withProduct(rejection.productId),
      };
    case "payment_method_unavailable":
      return {
        status: 400,
        code: "PAYMENT_METHOD_UNAVAILABLE",
        message: "This payment method is not available for this store.",
        extra: {},
      };
    case "idempotency_conflict":
      return {
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message: "This Idempotency-Key was already used for a different order. Start a new checkout.",
        extra: {},
      };
    case "rate_limited":
      return {
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment and try again.",
        extra: rejection.retryAfterSeconds === null ? {} : { retryAfterSeconds: rejection.retryAfterSeconds },
      };
    case "invalid_request":
      return { status: 400, code: "INVALID_REQUEST", message: rejection.message, extra: {} };
    case "store_inactive":
      return { status: 403, code: "STORE_NOT_ACTIVE", message: "This store is not available.", extra: {} };
    default: {
      const unhandled: never = rejection;
      void unhandled;
      return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error", extra: {} };
    }
  }
}

/**
 * Same-origin check. The Origin must name the host the request was made to, and a request the browser marks
 * cross-site is refused outright. Without this, a page on another site could post orders with a shopper's cookies.
 */
export function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const path = issue.path.map(String).join(".");
  return path ? path + ": " + issue.message : issue.message;
}

type ReadBody = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads a JSON body with a size cap. Malformed JSON is a 400, never a 500. */
async function readJson(request: Request): Promise<ReadBody> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > BFF_MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(400, "INVALID_REQUEST", "Request body is too large.") };
  }
  const raw = await request.text();
  if (raw.length > BFF_MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(400, "INVALID_REQUEST", "Request body is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: errorResponse(400, "INVALID_REQUEST", "Request body must be valid JSON.") };
  }
}

type Outcome =
  | { kind: "data"; status: number; data: unknown }
  | { kind: "error"; status: number; code: string; message: string };

/** The shared pipeline. Each route supplies its schema, whether it needs an idempotency key, and what to call. */
async function handle<T>(
  request: Request,
  context: BffRouteContext,
  schema: z.ZodType<T>,
  deps: BffDeps,
  options: { needsIdempotencyKey: boolean },
  run: (transport: OrderTransport, input: T, idempotencyKey: string) => Promise<Outcome>,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return errorResponse(403, "FORBIDDEN_ORIGIN", "This request must come from the store's own pages.");
  }
  if (!isJson(request)) return errorResponse(400, "INVALID_REQUEST", "Content-Type must be application/json.");
  if (context.tenantKey === null) return errorResponse(404, "STORE_NOT_FOUND", "Store not found.");

  let idempotencyKey = "";
  if (options.needsIdempotencyKey) {
    idempotencyKey = (request.headers.get("idempotency-key") ?? "").trim();
    if (idempotencyKey === "") return errorResponse(400, "INVALID_REQUEST", "An Idempotency-Key header is required.");
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Idempotency-Key must be 8 to 128 characters: letters, digits, dash, underscore.",
      );
    }
  }

  const lookup = await deps.lookupStore(context.tenantKey, context.clientIp);
  if (lookup.outcome === "not-found") return errorResponse(404, "STORE_NOT_FOUND", "Store not found.");
  if (lookup.outcome === "inactive") return errorResponse(403, "STORE_NOT_ACTIVE", "This store is not available.");
  if (lookup.outcome === "error") {
    return errorResponse(503, "STOREFRONT_UNAVAILABLE", "Storefront data is temporarily unavailable.");
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return errorResponse(400, "INVALID_REQUEST", firstIssue(parsed.error));

  try {
    const outcome = await run(lookup.transport, parsed.data, idempotencyKey);
    if (outcome.kind === "data") return jsonResponse(outcome.status, { data: outcome.data });
    return errorResponse(outcome.status, outcome.code, outcome.message);
  } catch (error) {
    if (error instanceof OrderRejectedError) {
      const envelope = rejectionToEnvelope(error.rejection);
      return errorResponse(envelope.status, envelope.code, envelope.message, envelope.extra);
    }
    if (error instanceof TransportUnavailableError) {
      return errorResponse(503, "STOREFRONT_UNAVAILABLE", "Storefront data is temporarily unavailable.");
    }
    console.error("[storefront-bff] unhandled error", error);
    return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
  }
}

export function createBffRoutes(deps: BffDeps): BffRoutes {
  return {
    quote: (request, context) =>
      handle(request, context, quoteBody, deps, { needsIdempotencyKey: false }, async (transport, input) => ({
        kind: "data",
        status: 200,
        data: await transport.quoteCart({ lines: input.lines }),
      })),

    submit: (request, context) =>
      handle(request, context, submitBody, deps, { needsIdempotencyKey: true }, async (transport, input, key) => ({
        kind: "data",
        status: 201,
        data: await transport.submitOrder({ idempotencyKey: key, customer: input.customer, lines: input.lines }),
      })),

    lookup: (request, context) =>
      handle(request, context, lookupBody, deps, { needsIdempotencyKey: false }, async (transport, input) => {
        const order = await transport.lookupOrder({ orderId: input.orderId, phone: input.phone });
        if (order === null) {
          return { kind: "error", status: 404, code: "ORDER_NOT_FOUND", message: "No order matches those details." };
        }
        return { kind: "data", status: 200, data: order };
      }),
  };
}
