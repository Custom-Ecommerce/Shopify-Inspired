/*
 * Checks for EP-03 CB-1: one checkout schema for the form and the BFF, and one quote contract. No test runner is needed.
 * From packages/storefront-data run:
 *
 *   npx tsx test/checkout-validation.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { storefrontCartQuoteSchema, storefrontCheckoutCustomerSchema } from "@markaz/contracts/checkout";
import { createBffRoutes } from "../src/bff/handlers";
import { checkoutServerFieldError, toCheckoutFailure } from "../src/client/checkout-failure";
import { checkoutFormSchema, validateCheckout } from "../src/domain/checkout";
import { createMockTransport, mockProduct } from "../src/transport/mock";
import { OrderRejectedError } from "../src/transport/errors";
import { toOrderRejection } from "../src/transport/remote";
import type { OrderTransport, SubmitOrderPayload } from "../src/transport/types";
import { WireCartQuote } from "../src/transport/wire";
import { toCartQuoteVM } from "../src/view-models/cart-quote";

const SITE = "http://mustafa.localhost:3000";
const STORED = "+923001234567";
const good = { customerName: "Ali Raza", phone: "0300 1234567", address: "House 1, Street 2", city: "Karachi" };
const lines = [{ productId: "65a0000000000000000000aa", qty: 2 }];

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

function bff(onSubmit: (payload: SubmitOrderPayload) => void, rejection?: OrderRejectedError) {
  const transport = {
    submitOrder: async (payload: SubmitOrderPayload) => {
      onSubmit(payload);
      if (rejection) throw rejection;
      return { orderId: "ORD-1", total: 1 };
    },
    trackOrder: async () => null,
    confirmOrder: async () => null,
  } as unknown as OrderTransport;
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
}

const submit = (routes: ReturnType<typeof bff>, body: unknown) =>
  routes.submit(
    new Request(SITE + "/api/storefront/orders", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": "checkout-key-0001" },
      body: JSON.stringify(body),
    }),
    { tenantKey: "mustafa", clientIp: null },
  );

check("the form runs the contract's own schema, not a copy", () => {
  assert.equal(checkoutFormSchema, storefrontCheckoutCustomerSchema);
});

check("the form accepts a good customer and hands on the stored phone format", () => {
  const result = validateCheckout({ ...good, email: "", note: "" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.phone, STORED);
    assert.equal(result.data.city, "Karachi");
    assert.equal(result.data.email, null);
    assert.equal(result.data.note, null);
  }
});

check("the form accepts Urdu digits", () => {
  const result = validateCheckout({ ...good, phone: "۰۳۰۰ ۱۲۳۴۵۶۷" });
  assert.equal(result.ok && result.data.phone, STORED);
});

check("the form gives one plain message per field", () => {
  const result = validateCheckout({ customerName: "", phone: "12", address: "", city: "", email: "x", note: "n".repeat(501) });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.errors, {
      customerName: "Enter your full name",
      phone: "Enter a valid mobile number, for example 0300 1234567",
      address: "Enter your full delivery address",
      city: "Enter your city",
      email: "Enter a valid email address, or leave this empty",
      note: "Note is too long",
    });
  }
});

check("the BFF refuses bad input with 400 and the field name, and never calls the backend", async () => {
  let calls = 0;
  const routes = bff(() => (calls += 1));
  for (const [change, field] of [
    [{ phone: "12345" }, "customer.phone"],
    [{ customerName: "A" }, "customer.customerName"],
    [{ address: "short" }, "customer.address"],
    [{ city: "" }, "customer.city"],
    [{ email: "nope" }, "customer.email"],
    [{ note: "n".repeat(501) }, "customer.note"],
  ] as const) {
    const response = await submit(routes, { customer: { ...good, ...change }, lines });
    assert.equal(response.status, 400, field);
    const body = (await response.json()) as { error: { code: string; message: string }; field: string };
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.field, field);
    assert.ok(body.error.message.startsWith(field + ": "));
  }
  assert.equal(calls, 0);
});

check("the BFF hands on the cleaned customer, with city, and no price the browser sent", async () => {
  let sent: SubmitOrderPayload | null = null;
  const routes = bff((payload) => (sent = payload));
  const response = await submit(routes, {
    customer: { ...good, phone: "۰۳۰۰-۱۲۳۴۵۶۷", note: "Ring the bell" },
    lines: [{ ...lines[0], unitPrice: 1, price: 1 }],
    total: 1,
  });
  assert.equal(response.status, 201);
  assert.ok(sent);
  const payload = sent as SubmitOrderPayload;
  assert.deepEqual(payload.customer, { ...good, phone: STORED, whatsapp: null, email: null, note: "Ring the bell" });
  assert.deepEqual(payload.lines, lines);
});

check("the field a backend names survives the trip through the transport and the BFF", async () => {
  const body = { error: { code: "INVALID_REQUEST", message: "customer.city: Enter your city" }, field: "customer.city" };
  const rejection = toOrderRejection(body);
  assert.deepEqual(rejection, { code: "invalid_request", message: "customer.city: Enter your city", field: "customer.city" });

  const routes = bff(() => undefined, new OrderRejectedError(rejection!));
  const response = await submit(routes, { customer: good, lines });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { field: string }).field, "customer.city");
});

check("a server refusal of one field becomes that field's message; anything else stays a banner", () => {
  const failure = (message: string) => toCheckoutFailure(new OrderRejectedError({ code: "invalid_request", message }), []);
  assert.deepEqual(checkoutServerFieldError(failure("customer.phone: enter a valid mobile number.")), { field: "phone", message: "Enter a valid mobile number." });
  assert.deepEqual(checkoutServerFieldError(failure("customer.city: Enter your city")), { field: "city", message: "Enter your city" });
  assert.equal(checkoutServerFieldError(failure("customer.shoeSize: nope")), null);
  assert.equal(checkoutServerFieldError(failure("lines.0.qty: Invalid")), null);
  assert.equal(checkoutServerFieldError(failure("This is a preview, so no order was placed.")), null);
  assert.equal(checkoutServerFieldError({ kind: "unavailable" }), null);
  assert.equal(checkoutServerFieldError(null), null);
});

check("the transport reads the quote through the contract, and the view model carries the discount", () => {
  assert.equal(WireCartQuote, storefrontCartQuoteSchema);
  const quote = WireCartQuote.parse({ lines: [], subtotal: 1000, deliveryCharges: 200, total: 1200, canCheckout: false });
  assert.equal(quote.discount, 0, "a backend without the field reads as no discount");
  const vm = toCartQuoteVM(quote);
  assert.equal(vm.discount.amount, 0);
  assert.equal(vm.total.amount, 1200);
});

check("the mock transport keeps to the same quote and customer shape", async () => {
  const product = mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 });
  const transport = createMockTransport({ products: [product] });
  const quote = await transport.quoteCart({ lines: [{ productId: "p1", qty: 1 }] });
  assert.equal(WireCartQuote.safeParse(quote).success, true);
  assert.equal(quote.discount, 0);
  const placed = await transport.submitOrder({ idempotencyKey: "checkout-key-0002", customer: { ...good, phone: STORED }, lines: [{ productId: "p1", qty: 1 }] });
  const order = await transport.lookupOrder({ orderId: placed.orderId, phone: STORED });
  assert.equal(order?.city, "Karachi");
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
