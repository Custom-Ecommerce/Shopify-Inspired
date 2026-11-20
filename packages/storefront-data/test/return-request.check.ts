/*
 * Checks for Sprint 5 EP-13.US01.T03 (D-107, D-108) on the storefront side: the two return calls through the remote transport (seller backend
 * style: the order number in the path, the phone in the query) and through the BFF style (a POST body), the typed refusal, the BFF routes with
 * their gates, and the mock. No test runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/return-request.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { ReturnRefusedError } from "../src/transport/errors";
import { createMockTransport, mockProduct } from "../src/transport/mock";
import { createBffTransport, createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport } from "../src/transport/types";

const SITE = "http://alpha.localhost:3000";
const lines = [{ productId: "65a0000000000000000000aa", variantId: "65a0000000000000000000bb", quantity: 1 }];
const eligibilityBody = {
  data: {
    eligible: true,
    reason: null,
    windowDays: 7,
    deliveredAt: "2026-11-18T10:00:00.000Z",
    windowEndsAt: "2026-11-25T10:00:00.000Z",
    lines: [{ productId: lines[0]!.productId, variantId: lines[0]!.variantId, productTitle: "Shirt", variantTitle: "M", unitPrice: 1000, deliveredQuantity: 2, returnableQuantity: 2 }],
  },
};

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

interface Seen {
  method: string;
  url: string;
  body: unknown;
}

function remote(status: number, body: unknown, seen: Seen[] = []) {
  return createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch,
  });
}

check("the seller backend style: the order number in the path, the phone in the query, a GET", async () => {
  const seen: Seen[] = [];
  const result = await remote(200, eligibilityBody, seen).getReturnEligibility({ orderId: "ORD-ABCD2345", phone: "+923001234567" });
  assert.equal(result?.eligible, true);
  assert.equal(result?.lines[0]?.returnableQuantity, 2);
  assert.equal(seen[0]?.method, "GET");
  assert.match(seen[0]!.url, /\/orders\/ORD-ABCD2345\/return-eligibility\?phone=%2B923001234567$/);
});

check("a wrong phone and an unknown order are null (the same 404), for both calls", async () => {
  const notFound = { error: { code: "ORDER_NOT_FOUND", message: "No order matches those details." } };
  assert.equal(await remote(404, notFound).getReturnEligibility({ orderId: "ORD-1", phone: "+923001234567" }), null);
  assert.equal(await remote(404, notFound).submitReturn({ orderId: "ORD-1", phone: "+923001234567", items: lines, reasonCode: "damaged" }), null);
});

check("a request posts the lines, the reason and the note to the order's own path; no price or total is sent", async () => {
  const seen: Seen[] = [];
  const created = await remote(201, { data: { returnNumber: "RET-7KQ4M2XA", status: "requested" } }, seen).submitReturn({
    orderId: "ORD-ABCD2345",
    phone: "+923001234567",
    items: lines,
    reasonCode: "damaged",
    note: "It arrived broken",
  });
  assert.deepEqual(created, { returnNumber: "RET-7KQ4M2XA", status: "requested" });
  assert.equal(seen[0]?.method, "POST");
  assert.match(seen[0]!.url, /\/orders\/ORD-ABCD2345\/returns$/);
  assert.deepEqual(seen[0]?.body, { phone: "+923001234567", items: lines, reasonCode: "damaged", note: "It arrived broken" });
  assert.equal(JSON.stringify(seen[0]?.body).includes("price"), false);
});

check("422 RETURN_NOT_ELIGIBLE is a typed refusal that carries the store's sentence and the reason", async () => {
  const refusal = { error: { code: "RETURN_NOT_ELIGIBLE", message: "The return period for this order has ended." }, reason: "window_closed" };
  await assert.rejects(remote(422, refusal).submitReturn({ orderId: "ORD-1", phone: "+923001234567", items: lines, reasonCode: "other" }), (error: unknown) => {
    assert.ok(error instanceof ReturnRefusedError);
    assert.equal(error.message, "The return period for this order has ended.");
    assert.equal(error.reason, "window_closed");
    return true;
  });
});

check("the BFF style: a POST body with the order number and the phone, to the same-origin routes", async () => {
  const seen: Seen[] = [];
  const bff = createBffTransport({
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(eligibilityBody), { status: 200 });
    }) as typeof fetch,
  });
  await bff.getReturnEligibility({ orderId: "ORD-ABCD2345", phone: "0300 1234567" });
  assert.equal(seen[0]?.method, "POST");
  assert.match(seen[0]!.url, /\/orders\/return-eligibility$/);
  assert.deepEqual(seen[0]?.body, { orderId: "ORD-ABCD2345", phone: "0300 1234567" });
});

const context = { tenantKey: "alpha", clientIp: null };
const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(SITE + "/api/storefront/orders/" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "alpha.localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

function bffWith(transport: Partial<OrderTransport>) {
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport: transport as OrderTransport }) });
}

check("the BFF passes the eligibility and the request on, after the same gates as a lookup (same origin, JSON)", async () => {
  const seen: unknown[] = [];
  const routes = bffWith({
    getReturnEligibility: async (input) => {
      seen.push(input);
      return eligibilityBody.data as never;
    },
    submitReturn: async (input) => {
      seen.push(input);
      return { returnNumber: "RET-7KQ4M2XA", status: "requested" };
    },
  });
  const eligibility = await routes.returnEligibility(send("return-eligibility", { orderId: "ORD-1", phone: "0300 1234567" }), context);
  assert.equal(eligibility.status, 200);
  assert.equal(((await eligibility.json()) as { data: { eligible: boolean } }).data.eligible, true);
  const created = await routes.requestReturn(send("returns", { orderId: "ORD-1", phone: "0300 1234567", items: lines, reasonCode: "damaged", note: "broken", price: 1, total: 1, status: "approved" }), context);
  assert.equal(created.status, 201);
  assert.equal(((await created.json()) as { data: { returnNumber: string } }).data.returnNumber, "RET-7KQ4M2XA");
  assert.deepEqual(seen[1], { orderId: "ORD-1", phone: "0300 1234567", items: lines, reasonCode: "damaged", note: "broken" }, "unknown keys never reach the backend");
  const crossSite = await routes.requestReturn(send("returns", { orderId: "ORD-1", phone: "1", items: lines, reasonCode: "damaged" }, { origin: "http://evil.test" }), context);
  assert.equal(crossSite.status, 403);
});

check("the BFF answers 404 for no match, 422 RETURN_NOT_ELIGIBLE with the reason for a refusal, and 400 naming the field for a bad body", async () => {
  const none = bffWith({ getReturnEligibility: async () => null, submitReturn: async () => null });
  assert.equal((await none.returnEligibility(send("return-eligibility", { orderId: "ORD-1", phone: "1" }), context)).status, 404);
  assert.equal((await none.requestReturn(send("returns", { orderId: "ORD-1", phone: "1", items: lines, reasonCode: "damaged" }), context)).status, 404);

  const refusing = bffWith({
    submitReturn: async () => {
      throw new ReturnRefusedError("This order has not been delivered yet, so it cannot be returned.", "not_delivered");
    },
  });
  const refused = await refusing.requestReturn(send("returns", { orderId: "ORD-1", phone: "1", items: lines, reasonCode: "damaged" }), context);
  assert.equal(refused.status, 422);
  const body = (await refused.json()) as { error: { code: string; message: string }; reason: string };
  assert.equal(body.error.code, "RETURN_NOT_ELIGIBLE");
  assert.equal(body.reason, "not_delivered");

  const bad = await none.requestReturn(send("returns", { orderId: "ORD-1", phone: "1", items: [], reasonCode: "damaged" }), context);
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { field: string }).field, "items");
  const badReason = await none.requestReturn(send("returns", { orderId: "ORD-1", phone: "1", items: lines, reasonCode: "broken" }), context);
  assert.equal(((await badReason.json()) as { field: string }).field, "reasonCode");
});

check("the mock: the demo's orders are never delivered, so nothing is returnable and a request is refused", async () => {
  const mock = createMockTransport({ products: [mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 })] });
  assert.equal(await mock.getReturnEligibility({ orderId: "ORD-NOPE", phone: "+923001234567" }), null);
  const placed = await mock.submitOrder({
    idempotencyKey: "return-key-0001",
    customer: { customerName: "Ali Raza", phone: "+923001234567", address: "House 1, Street 2", city: "Karachi" },
    lines: [{ productId: "p1", qty: 1 }],
  });
  const eligibility = await mock.getReturnEligibility({ orderId: placed.orderId, phone: "+923001234567" });
  assert.equal(eligibility?.eligible, false);
  assert.equal(eligibility?.reason, "not_delivered");
  await assert.rejects(mock.submitReturn({ orderId: placed.orderId, phone: "+923001234567", items: lines, reasonCode: "other" }), ReturnRefusedError);
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
