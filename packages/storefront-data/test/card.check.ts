/*
 * Checks for D-082 on the storefront side: a card order goes through the BFF, comes back with where to pay, and a failed
 * start reads as what it is. No test runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/card.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import { OrderRejectedError } from "../src/transport/errors";
import { createMockTransport, mockProduct } from "../src/transport/mock";
import { createRemoteTransport, toOrderRejection } from "../src/transport/remote";
import type { OrderTransport, SubmitOrderPayload } from "../src/transport/types";

const SITE = "http://alpha.localhost:3000";
const PAY_URL = "https://checkout.stripe.test/pay/cs_1";
const customer = { customerName: "Ali Raza", phone: "0300 1234567", address: "House 1, Street 2", city: "Karachi" };
const lines = [{ productId: "65a0000000000000000000aa", qty: 1 }];

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

const send = (body: unknown) =>
  new Request(SITE + "/api/storefront/orders", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "alpha.localhost:3000", "idempotency-key": "card-key-0001" },
    body: JSON.stringify(body),
  });
const context = { tenantKey: "alpha", clientIp: null };

function bff(seen: { order?: SubmitOrderPayload }, rejection?: OrderRejectedError) {
  const transport = {
    submitOrder: async (payload: SubmitOrderPayload) => {
      seen.order = payload;
      if (rejection) throw rejection;
      return { orderId: "ORD-1", total: 1250, checkoutUrl: PAY_URL };
    },
  } as unknown as OrderTransport;
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
}

check("the BFF passes a card order on and hands back where to pay", async () => {
  const seen: { order?: SubmitOrderPayload } = {};
  const response = await bff(seen).submit(send({ customer, lines, paymentMethod: "card" }), context);
  assert.equal(response.status, 201);
  assert.equal(seen.order?.paymentMethod, "card");
  assert.equal(((await response.json()) as { data: { checkoutUrl: string } }).data.checkoutUrl, PAY_URL);
});

check("the BFF refuses a payment method it does not know, naming the field", async () => {
  const response = await bff({}).submit(send({ customer, lines, paymentMethod: "bitcoin" }), context);
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { field: string }).field, "paymentMethod");
});

check("return addresses sent by the browser never reach the backend", async () => {
  const seen: { order?: SubmitOrderPayload } = {};
  await bff(seen).submit(send({ customer, lines, paymentMethod: "card", success_url: "https://evil.test/", cancel_url: "https://evil.test/" }), context);
  assert.equal(JSON.stringify(seen.order).includes("evil.test"), false);
});

function remote(status: number, body: unknown, bodies: unknown[] = []) {
  return createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch,
  });
}

const payload = { idempotencyKey: "card-key-0001", customer: { ...customer, phone: "+923001234567" }, lines };

check("the transport asks for card only when chosen, and returns where to pay", async () => {
  const bodies: unknown[] = [];
  const client = remote(201, { data: { orderId: "ORD-1", total: 1250, checkoutUrl: PAY_URL } }, bodies);
  const placed = await client.submitOrder({ ...payload, paymentMethod: "card" });
  assert.equal(placed.checkoutUrl, PAY_URL);
  await client.submitOrder({ ...payload, paymentMethod: "cod" });
  await client.submitOrder(payload);
  assert.equal((bodies[0] as { paymentMethod?: string }).paymentMethod, "card");
  assert.equal("paymentMethod" in (bodies[1] as object), false);
  assert.equal("paymentMethod" in (bodies[2] as object), false);
});

check("a failed start is a clear refusal, not an unknown outcome to retry", async () => {
  const body = { error: { code: "PAYMENT_NOT_STARTED", message: "We could not start the card payment." } };
  assert.deepEqual(toOrderRejection(body), { code: "payment_not_started", message: "We could not start the card payment." });
  await assert.rejects(remote(502, body).submitOrder({ ...payload, paymentMethod: "card" }), (error: unknown) => {
    assert.ok(error instanceof OrderRejectedError);
    assert.equal(error.rejection.code, "payment_not_started");
    return true;
  });
});

check("a failed start keeps its status through the BFF and reads as its own failure", async () => {
  const rejection = new OrderRejectedError({ code: "payment_not_started", message: "We could not start the card payment." });
  const response = await bff({}, rejection).submit(send({ customer, lines, paymentMethod: "card" }), context);
  assert.equal(response.status, 502);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "PAYMENT_NOT_STARTED");
  assert.deepEqual(toCheckoutFailure(rejection, []), { kind: "payment_not_started", message: "We could not start the card payment." });
});

check("the demo takes no card orders", async () => {
  const mock = createMockTransport({ products: [mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 })] });
  await assert.rejects(
    mock.submitOrder({ idempotencyKey: "card-key-0002", customer: { ...customer, phone: "+923001234567" }, lines: [{ productId: "p1", qty: 1 }], paymentMethod: "card" }),
    OrderRejectedError,
  );
});

check("an order lookup carries the payment state", async () => {
  const order = {
    orderId: "ORD-1", status: "pending", paymentMethod: "card", paymentStatus: "paid", subtotal: 1000, deliveryCharges: 250, discount: 0, total: 1250,
    createdAt: "2026-11-10T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z", customerName: "Ali", phone: "+923001234567", city: "Karachi", address: "House 1", items: [],
  };
  assert.equal((await remote(200, { data: order }).lookupOrder({ orderId: "ORD-1", phone: "03001234567" }))?.paymentStatus, "paid");
  const { paymentStatus: _omitted, ...older } = order;
  assert.equal((await remote(200, { data: older }).lookupOrder({ orderId: "ORD-1", phone: "03001234567" }))?.paymentStatus, "unpaid");
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
