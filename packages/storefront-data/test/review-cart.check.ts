/*
 * Checks for Sprint 5 EP-21 (reviews) and EP-28 (abandoned cart) on the storefront side: the review calls through the remote transport (seller backend
 * style: the order number in the path, the phone in the query) and through the BFF style (a POST body), the typed refusal, a product's reviews read
 * under the product's cache tag, the abandoned cart call (PUT to the backend, POST to the BFF, consent sent, only ids and quantities), the BFF routes
 * with their gates, the mock, the pure planner behind the ONE debounced call of useCheckout, and the product page loader. No test runner is needed.
 * From packages/storefront-data run:
 *
 *   npx tsx test/review-cart.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { ABANDONED_CART_CONSENT_LINE, ABANDONED_CART_DEBOUNCE_MS, planAbandonedCart } from "../src/domain/abandoned-cart";
import { loadProductPage } from "../src/server/product";
import { ReviewRefusedError } from "../src/transport/errors";
import { DEFAULT_MOCK_PRODUCTS, createMockTransport, mockProduct } from "../src/transport/mock";
import { createBffTransport, createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport, StorefrontProductReviews, StorefrontTransport } from "../src/transport/types";

const SITE = "http://alpha.localhost:3000";
const STORE = "65a000000000000000000011";
const PRODUCT = "65a0000000000000000000aa";
const VARIANT = "65a0000000000000000000bb";

const eligibilityBody = { data: { eligible: true, reason: null, items: [{ productId: PRODUCT, productTitle: "Shirt" }] } };
const reviewsBody = {
  data: {
    reviews: [
      { id: "r1", rating: 5, title: null, body: "Soft fabric", displayName: "Ayesha K.", verified: true, createdAt: "2026-11-20T10:00:00.000Z", reply: { text: "Thank you!", at: "2026-11-21T10:00:00.000Z" } },
      { id: "r2", rating: 3, title: "Fine", body: "<b>ok</b>", displayName: "Customer", verified: true, createdAt: "2026-11-19T10:00:00.000Z", reply: null },
    ],
    summary: { average: 4, count: 2 },
  },
  page: 1,
  totalPages: 1,
};
const review = { orderId: "ORD-ABCD2345", phone: "+923001234567", productId: PRODUCT, rating: 5, title: "Lovely", body: "Soft fabric, true to size.", displayName: "Ayesha K." };

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

interface Seen {
  method: string;
  url: string;
  body: unknown;
  init: Record<string, unknown>;
}

function remote(status: number, body: unknown, seen: Seen[] = []) {
  return createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: STORE,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)), init: (init ?? {}) as Record<string, unknown> });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch,
  });
}

check("the seller backend style: the order number in the path, the phone in the query, a GET for the eligibility", async () => {
  const seen: Seen[] = [];
  const result = await remote(200, eligibilityBody, seen).getReviewEligibility({ orderId: "ORD-ABCD2345", phone: "+923001234567" });
  assert.equal(result?.eligible, true);
  assert.equal(result?.items[0]?.productTitle, "Shirt");
  assert.equal(seen[0]?.method, "GET");
  assert.match(seen[0]!.url, /\/orders\/ORD-ABCD2345\/review-eligibility\?phone=%2B923001234567$/);
});

check("a wrong phone and an unknown order are null (the same 404), for both review calls", async () => {
  const notFound = { error: { code: "ORDER_NOT_FOUND", message: "No order matches those details." } };
  assert.equal(await remote(404, notFound).getReviewEligibility({ orderId: "ORD-1", phone: "+923001234567" }), null);
  assert.equal(await remote(404, notFound).submitReview(review), null);
});

check("a review posts to the order's own path with the phone, the product, the rating and the words; no status, no verified flag, no customer", async () => {
  const seen: Seen[] = [];
  const created = await remote(201, { data: { id: "r9", status: "approved" } }, seen).submitReview(review);
  assert.deepEqual(created, { id: "r9", status: "approved" });
  assert.equal(seen[0]?.method, "POST");
  assert.match(seen[0]!.url, /\/orders\/ORD-ABCD2345\/reviews$/);
  assert.deepEqual(seen[0]?.body, { phone: "+923001234567", productId: PRODUCT, rating: 5, title: "Lovely", body: "Soft fabric, true to size.", displayName: "Ayesha K." });
  const text = JSON.stringify(seen[0]?.body);
  for (const field of ["status", "verified", "customer", "order"]) assert.equal(text.includes('"' + field + '"'), false, field);
});

check("422 REVIEW_NOT_ELIGIBLE is a typed refusal that carries the store's sentence and the reason", async () => {
  const refusal = { error: { code: "REVIEW_NOT_ELIGIBLE", message: "You have already reviewed this item." }, reason: "already_reviewed", field: "productId" };
  await assert.rejects(remote(422, refusal).submitReview(review), (error: unknown) => {
    assert.ok(error instanceof ReviewRefusedError);
    assert.equal(error.message, "You have already reviewed this item.");
    assert.equal(error.reason, "already_reviewed");
    assert.equal(error.field, "productId");
    return true;
  });
});

check("a product's reviews: a GET under the product's own cache tag (so a review published, hidden or answered drops it), the page in the query", async () => {
  const seen: Seen[] = [];
  const result = await remote(200, reviewsBody, seen).getProductReviews("blue-shirt", 2);
  assert.equal(result.summary.count, 2);
  assert.equal(result.reviews[0]?.reply?.text, "Thank you!");
  assert.equal(seen[0]?.method, "GET");
  assert.match(seen[0]!.url, /\/products\/blue-shirt\/reviews\?page=2$/);
  const next = (seen[0]!.init as { next?: { tags: string[]; revalidate: number } }).next;
  assert.ok(next, "the read is cached by the storefront's data cache");
  assert.ok(next.tags.includes("store:" + STORE + ":product:blue-shirt"), next.tags.join(","));
  assert.ok(next.revalidate > 0);
});

check("a malformed reviews answer is an error, never a half-valid object", async () => {
  await assert.rejects(remote(200, { data: { reviews: [{ id: "r1" }], summary: { average: 9, count: -1 } }, page: 1, totalPages: 1 }).getProductReviews("blue-shirt"));
  await assert.rejects(remote(500, {}).getProductReviews("blue-shirt"));
});

check("the abandoned cart: a PUT to the backend with the consent and ids and quantities only; the BFF style is a POST; failures reject (the checkout ignores them)", async () => {
  const seen: Seen[] = [];
  const input = { phone: "+923001234567", email: "a@b.pk", lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 2 }] };
  await remote(200, { data: { saved: true } }, seen).saveAbandonedCart(input);
  assert.equal(seen[0]?.method, "PUT");
  assert.match(seen[0]!.url, /\/stores\/65a000000000000000000011\/abandoned-cart$/);
  assert.deepEqual(seen[0]?.body, { phone: "+923001234567", email: "a@b.pk", consent: true, lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 2 }] });
  assert.equal(JSON.stringify(seen[0]?.body).includes("price"), false);

  const bff: Seen[] = [];
  await createBffTransport({
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      bff.push({ method: init?.method ?? "GET", url: String(url), body: JSON.parse(String(init?.body)), init: {} });
      return new Response(JSON.stringify({ data: { saved: true } }), { status: 200 });
    }) as typeof fetch,
  }).saveAbandonedCart({ phone: "+923001234567", lines: input.lines });
  assert.equal(bff[0]?.method, "POST");
  assert.match(bff[0]!.url, /\/api\/storefront\/abandoned-cart$/);
  assert.equal((bff[0]?.body as { consent: boolean }).consent, true);
  assert.equal("email" in (bff[0]?.body as object), false, "no email key when there is none");

  await assert.rejects(remote(400, { error: { code: "INVALID_REQUEST", message: "phone: enter a valid mobile number" }, field: "phone" }).saveAbandonedCart(input));
  await assert.rejects(remote(503, {}).saveAbandonedCart(input));
});

check("the BFF style review calls: the order number and the phone travel in a POST body, to the same-origin routes", async () => {
  const seen: Seen[] = [];
  const bff = createBffTransport({
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", url: String(input), body: JSON.parse(String(init?.body)), init: {} });
      return new Response(JSON.stringify(seen.length === 1 ? eligibilityBody : seen.length === 2 ? { data: { id: "r1", status: "approved" } } : reviewsBody), { status: seen.length === 2 ? 201 : 200 });
    }) as typeof fetch,
  });
  await bff.getReviewEligibility({ orderId: "ORD-ABCD2345", phone: "0300 1234567" });
  await bff.submitReview({ ...review, phone: "0300 1234567" });
  await bff.getProductReviews("blue-shirt", 3);
  assert.deepEqual(seen.map((s) => [s.method, s.url.replace(/^.*\/api\/storefront/, "")]), [["POST", "/orders/review-eligibility"], ["POST", "/orders/reviews"], ["POST", "/reviews"]]);
  assert.deepEqual(seen[0]?.body, { orderId: "ORD-ABCD2345", phone: "0300 1234567" });
  assert.equal((seen[1]?.body as { orderId: string }).orderId, "ORD-ABCD2345");
  assert.deepEqual(seen[2]?.body, { slug: "blue-shirt", page: 3 });
});

const context = { tenantKey: "alpha", clientIp: null };
const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(SITE + "/api/storefront/" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "alpha.localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

function bffWith(transport: Partial<OrderTransport>) {
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport: transport as OrderTransport }) });
}

check("the BFF passes the four calls on after the same gates as a lookup (same origin, JSON), and strips what the browser must not set", async () => {
  const seen: unknown[] = [];
  const routes = bffWith({
    getReviewEligibility: async (input) => {
      seen.push(input);
      return eligibilityBody.data as never;
    },
    submitReview: async (input) => {
      seen.push(input);
      return { id: "r1", status: "approved" };
    },
    getProductReviews: async (slug, page) => {
      seen.push({ slug, page });
      return reviewsBody.data as never;
    },
    saveAbandonedCart: async (input) => {
      seen.push(input);
    },
  });
  const eligibility = await routes.reviewEligibility(send("orders/review-eligibility", { orderId: "ORD-1", phone: "0300 1234567" }), context);
  assert.equal(eligibility.status, 200);
  const created = await routes.submitReview(send("orders/reviews", { ...review, status: "approved", verified: true, customer: "x", store: "y" }), context);
  assert.equal(created.status, 201);
  assert.deepEqual(seen[1], { orderId: "ORD-ABCD2345", phone: "+923001234567", productId: PRODUCT, rating: 5, title: "Lovely", body: "Soft fabric, true to size.", displayName: "Ayesha K." });
  const list = await routes.productReviews(send("reviews", { slug: "blue-shirt" }), context);
  assert.equal(list.status, 200);
  assert.deepEqual(seen[2], { slug: "blue-shirt", page: 1 });
  const saved = await routes.abandonedCart(send("abandoned-cart", { phone: "0300 1234567", consent: true, lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 2, unitPrice: 1, price: 1 }], total: 1 }), context);
  assert.equal(saved.status, 200);
  assert.deepEqual(seen[3], { phone: "0300 1234567", email: null, lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 2 }] }, "a price or a total never reaches the backend");
  for (const [name, body] of [["orders/review-eligibility", { orderId: "ORD-1", phone: "1" }], ["orders/reviews", review], ["reviews", { slug: "a" }], ["abandoned-cart", { phone: "1", consent: true, lines: [{ productId: PRODUCT, qty: 1 }] }]] as const) {
    const route = name === "orders/review-eligibility" ? routes.reviewEligibility : name === "orders/reviews" ? routes.submitReview : name === "reviews" ? routes.productReviews : routes.abandonedCart;
    assert.equal((await route(send(name, body, { origin: "http://evil.test" }), context)).status, 403, name);
  }
});

check("the BFF answers 404 for no match, 422 REVIEW_NOT_ELIGIBLE with the reason for a refusal, and 400 naming the field for a bad body (the consent included)", async () => {
  const none = bffWith({ getReviewEligibility: async () => null, submitReview: async () => null });
  assert.equal((await none.reviewEligibility(send("orders/review-eligibility", { orderId: "ORD-1", phone: "1" }), context)).status, 404);
  assert.equal((await none.submitReview(send("orders/reviews", review), context)).status, 404);

  const refusing = bffWith({
    submitReview: async () => {
      throw new ReviewRefusedError("You have already reviewed this item.", "already_reviewed", "productId");
    },
  });
  const refused = await refusing.submitReview(send("orders/reviews", review), context);
  assert.equal(refused.status, 422);
  const body = (await refused.json()) as { error: { code: string; message: string }; reason: string; field: string };
  assert.equal(body.error.code, "REVIEW_NOT_ELIGIBLE");
  assert.equal(body.reason, "already_reviewed");
  assert.equal(body.field, "productId");

  for (const [fields, field] of [[{ rating: 0 }, "rating"], [{ rating: 6 }, "rating"], [{ body: "" }, "body"], [{ productId: "" }, "productId"]] as const) {
    const bad = await none.submitReview(send("orders/reviews", { ...review, ...fields }), context);
    assert.equal(bad.status, 400, JSON.stringify(fields));
    assert.equal(((await bad.json()) as { field: string }).field, field);
  }
  const noConsent = await none.abandonedCart(send("abandoned-cart", { phone: "0300 1234567", lines: [{ productId: PRODUCT, qty: 1 }] }), context);
  assert.equal(noConsent.status, 400);
  assert.equal(((await noConsent.json()) as { field: string }).field, "consent");
  const falseConsent = await none.abandonedCart(send("abandoned-cart", { phone: "0300 1234567", consent: false, lines: [{ productId: PRODUCT, qty: 1 }] }), context);
  assert.equal(falseConsent.status, 400);
  const empty = await none.abandonedCart(send("abandoned-cart", { phone: "0300 1234567", consent: true, lines: [] }), context);
  assert.equal(((await empty.json()) as { field: string }).field, "lines");
});

check("the mock: the demo's orders are never delivered, so nothing can be reviewed; its reviews come from the fixtures; saving a cart keeps nothing", async () => {
  const sample: StorefrontProductReviews["reviews"] = [
    { id: "s1", rating: 5, title: null, body: "Older", displayName: "A", verified: true, createdAt: "2026-11-01T10:00:00.000Z", reply: null },
    { id: "s2", rating: 3, title: null, body: "Newer", displayName: "B", verified: true, createdAt: "2026-11-10T10:00:00.000Z", reply: null },
  ];
  const mock = createMockTransport({ products: [mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 })], reviews: { p1: sample } });
  assert.equal(await mock.getReviewEligibility({ orderId: "ORD-NOPE", phone: "+923001234567" }), null);
  const placed = await mock.submitOrder({
    idempotencyKey: "review-key-0001",
    customer: { customerName: "Ali Raza", phone: "+923001234567", address: "House 1, Street 2", city: "Karachi" },
    lines: [{ productId: "p1", qty: 1 }],
  });
  const eligibility = await mock.getReviewEligibility({ orderId: placed.orderId, phone: "+923001234567" });
  assert.deepEqual(eligibility, { eligible: false, reason: "not_delivered", items: [] });
  await assert.rejects(mock.submitReview({ ...review, orderId: placed.orderId, phone: "+923001234567" }), ReviewRefusedError);
  const reviews = await mock.getProductReviews("p1");
  assert.deepEqual(reviews.reviews.map((r) => r.body), ["Newer", "Older"], "newest first");
  assert.deepEqual(reviews.summary, { average: 4, count: 2 });
  assert.deepEqual((await mock.getProductReviews("other")).summary, { average: 0, count: 0 });
  await mock.saveAbandonedCart({ phone: "+923001234567", lines: [{ productId: "p1", qty: 1 }] });
});

check("the planner behind the ONE debounced call of useCheckout: a valid phone and a cart, ids and quantities only, nothing otherwise", () => {
  const lines = [{ productId: PRODUCT, variantId: VARIANT, qty: 2 }];
  assert.equal(planAbandonedCart("", "", lines), null, "no phone");
  assert.equal(planAbandonedCart("0300", "", lines), null, "a half typed phone");
  assert.equal(planAbandonedCart("0200 1234567", "", lines), null, "not a mobile number");
  assert.equal(planAbandonedCart(undefined, undefined, lines), null);
  assert.equal(planAbandonedCart("0300 1234567", "", []), null, "an empty cart");
  const plan = planAbandonedCart("0300 1234567", "Ayesha@Example.PK", lines)!;
  assert.deepEqual(plan.input, { phone: "+923001234567", email: "ayesha@example.pk", lines });
  assert.equal(planAbandonedCart("0300 1234567", "not an email", lines)!.input.email, null, "an email that is not one is left out, the cart is still kept");
  assert.equal(planAbandonedCart("03001234567", "", lines)!.signature, planAbandonedCart("+92 300 1234567", "", lines)!.signature, "the same phone in any spelling is one signature, so it is sent once");
  assert.notEqual(planAbandonedCart("0300 1234567", "", lines)!.signature, planAbandonedCart("0300 1234567", "", [{ ...lines[0]!, qty: 3 }])!.signature, "a changed cart is sent again");
  const withPrice = planAbandonedCart("0300 1234567", "", [{ ...lines[0]!, unitPrice: 1, price: 1 } as never])!;
  assert.deepEqual(Object.keys(withPrice.input.lines[0]!).sort(), ["productId", "qty", "variantId"], "no price travels");
  assert.equal(ABANDONED_CART_CONSENT_LINE, "We may message you about this cart");
  assert.ok(ABANDONED_CART_DEBOUNCE_MS >= 500 && ABANDONED_CART_DEBOUNCE_MS <= 5000);
});

check("the product page loader reads the reviews with the product, keeps the page when they cannot be read, and a missing product stays a 404", async () => {
  // A complete product (categories, images, seo): the loader turns it into the page view-model.
  const product = DEFAULT_MOCK_PRODUCTS[0]!;
  const slug = product.slug;
  const base = createMockTransport({ products: [product], reviews: { [slug]: [{ id: "s1", rating: 5, title: null, body: "Nice", displayName: "A", verified: true, createdAt: "2026-11-01T10:00:00.000Z", reply: null }] } });
  const ok = await loadProductPage(base, slug);
  assert.equal(ok.status, "ok");
  assert.equal(ok.status === "ok" ? ok.reviews?.summary.count : -1, 1);
  const broken: StorefrontTransport = { ...base, getProductReviews: async () => Promise.reject(new Error("backend down")) };
  const withoutReviews = await loadProductPage(broken, slug);
  assert.equal(withoutReviews.status, "ok");
  assert.equal(withoutReviews.status === "ok" ? withoutReviews.reviews : "x", null);
  assert.equal((await loadProductPage(base, "missing")).status, "not-found");
});

void (async () => {
  for (const [name, run] of checks) {
    await run();
    console.log("ok - " + name);
  }
  console.log(checks.length + " checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
