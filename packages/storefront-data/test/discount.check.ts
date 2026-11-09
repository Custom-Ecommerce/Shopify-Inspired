/*
 * Checks for EP-15: the code travels from the browser to the backend, and a refusal comes back in plain words. No test
 * runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/discount.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import { createStorefrontCartStore } from "../src/client/cart-store";
import { OrderRejectedError } from "../src/transport/errors";
import { createMockTransport, mockProduct } from "../src/transport/mock";
import { createRemoteTransport, toOrderRejection } from "../src/transport/remote";
import type { CartQuoteInput, OrderTransport, SubmitOrderPayload } from "../src/transport/types";
import { toCartQuoteVM } from "../src/view-models/cart-quote";

const SITE = "http://mustafa.localhost:3000";
const good = { customerName: "Ali Raza", phone: "0300 1234567", address: "House 1, Street 2", city: "Karachi" };
const lines = [{ productId: "65a0000000000000000000aa", qty: 2 }];
const QUOTE = { lines: [], subtotal: 2000, deliveryCharges: 250, discount: 200, total: 2050, canCheckout: true, discountCode: "EID10", discountError: null };

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

function bff(seen: { quote?: CartQuoteInput; order?: SubmitOrderPayload }, rejection?: OrderRejectedError) {
  const transport = {
    quoteCart: async (input: CartQuoteInput) => {
      seen.quote = input;
      return QUOTE;
    },
    submitOrder: async (payload: SubmitOrderPayload) => {
      seen.order = payload;
      if (rejection) throw rejection;
      return { orderId: "ORD-1", total: 1 };
    },
  } as unknown as OrderTransport;
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
}

const send = (path: string, body: unknown) =>
  new Request(SITE + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": "checkout-key-0001" },
    body: JSON.stringify(body),
  });
const context = { tenantKey: "mustafa", clientIp: null };

check("the BFF passes the code on a quote, in capitals", async () => {
  const seen: { quote?: CartQuoteInput } = {};
  const response = await bff(seen).quote(send("/api/storefront/cart/quote", { lines, discountCode: " eid10 " }), context);
  assert.equal(response.status, 200);
  assert.equal(seen.quote?.discountCode, "EID10");
});

check("the BFF passes the code on an order", async () => {
  const seen: { order?: SubmitOrderPayload } = {};
  const response = await bff(seen).submit(send("/api/storefront/orders", { customer: good, lines, discountCode: "eid10" }), context);
  assert.equal(response.status, 201);
  assert.equal(seen.order?.discountCode, "EID10");
});

check("the BFF refuses a code that is too long, naming the field", async () => {
  const response = await bff({}).quote(send("/api/storefront/cart/quote", { lines, discountCode: "X".repeat(41) }), context);
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { field: string }).field, "discountCode");
});

check("the backend's refusals become one typed rejection with the shopper's message", () => {
  assert.deepEqual(toOrderRejection({ error: { code: "DISCOUNT_REJECTED", message: "This code has expired." }, reason: "expired" }), {
    code: "discount_rejected",
    reason: "expired",
    message: "This code has expired.",
  });
  assert.deepEqual(toOrderRejection({ error: { code: "DISCOUNT_USED_UP", message: "This code has been fully used." } }), {
    code: "discount_rejected",
    reason: "used_up",
    message: "This code has been fully used.",
  });
});

check("a refusal through the BFF keeps its status, code and reason", async () => {
  const used = new OrderRejectedError({ code: "discount_rejected", reason: "used_up", message: "This code has been fully used." });
  const usedResponse = await bff({}, used).submit(send("/api/storefront/orders", { customer: good, lines, discountCode: "X" }), context);
  assert.equal(usedResponse.status, 409);
  assert.deepEqual(await usedResponse.json(), { error: { code: "DISCOUNT_USED_UP", message: "This code has been fully used." }, reason: "used_up", field: "discountCode" });

  const expired = new OrderRejectedError({ code: "discount_rejected", reason: "expired", message: "This code has expired." });
  const expiredResponse = await bff({}, expired).submit(send("/api/storefront/orders", { customer: good, lines, discountCode: "X" }), context);
  assert.equal(expiredResponse.status, 422);
});

check("a refusal reaches the UI as a failure with the message to show", () => {
  const failure = toCheckoutFailure(new OrderRejectedError({ code: "discount_rejected", reason: "expired", message: "This code has expired." }), []);
  assert.deepEqual(failure, { kind: "discount_rejected", reason: "expired", message: "This code has expired." });
});

check("the remote transport sends a code only when there is one", async () => {
  const bodies: unknown[] = [];
  const client = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: QUOTE }), { status: 200 });
    }) as typeof fetch,
  });
  await client.quoteCart({ lines, discountCode: "EID10" });
  await client.quoteCart({ lines, discountCode: null });
  assert.deepEqual(bodies, [{ lines, discountCode: "EID10" }, { lines }]);
});

check("the remote transport adds the signed address headers it is given", async () => {
  let sent = new Headers();
  const client = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    clientIp: "203.0.113.5",
    clientAddressHeaders: { "x-markaz-client-address": "203.0.113.5", "x-markaz-signature": "abc" },
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: QUOTE }), { status: 200 });
    }) as typeof fetch,
  });
  await client.quoteCart({ lines });
  assert.equal(sent.get("x-markaz-client-address"), "203.0.113.5");
  assert.equal(sent.get("x-markaz-signature"), "abc");
});

check("the view model carries the discount, the code and the plain error", () => {
  const applied = toCartQuoteVM(QUOTE as never);
  assert.equal(applied.discount.amount, 200);
  assert.equal(applied.discountCode, "EID10");
  assert.equal(applied.discountError, null);
  const refused = toCartQuoteVM({ ...QUOTE, discount: 0, discountCode: null, discountError: { reason: "expired", message: "This code has expired." } } as never);
  assert.equal(refused.discountError, "This code has expired.");
});

check("the demo has no codes: every code is unknown, and an order with one is refused", async () => {
  const mock = createMockTransport({ products: [mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 })] });
  const quote = await mock.quoteCart({ lines: [{ productId: "p1", qty: 1 }], discountCode: "EID10" });
  assert.equal(quote.discount, 0);
  assert.equal(quote.discountError?.reason, "unknown");
  await assert.rejects(
    mock.submitOrder({ idempotencyKey: "discount-0001", customer: { ...good, phone: "+923001234567" }, lines: [{ productId: "p1", qty: 1 }], discountCode: "EID10" }),
    OrderRejectedError,
  );
});

check("the cart keeps the code until the order is placed", () => {
  const store = createStorefrontCartStore("test-cart");
  store.getState().setDiscountCode("EID10");
  assert.equal(store.getState().discountCode, "EID10");
  store.getState().removeLine("nothing");
  assert.equal(store.getState().discountCode, "EID10");
  store.getState().clearLines();
  assert.equal(store.getState().discountCode, null);
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
