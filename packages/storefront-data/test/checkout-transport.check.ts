/*
 * Checks for the order path: the remote transport's refusal mapping, order lookup, the mock's round trip, and
 * the failure inputs the checkout page renders. No test runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/checkout-transport.check.ts
 *
 * Exits non-zero on the first failing check. Response bodies are shaped like the seller backend's responses.
 */
import assert from "node:assert/strict";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import { mockTransport } from "../src/transport/mock";
import { OrderRejectedError, TransportUnavailableError } from "../src/transport/errors";
import { createRemoteTransport, toOrderRejection } from "../src/transport/remote";
import type { OrderRejection, SubmitOrderPayload } from "../src/transport/types";

const BASE = "http://seller.test";
const STORE_ID = "65a000000000000000000001";
const PRODUCT_ID = "65a0000000000000000000aa";
const PHONE = "+923001234567";

const payload: SubmitOrderPayload = {
  idempotencyKey: "checkout-key-0001",
  customer: { customerName: "Ali Raza", phone: PHONE, address: "House 1, Street 2, Karachi" },
  lines: [{ productId: PRODUCT_ID, qty: 2 }],
};

const orderBody = {
  data: {
    orderId: "ORD-1",
    status: "pending",
    paymentMethod: "cod",
    subtotal: 2000,
    deliveryCharges: 0,
    total: 2000,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    customerName: "Ali Raza",
    phone: PHONE,
    city: null,
    address: "House 1, Street 2, Karachi",
    items: [{ productId: PRODUCT_ID, variantId: "v1", title: "Cotton Kurta", variantTitle: "Default", unitPrice: 1000, qty: 2, lineTotal: 2000 }],
  },
};

const productBody = {
  data: {
    id: PRODUCT_ID,
    slug: "cotton-kurta",
    title: "Cotton Kurta",
    currency: "PKR",
    price: 1000,
    compareAtPrice: null,
    stockStatus: "in_stock",
    defaultVariantId: "v1",
    hasVariants: false,
    options: [],
    variants: [
      { id: "v1", title: "Default", price: 1000, compareAtPrice: null, availability: "in_stock", optionValues: [], imageId: null },
    ],
    primaryImage: null,
    categories: [],
    avgRating: 0,
    reviewCount: 0,
    description: null,
    highlights: [],
    images: [],
    seo: { title: null, description: null, imageUrl: null },
    tags: [],
    categorySlugs: [],
    deliveryCharge: 0,
  },
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch stand-in that answers with one canned response and records each request. */
function recordingFetch(status: number, body: unknown, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function remote(fetchImpl: typeof fetch, mode: "http" | "stub" = "http") {
  return createRemoteTransport({ baseUrl: BASE + "/", storeId: STORE_ID, mode, fetchImpl, timeoutMs: 2000 });
}

/** Submits the order against a canned refusal and returns the rejection it produced. */
async function refusalOf(status: number, body: unknown): Promise<OrderRejection> {
  try {
    await remote(recordingFetch(status, body, [])).submitOrder(payload);
  } catch (error) {
    if (error instanceof OrderRejectedError) return error.rejection;
    throw error;
  }
  throw new Error("expected the order to be refused");
}

const checks: { name: string; run: () => Promise<void> }[] = [];
function check(name: string, run: () => Promise<void>): void {
  checks.push({ name, run });
}

const STORE_PATH = "/api/storefront/v1/stores/" + STORE_ID;
const cartLines = [{ productId: PRODUCT_ID, title: "Cotton Kurta" }];

check("defaults to http, so a plain config calls the seller backend", async () => {
  const calls: Call[] = [];
  const transport = createRemoteTransport({ baseUrl: BASE, storeId: STORE_ID, fetchImpl: recordingFetch(201, orderBody, calls) });
  await transport.submitOrder(payload);
  assert.equal(calls.length, 1);
});

check("submitOrder posts to the store route, sends the key as a header, and sends no prices", async () => {
  const calls: Call[] = [];
  const result = await remote(recordingFetch(201, orderBody, calls)).submitOrder(payload);
  assert.deepEqual(result, { orderId: "ORD-1", total: 2000 });
  const [call] = calls;
  assert.equal(call.url, BASE + STORE_PATH + "/orders");
  assert.equal(call.method, "POST");
  assert.equal(call.headers["idempotency-key"], payload.idempotencyKey);
  assert.deepEqual(call.body, { customer: payload.customer, lines: payload.lines });
});

check("maps the product refusals and reads productId from the top of the envelope", async () => {
  assert.deepEqual(
    await refusalOf(409, { error: { code: "OUT_OF_STOCK", message: "A product in the order is out of stock." }, productId: PRODUCT_ID }),
    { code: "out_of_stock", productId: PRODUCT_ID },
  );
  assert.deepEqual(
    await refusalOf(422, { error: { code: "UNKNOWN_PRODUCT", message: "A product in the order is not available." }, productId: PRODUCT_ID }),
    { code: "unknown_product", productId: PRODUCT_ID },
  );
  assert.deepEqual(
    await refusalOf(400, { error: { code: "INVALID_QUANTITY", message: "Quantity must be a whole number from 1 to 99." }, productId: PRODUCT_ID }),
    { code: "invalid_quantity", productId: PRODUCT_ID },
  );
});

check("maps the order-level refusals", async () => {
  assert.deepEqual(await refusalOf(400, { error: { code: "EMPTY_ORDER", message: "The order has no items." } }), { code: "empty_order" });
  assert.deepEqual(
    await refusalOf(400, { error: { code: "PAYMENT_METHOD_UNAVAILABLE", message: "Cash on delivery is not available for this store." } }),
    { code: "payment_method_unavailable" },
  );
  assert.deepEqual(
    await refusalOf(409, { error: { code: "IDEMPOTENCY_CONFLICT", message: "This Idempotency-Key was already used for a different order." } }),
    { code: "idempotency_conflict" },
  );
  assert.deepEqual(
    await refusalOf(403, { error: { code: "STORE_NOT_ACTIVE", message: "This store is not available." }, status: "suspended" }),
    { code: "store_inactive" },
  );
  assert.deepEqual(
    await refusalOf(400, { error: { code: "INVALID_REQUEST", message: "customer.phone: enter a valid Pakistani mobile number." } }),
    { code: "invalid_request", message: "customer.phone: enter a valid Pakistani mobile number." },
  );
});

check("rate limiting keeps retryAfterSeconds from the top of the envelope", async () => {
  assert.deepEqual(
    await refusalOf(429, { error: { code: "RATE_LIMITED", message: "Too many requests." }, retryAfterSeconds: 12 }),
    { code: "rate_limited", retryAfterSeconds: 12 },
  );
});

check("an out-of-stock refusal without a productId is still a refusal, naming no product", async () => {
  const rejection = await refusalOf(409, { error: { code: "OUT_OF_STOCK", message: "out of stock" } });
  assert.equal(rejection.code, "out_of_stock");
  assert.equal(rejection.productId, undefined);
});

check("a productId nested inside error is ignored, because the backend never nests it", async () => {
  const rejection = await refusalOf(409, { error: { code: "OUT_OF_STOCK", message: "out of stock", productId: PRODUCT_ID } });
  assert.equal(rejection.productId, undefined);
});

check("5xx and unmodelled codes are transport failures, not refusals", async () => {
  await assert.rejects(
    remote(recordingFetch(503, { error: { code: "STOREFRONT_UNAVAILABLE", message: "Storefront data is temporarily unavailable." } }, [])).submitOrder(payload),
    (error) => error instanceof TransportUnavailableError && error.reason === "http" && error.upstreamStatus === 503,
  );
  await assert.rejects(
    remote(recordingFetch(400, { error: { code: "SOMETHING_NEW" } }, [])).submitOrder(payload),
    (error) => error instanceof TransportUnavailableError && error.reason === "http" && error.upstreamStatus === 400,
  );
});

check("a network failure on an order is unavailable, and the order is not retried", async () => {
  let attempts = 0;
  const failing = (async () => {
    attempts += 1;
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    remote(failing).submitOrder(payload),
    (error) => error instanceof TransportUnavailableError && error.reason === "network",
  );
  assert.equal(attempts, 1);
});

check("stub mode rejects without touching the network", async () => {
  let attempts = 0;
  const counting = (async () => {
    attempts += 1;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await assert.rejects(
    remote(counting, "stub").submitOrder(payload),
    (error) => error instanceof TransportUnavailableError && error.reason === "not_implemented",
  );
  assert.equal(attempts, 0);
});

check("getProduct returns the detail, and PRODUCT_NOT_FOUND becomes null", async () => {
  const found = await remote(recordingFetch(200, productBody, [])).getProduct("cotton-kurta");
  assert.equal(found?.title, "Cotton Kurta");
  const calls: Call[] = [];
  const missing = await remote(
    recordingFetch(404, { error: { code: "PRODUCT_NOT_FOUND", message: "Product not found." } }, calls),
  ).getProduct("nope");
  assert.equal(missing, null);
  assert.equal(calls[0].url, BASE + STORE_PATH + "/products/nope");
});

check("lookupOrder posts id and phone, returns the order, and ORDER_NOT_FOUND becomes null", async () => {
  const calls: Call[] = [];
  const order = await remote(recordingFetch(200, orderBody, calls)).lookupOrder({ orderId: "ORD-1", phone: PHONE });
  assert.equal(order?.orderId, "ORD-1");
  assert.equal(order?.items[0].lineTotal, 2000);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, BASE + STORE_PATH + "/orders/lookup");
  assert.deepEqual(calls[0].body, { orderId: "ORD-1", phone: PHONE });
  const missing = await remote(
    recordingFetch(404, { error: { code: "ORDER_NOT_FOUND", message: "No order matches those details." } }, []),
  ).lookupOrder({ orderId: "ORD-9", phone: PHONE });
  assert.equal(missing, null);
});

check("lookupOrder refusals reject with OrderRejectedError", async () => {
  await assert.rejects(
    remote(recordingFetch(400, { error: { code: "INVALID_REQUEST", message: "phone: enter a valid Pakistani mobile number." } }, [])).lookupOrder({
      orderId: "ORD-1",
      phone: "12",
    }),
    (error) => error instanceof OrderRejectedError && error.rejection.code === "invalid_request",
  );
});

check("toOrderRejection returns null for bodies that are not an error envelope", async () => {
  assert.equal(toOrderRejection("<html>502</html>"), null);
  assert.equal(toOrderRejection({ error: "OUT_OF_STOCK" }), null);
});

check("a refused product carries its cart title, so the copy can name it", async () => {
  const failure = toCheckoutFailure(new OrderRejectedError({ code: "out_of_stock", productId: PRODUCT_ID }), cartLines);
  assert.deepEqual(failure, { kind: "out_of_stock", productId: PRODUCT_ID, productTitle: "Cotton Kurta" });
});

check("a product that is not in the cart keeps its id and has no title", async () => {
  const failure = toCheckoutFailure(new OrderRejectedError({ code: "unknown_product", productId: "other" }), cartLines);
  assert.deepEqual(failure, { kind: "unknown_product", productId: "other", productTitle: null });
});

check("every refusal maps to a specific failure; only non-refusals are unavailable", async () => {
  assert.deepEqual(toCheckoutFailure(new OrderRejectedError({ code: "empty_order" }), cartLines), { kind: "empty_cart" });
  assert.deepEqual(toCheckoutFailure(new OrderRejectedError({ code: "rate_limited", retryAfterSeconds: 7 }), cartLines), {
    kind: "rate_limited",
    retryAfterSeconds: 7,
  });
  const refusals: OrderRejection[] = [
    { code: "empty_order" },
    { code: "invalid_quantity", productId: PRODUCT_ID },
    { code: "unknown_product", productId: PRODUCT_ID },
    { code: "out_of_stock", productId: PRODUCT_ID },
    { code: "payment_method_unavailable" },
    { code: "idempotency_conflict" },
    { code: "rate_limited", retryAfterSeconds: null },
    { code: "invalid_request", message: "x" },
    { code: "store_inactive" },
  ];
  for (const rejection of refusals) {
    assert.notEqual(toCheckoutFailure(new OrderRejectedError(rejection), cartLines).kind, "unavailable", rejection.code);
  }
  assert.equal(toCheckoutFailure(new TransportUnavailableError("network"), cartLines).kind, "unavailable");
  assert.equal(toCheckoutFailure(new Error("boom"), cartLines).kind, "unavailable");
});

check("mock: a placed order is found by id and normalised phone, and another phone finds nothing", async () => {
  const products = await mockTransport.getProducts();
  const sellable = products.find((product) => product.stockStatus !== "out_of_stock");
  assert.ok(sellable, "the fixtures need one product in stock");
  const placed = await mockTransport.submitOrder({
    idempotencyKey: "mock-key-0001",
    customer: { customerName: "Ali Raza", phone: PHONE, address: "House 1, Street 2, Karachi" },
    lines: [{ productId: sellable.id, qty: 1 }],
  });
  const found = await mockTransport.lookupOrder({ orderId: placed.orderId, phone: "0300 1234567" });
  assert.equal(found?.total, placed.total);
  assert.equal(found?.items[0].productId, sellable.id);
  assert.equal(await mockTransport.lookupOrder({ orderId: placed.orderId, phone: "0311 1111111" }), null);
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
