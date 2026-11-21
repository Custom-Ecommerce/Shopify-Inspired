/*
 * Checks for Sprint 5 EP-11.US02 (D-107) on the storefront side: an order the store refuses because the phone or email is on its blocklist
 * reads as its own failure with the server's neutral sentence, which both themes show as it stands. No test runner is needed. From
 * packages/storefront-data run:
 *
 *   npx tsx test/contact-blocked.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import { OrderRejectedError } from "../src/transport/errors";
import { createRemoteTransport, toOrderRejection } from "../src/transport/remote";
import type { OrderTransport } from "../src/transport/types";

const SITE = "http://alpha.localhost:3000";
const MESSAGE = "We cannot take this order. Please contact the store.";
const customer = { customerName: "Ali Raza", phone: "0300 1234567", address: "House 1, Street 2", city: "Karachi" };
const lines = [{ productId: "65a0000000000000000000aa", qty: 1 }];
const body = { error: { code: "CONTACT_BLOCKED", message: MESSAGE } };

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

check("the backend's CONTACT_BLOCKED is a refusal the client models, carrying the neutral sentence", () => {
  assert.deepEqual(toOrderRejection(body), { code: "contact_blocked", message: MESSAGE });
});

check("without a message the client still has the neutral sentence", () => {
  assert.deepEqual(toOrderRejection({ error: { code: "CONTACT_BLOCKED" } }), { code: "contact_blocked", message: MESSAGE });
});

check("the remote transport throws it as a rejection, not as an unavailable store", async () => {
  const transport = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: (async () => new Response(JSON.stringify(body), { status: 422 })) as typeof fetch,
  });
  await assert.rejects(transport.submitOrder({ idempotencyKey: "blocked-key-0001", customer: { ...customer, phone: "+923001234567" }, lines }), (error: unknown) => {
    assert.ok(error instanceof OrderRejectedError);
    assert.equal(error.rejection.code, "contact_blocked");
    return true;
  });
});

check("the checkout failure keeps the sentence so a theme can show it as it stands", () => {
  const rejection = new OrderRejectedError({ code: "contact_blocked", message: MESSAGE });
  assert.deepEqual(toCheckoutFailure(rejection, []), { kind: "contact_blocked", message: MESSAGE });
});

check("the BFF passes the refusal on with its own code, 422, and the same sentence", async () => {
  const transport = {
    submitOrder: async () => {
      throw new OrderRejectedError({ code: "contact_blocked", message: MESSAGE });
    },
    trackOrder: async () => null,
    confirmOrder: async () => null,
  } as unknown as OrderTransport;
  const routes = createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
  const response = await routes.submit(
    new Request(SITE + "/api/storefront/orders", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "alpha.localhost:3000", "idempotency-key": "blocked-key-0001" },
      body: JSON.stringify({ customer, lines }),
    }),
    { tenantKey: "alpha", clientIp: null },
  );
  assert.equal(response.status, 422);
  const json = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(json.error.code, "CONTACT_BLOCKED");
  assert.equal(json.error.message, MESSAGE);
  assert.equal(/block|ban|fraud|risk/i.test(json.error.message), false, "it never says the contact is blocked");
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
