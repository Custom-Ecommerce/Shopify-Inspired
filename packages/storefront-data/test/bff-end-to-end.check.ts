/*
 * End-to-end checks for the storefront BFF. The browser client, the BFF handlers and the seller backend's envelope all run
 * in one process: the browser's fetch is routed to the BFF, and the BFF's calls to the backend are routed to a fake seller
 * backend that answers with the backend's real envelope shapes. No network and no Next.js. From packages/storefront-data run:
 *
 *   npx tsx test/bff-end-to-end.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes, rejectionToEnvelope } from "../src/bff/handlers";
import type { BffStoreLookup } from "../src/bff/handlers";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import { OrderRejectedError, TransportUnavailableError } from "../src/transport/errors";
import { createBffTransport, createRemoteTransport, toOrderRejection } from "../src/transport/remote";
import type { OrderRejection } from "../src/transport/types";

const SITE = "http://mustafa.localhost:3000";
const BACKEND = "http://seller.test";
const STORE_ID = "65a000000000000000000001";
const PRODUCT_ID = "65a0000000000000000000aa";
const VARIANT_ID = "65a0000000000000000000bb";
const SHOPPER_IP = "203.0.113.7";
const KEY = "checkout-key-0001";
const PHONE = "+923001234567";

interface BackendCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The fake seller backend: records each call and answers with whatever the test set next. */
const backend: { calls: BackendCall[]; next: { status: number; body: unknown } | "down" } = { calls: [], next: { status: 200, body: {} } };

const backendFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  backend.calls.push({
    method: String(init?.method),
    path: url.pathname,
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  });
  if (backend.next === "down") throw new TypeError("fetch failed");
  return new Response(JSON.stringify(backend.next.body), {
    status: backend.next.status,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

/** The store the BFF resolves for a tenant key. The test changes storeState to simulate a closed or broken store. */
let storeState: "active" | "inactive" | "error" = "active";
const lookupStore = async (tenantKey: string, clientIp: string | null): Promise<BffStoreLookup> => {
  if (tenantKey !== "mustafa") return { outcome: "not-found" };
  if (storeState === "inactive") return { outcome: "inactive", status: "suspended" };
  if (storeState === "error") return { outcome: "error" };
  return {
    outcome: "ok",
    transport: createRemoteTransport({ baseUrl: BACKEND, storeId: STORE_ID, fetchImpl: backendFetch, clientIp }),
  };
};

const bff = createBffRoutes({ lookupStore });

/** The browser's view: the store host it is on, and the tenant the edge would have set for that host. */
const browser: { origin: string | null; tenantKey: string | null } = { origin: SITE, tenantKey: "mustafa" };

/** Routes the browser client's fetch to the BFF, the way a same-origin request reaches the storefront server. */
const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input);
  const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
  headers.set("x-forwarded-host", "mustafa.localhost:3000");
  if (browser.origin !== null) headers.set("origin", browser.origin);
  const request = new Request(SITE + path, {
    method: String(init?.method),
    headers,
    body: init?.body === undefined ? undefined : String(init.body),
  });
  const context = { tenantKey: browser.tenantKey, clientIp: SHOPPER_IP };
  if (path.endsWith("/cart/quote")) return bff.quote(request, context);
  if (path.endsWith("/orders/lookup")) return bff.lookup(request, context);
  return bff.submit(request, context);
}) as typeof fetch;

const client = createBffTransport({ basePath: "/api/storefront", fetchImpl: browserFetch });

const customer = { customerName: "Ali Raza", phone: PHONE, address: "House 1, Street 2", city: "Karachi" };
const lines = [{ productId: PRODUCT_ID, qty: 2 }];

const orderBody = {
  data: {
    orderId: "ORD-7KQ4M2XA",
    status: "pending",
    paymentMethod: "cod",
    subtotal: 2000,
    deliveryCharges: 200,
    total: 2200,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    customerName: "Ali Raza",
    phone: PHONE,
    city: null,
    address: "House 1, Street 2, Karachi",
    items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, title: "Cotton Kurta", variantTitle: "Default", unitPrice: 1000, qty: 2, lineTotal: 2000 }],
  },
};

const quoteBody = {
  data: {
    lines: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, title: "Cotton Kurta", variantTitle: "Default", unitPrice: 1000, qty: 2, lineTotal: 2000, issue: null, availableQty: 10 }],
    subtotal: 2000,
    deliveryCharges: 200,
    total: 2200,
    canCheckout: true,
  },
};

const checks: { name: string; run: () => Promise<void> }[] = [];
function check(name: string, run: () => Promise<void>): void {
  checks.push({ name, run });
}

/** Resets the fake backend and the browser before each check that needs a clean slate. */
function reset(): void {
  backend.calls = [];
  backend.next = { status: 200, body: {} };
  storeState = "active";
  browser.origin = SITE;
  browser.tenantKey = "mustafa";
}

check("cart quote travels browser -> BFF -> backend, and the shopper's IP reaches the backend", async () => {
  reset();
  backend.next = { status: 200, body: quoteBody };
  const quote = await client.quoteCart({ lines });
  assert.equal(quote.total, 2200);
  assert.equal(quote.canCheckout, true);
  const [call] = backend.calls;
  assert.equal(call.path, "/api/storefront/v1/stores/" + STORE_ID + "/cart/quote");
  assert.equal(call.headers["x-forwarded-for"], SHOPPER_IP);
  assert.deepEqual(call.body, { lines });
});

check("an order travels end to end, carrying the idempotency key and no prices", async () => {
  reset();
  backend.next = { status: 201, body: orderBody };
  const placed = await client.submitOrder({ idempotencyKey: KEY, customer, lines });
  assert.deepEqual(placed, { orderId: "ORD-7KQ4M2XA", total: 2200 });
  const [call] = backend.calls;
  assert.equal(call.path, "/api/storefront/v1/stores/" + STORE_ID + "/orders");
  assert.equal(call.headers["idempotency-key"], KEY);
  assert.deepEqual(call.body, { customer: { ...customer, email: null, note: null }, lines });
});

check("an out-of-stock refusal reaches the checkout with the product named", async () => {
  reset();
  backend.next = {
    status: 409,
    body: { error: { code: "OUT_OF_STOCK", message: "A product in the order is out of stock." }, productId: PRODUCT_ID },
  };
  let caught: unknown = null;
  try {
    await client.submitOrder({ idempotencyKey: KEY, customer, lines });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof OrderRejectedError, "expected OrderRejectedError");
  assert.deepEqual(caught.rejection, { code: "out_of_stock", productId: PRODUCT_ID });
  assert.deepEqual(toCheckoutFailure(caught, [{ productId: PRODUCT_ID, title: "Cotton Kurta" }]), {
    kind: "out_of_stock",
    productId: PRODUCT_ID,
    productTitle: "Cotton Kurta",
  });
});

check("every refusal code the backend sends arrives as the same typed rejection", async () => {
  const cases: Array<{ status: number; body: unknown; expected: OrderRejection }> = [
    { status: 400, body: { error: { code: "EMPTY_ORDER", message: "The order has no items." } }, expected: { code: "empty_order" } },
    {
      status: 400,
      body: { error: { code: "INVALID_QUANTITY", message: "Quantity must be a whole number from 1 to 99." }, productId: PRODUCT_ID },
      expected: { code: "invalid_quantity", productId: PRODUCT_ID },
    },
    {
      status: 422,
      body: { error: { code: "UNKNOWN_PRODUCT", message: "A product in the order is not available." }, productId: PRODUCT_ID },
      expected: { code: "unknown_product", productId: PRODUCT_ID },
    },
    {
      status: 400,
      body: { error: { code: "PAYMENT_METHOD_UNAVAILABLE", message: "Cash on delivery is not available for this store." } },
      expected: { code: "payment_method_unavailable" },
    },
    {
      status: 409,
      body: { error: { code: "IDEMPOTENCY_CONFLICT", message: "This Idempotency-Key was already used for a different order." } },
      expected: { code: "idempotency_conflict" },
    },
    {
      status: 429,
      body: { error: { code: "RATE_LIMITED", message: "Too many requests." }, retryAfterSeconds: 12 },
      expected: { code: "rate_limited", retryAfterSeconds: 12 },
    },
    {
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: "customer.phone: enter a valid Pakistani mobile number." } },
      expected: { code: "invalid_request", message: "customer.phone: enter a valid Pakistani mobile number." },
    },
    {
      status: 403,
      body: { error: { code: "STORE_NOT_ACTIVE", message: "This store is not available." }, status: "suspended" },
      expected: { code: "store_inactive" },
    },
  ];
  for (const testCase of cases) {
    reset();
    backend.next = { status: testCase.status, body: testCase.body };
    await assert.rejects(client.submitOrder({ idempotencyKey: KEY, customer, lines }), (error) => {
      assert.ok(error instanceof OrderRejectedError, "expected OrderRejectedError for " + JSON.stringify(testCase.expected));
      assert.deepEqual(JSON.parse(JSON.stringify(error.rejection)), JSON.parse(JSON.stringify(testCase.expected)));
      return true;
    });
  }
});

check("an order lookup returns the order, and an unknown order is null, not an error", async () => {
  reset();
  backend.next = { status: 200, body: orderBody };
  const order = await client.lookupOrder({ orderId: "ORD-7KQ4M2XA", phone: PHONE });
  assert.equal(order?.orderId, "ORD-7KQ4M2XA");
  assert.equal(order?.items[0].lineTotal, 2000);
  assert.equal(backend.calls[0].path, "/api/storefront/v1/stores/" + STORE_ID + "/orders/lookup");

  backend.next = { status: 404, body: { error: { code: "ORDER_NOT_FOUND", message: "No order matches those details." } } };
  assert.equal(await client.lookupOrder({ orderId: "ORD-NOPE0000", phone: PHONE }), null);
});

check("a store that is not active is refused with STORE_NOT_ACTIVE", async () => {
  reset();
  storeState = "inactive";
  await assert.rejects(client.submitOrder({ idempotencyKey: KEY, customer, lines }), (error) => {
    return error instanceof OrderRejectedError && error.rejection.code === "store_inactive";
  });
  assert.equal(backend.calls.length, 0, "the backend must not be called for an inactive store");
});

check("an unknown tenant and a host that is not a store are both 404 STORE_NOT_FOUND", async () => {
  reset();
  browser.tenantKey = "nobody";
  await assert.rejects(client.quoteCart({ lines }), (error) => {
    return error instanceof TransportUnavailableError && error.reason === "http" && error.upstreamStatus === 404;
  });
  browser.tenantKey = null;
  await assert.rejects(client.quoteCart({ lines }), (error) => {
    return error instanceof TransportUnavailableError && error.upstreamStatus === 404;
  });
  assert.equal(backend.calls.length, 0);
});

check("a broken store lookup and an unreachable backend are both unavailable to the browser", async () => {
  reset();
  storeState = "error";
  await assert.rejects(client.quoteCart({ lines }), (error) => {
    return error instanceof TransportUnavailableError && error.reason === "http" && error.upstreamStatus === 503;
  });
  reset();
  backend.next = "down";
  // CO-03: a backend that never answered a placement is "outcome unknown", so the checkout re-checks instead of saying failed.
  await assert.rejects(client.submitOrder({ idempotencyKey: KEY, customer, lines }), (error) => {
    return error instanceof TransportUnavailableError && error.reason === "network" && error.upstreamStatus === 504;
  });
});

check("a cross-site request is refused before anything reaches the backend", async () => {
  reset();
  browser.origin = "https://evil.example";
  await assert.rejects(client.submitOrder({ idempotencyKey: KEY, customer, lines }), (error) => {
    return error instanceof TransportUnavailableError && error.upstreamStatus === 403;
  });
  assert.equal(backend.calls.length, 0);
});

check("the same-origin gate needs an Origin, and refuses a request the browser marks cross-site", async () => {
  reset();
  const noOrigin = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": KEY },
    body: JSON.stringify({ customer, lines }),
  });
  const refused = await bff.submit(noOrigin, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, "FORBIDDEN_ORIGIN");

  const crossSite = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE,
      "sec-fetch-site": "cross-site",
      "x-forwarded-host": "mustafa.localhost:3000",
      "idempotency-key": KEY,
    },
    body: JSON.stringify({ customer, lines }),
  });
  assert.equal((await bff.submit(crossSite, { tenantKey: "mustafa", clientIp: SHOPPER_IP })).status, 403);
  assert.equal(backend.calls.length, 0);
});

check("a request that is not JSON, or has no idempotency key, is refused before the backend", async () => {
  reset();
  const notJson = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": KEY },
    body: JSON.stringify({ customer, lines }),
  });
  const wrongType = await bff.submit(notJson, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal(wrongType.status, 400);
  assert.equal((await wrongType.json()).error.code, "INVALID_REQUEST");

  const noKey = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000" },
    body: JSON.stringify({ customer, lines }),
  });
  const missing = await bff.submit(noKey, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.message, "An Idempotency-Key header is required.");
  assert.equal(backend.calls.length, 0);
});

check("a malformed or oversized body is refused before the backend, with a message the shopper can act on", async () => {
  reset();
  const headers = { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": KEY };
  const broken = new Request(SITE + "/api/storefront/orders", { method: "POST", headers, body: "{not json" });
  const brokenResponse = await bff.submit(broken, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal((await brokenResponse.json()).error.message, "Request body must be valid JSON.");

  const huge = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers,
    body: JSON.stringify({ customer, lines, note: "x".repeat(40 * 1024) }),
  });
  const hugeResponse = await bff.submit(huge, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal((await hugeResponse.json()).error.message, "Request body is too large.");

  const shortName = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers,
    body: JSON.stringify({ customer: { ...customer, customerName: "A" }, lines }),
  });
  const shapeResponse = await bff.submit(shortName, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal(shapeResponse.status, 400);
  assert.ok((await shapeResponse.json()).error.message.startsWith("customer.customerName:"));
  assert.equal(backend.calls.length, 0);
});

check("the browser never receives the backend's address", async () => {
  reset();
  backend.next = { status: 409, body: { error: { code: "OUT_OF_STOCK", message: "A product in the order is out of stock." }, productId: PRODUCT_ID } };
  const request = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": KEY },
    body: JSON.stringify({ customer, lines }),
  });
  const response = await bff.submit(request, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  const text = await response.text();
  assert.equal(text.includes("seller.test"), false);
  assert.equal(text.includes("/api/storefront/v1"), false);
});

check("a rate-limited refusal keeps its Retry-After header for the browser", async () => {
  reset();
  backend.next = { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests." }, retryAfterSeconds: 12 } };
  const request = new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": KEY },
    body: JSON.stringify({ customer, lines }),
  });
  const response = await bff.submit(request, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "12");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

check("the BFF's refusal table and the client's reader are exact inverses", async () => {
  const rejections: OrderRejection[] = [
    { code: "empty_order" },
    { code: "invalid_quantity", productId: PRODUCT_ID },
    { code: "unknown_product", productId: PRODUCT_ID },
    { code: "out_of_stock", productId: PRODUCT_ID },
    { code: "out_of_stock" },
    { code: "payment_method_unavailable" },
    { code: "idempotency_conflict" },
    { code: "rate_limited", retryAfterSeconds: 9 },
    { code: "rate_limited", retryAfterSeconds: null },
    { code: "invalid_request", message: "customer.phone: enter a valid Pakistani mobile number." },
    { code: "store_inactive" },
  ];
  for (const rejection of rejections) {
    const envelope = rejectionToEnvelope(rejection);
    const body = { error: { code: envelope.code, message: envelope.message }, ...envelope.extra };
    assert.deepEqual(
      JSON.parse(JSON.stringify(toOrderRejection(body))),
      JSON.parse(JSON.stringify(rejection)),
      "round trip failed for " + rejection.code,
    );
  }
});

check("an unexpected failure inside the BFF is a 500 with no detail", async () => {
  const broken = createBffRoutes({
    lookupStore: async () => ({
      outcome: "ok",
      transport: {
        quoteCart: async () => {
          throw new Error("secret stack detail");
        },
        submitOrder: async () => {
          throw new Error("secret stack detail");
        },
        lookupOrder: async () => null,
      },
    }),
  });
  const request = new Request(SITE + "/api/storefront/cart/quote", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000" },
    body: JSON.stringify({ lines }),
  });
  const response = await broken.quote(request, { tenantKey: "mustafa", clientIp: SHOPPER_IP });
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.equal(text.includes("secret stack detail"), false);
});

async function main(): Promise<void> {
  let failed = 0;
  for (const { name, run } of checks) {
    try {
      await run();
      console.log("ok    " + name);
    } catch (error) {
      failed += 1;
      console.error("FAIL  " + name);
      console.error(error);
    }
  }
  console.log(checks.length - failed + "/" + checks.length + " checks passed");
  if (failed > 0) process.exitCode = 1;
}

void main();
