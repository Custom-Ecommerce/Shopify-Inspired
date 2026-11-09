/*
 * Checks for CO-03: a placement that gets no answer is never reported as failed. No test runner is needed. From
 * packages/storefront-data run:
 *
 *   npx tsx test/checkout-confirm.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import { isOutcomeUnknown, placeOrderWithCheck } from "../src/client/place-order";
import { createBffRoutes } from "../src/bff/handlers";
import { OrderRejectedError, OrderUnconfirmedError, TransportUnavailableError } from "../src/transport/errors";
import { createBffTransport, createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport, SubmitOrderPayload, SubmitOrderResult } from "../src/transport/types";

const payload: SubmitOrderPayload = {
  idempotencyKey: "checkout-key-0001",
  customer: { customerName: "Ali Raza", phone: "+923001234567", address: "House 1, Street 2", city: "Karachi" },
  lines: [{ productId: "65a0000000000000000000aa", qty: 2 }],
};
const placed: SubmitOrderResult = { orderId: "ORD-1", total: 2000 };
const timeout = () => new TransportUnavailableError("timeout");
const network = () => new TransportUnavailableError("network");

/** A transport whose submitOrder plays the given outcomes in turn, and records the keys it was called with. */
function scripted(outcomes: Array<SubmitOrderResult | Error>) {
  const keys: string[] = [];
  let checks = 0;
  return {
    keys,
    onChecking: () => {
      checks += 1;
    },
    checks: () => checks,
    transport: {
      submitOrder: async (input: SubmitOrderPayload) => {
        keys.push(input.idempotencyKey);
        const next = outcomes.shift();
        if (next instanceof Error) throw next;
        return next as SubmitOrderResult;
      },
    },
  };
}

const checks: Array<[string, () => Promise<void>]> = [];
const check = (name: string, run: () => Promise<void>) => checks.push([name, run]);

check("an answer the first time means no check", async () => {
  const s = scripted([placed]);
  assert.deepEqual(await placeOrderWithCheck(s.transport, payload, s.onChecking), placed);
  assert.equal(s.checks(), 0);
  assert.equal(s.keys.length, 1);
});

check("a timeout then an order is a success, using the same key", async () => {
  for (const first of [timeout(), network()]) {
    const s = scripted([first, placed]);
    assert.deepEqual(await placeOrderWithCheck(s.transport, payload, s.onChecking), placed);
    assert.equal(s.checks(), 1);
    assert.deepEqual(s.keys, [payload.idempotencyKey, payload.idempotencyKey]);
  }
});

check("a timeout then a clear refusal gives the normal failure", async () => {
  const refusal = new OrderRejectedError({ code: "out_of_stock", productId: "p1" });
  const s = scripted([timeout(), refusal]);
  await assert.rejects(placeOrderWithCheck(s.transport, payload, s.onChecking), (error) => error === refusal);
});

check("no answer on both tries is unconfirmed, which the checkout shows as its own failure", async () => {
  const s = scripted([timeout(), network()]);
  let caught: unknown;
  await placeOrderWithCheck(s.transport, payload, s.onChecking).catch((error) => (caught = error));
  assert.ok(caught instanceof OrderUnconfirmedError);
  assert.deepEqual(toCheckoutFailure(caught, []), { kind: "unconfirmed" });
  assert.equal(s.keys.length, 2);
});

check("a clear answer the first time is never re-sent", async () => {
  for (const first of [new OrderRejectedError({ code: "store_inactive" }), new TransportUnavailableError("http", "x", 500), new TransportUnavailableError("invalid_response")]) {
    const s = scripted([first]);
    await assert.rejects(placeOrderWithCheck(s.transport, payload, s.onChecking), (error) => error === first);
    assert.equal(s.checks(), 0);
    assert.equal(s.keys.length, 1);
  }
  assert.equal(isOutcomeUnknown(new TransportUnavailableError("not_implemented")), false);
});

const jsonFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(body === undefined ? "" : JSON.stringify(body), { status })) as typeof fetch;

const reason = async (fetchImpl: typeof fetch): Promise<string> => {
  try {
    await createBffTransport({ fetchImpl }).submitOrder(payload);
    return "resolved";
  } catch (error) {
    return error instanceof TransportUnavailableError ? error.reason : (error as Error).name;
  }
};

check("placement: a 5xx with no body or the BFF's unknown code is uncertain; a 5xx with a body is a clear failure", async () => {
  assert.equal(await reason(jsonFetch(502, undefined)), "network");
  assert.equal(await reason(jsonFetch(504, { error: { code: "ORDER_OUTCOME_UNKNOWN", message: "x" } })), "network");
  assert.equal(await reason(jsonFetch(503, { error: { code: "STOREFRONT_UNAVAILABLE", message: "x" } })), "http");
  assert.equal(await reason(jsonFetch(500, { error: { code: "INTERNAL_ERROR", message: "x" } })), "http");
});

/** Answers only when the request is aborted, so the timeout that fires is the one in use. */
const hangingFetch: typeof fetch = ((_url: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

check("placement has its own timeout, separate from reads", async () => {
  const started = Date.now();
  await assert.rejects(
    createRemoteTransport({ baseUrl: "http://seller.test", storeId: "s", fetchImpl: hangingFetch, timeoutMs: 60000, submitTimeoutMs: 30 }).submitOrder(payload),
    (error: unknown) => error instanceof TransportUnavailableError && error.reason === "timeout",
  );
  assert.ok(Date.now() - started < 5000, "the short submit timeout fired, not the 60 s read timeout");

  const startedRead = Date.now();
  await assert.rejects(
    createBffTransport({ fetchImpl: hangingFetch, timeoutMs: 30, submitTimeoutMs: 60000 }).lookupOrder({ orderId: "ORD-1", phone: "03001234567" }),
    (error: unknown) => error instanceof TransportUnavailableError && error.reason === "timeout",
  );
  assert.ok(Date.now() - startedRead < 5000, "reads keep their own timeout");
});

const SITE = "http://mustafa.localhost:3000";

function bffWith(error: Error) {
  const transport = {
    submitOrder: async () => {
      throw error;
    },
  } as unknown as OrderTransport;
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
}

const submitThroughBff = (error: Error) =>
  bffWith(error).submit(
    new Request(SITE + "/api/storefront/orders", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000", "idempotency-key": payload.idempotencyKey },
      body: JSON.stringify({ customer: payload.customer, lines: payload.lines }),
    }),
    { tenantKey: "mustafa", clientIp: "203.0.113.5" },
  );

check("the BFF reports a backend that never answered a placement as unknown, and other failures as before", async () => {
  for (const error of [timeout(), network()]) {
    const response = await submitThroughBff(error);
    assert.equal(response.status, 504);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "ORDER_OUTCOME_UNKNOWN");
  }
  const http = await submitThroughBff(new TransportUnavailableError("http", "x", 500));
  assert.equal(http.status, 503);
});

// AbortSignal.timeout timers do not keep Node alive, so without this the process would end, status 0, in the middle of a check.
const keepAlive = setInterval(() => undefined, 1000);

void (async () => {
  for (const [name, run] of checks) {
    await run();
    console.log("ok - " + name);
  }
  console.log(checks.length + " checks passed");
  clearInterval(keepAlive);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
