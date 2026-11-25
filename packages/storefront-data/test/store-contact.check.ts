/*
 * Sprint 7 (S7-B4): checks for the store's contact form on the storefront side: the form rules, the input the transport sends, the remote transport (path, body,
 * never retried, success ONLY on a stored answer), the BFF route (origin gate, validation, the honeypot reaches the backend, the refusals) and the sentences the shopper
 * sees. From packages/storefront-data run:
 *
 *   npx tsx test/store-contact.check.ts        (or: pnpm test, which runs every *.check.ts)
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { CONTACT_LIMITS, contactFailure, emptyContactForm, toContactInput, validateContactForm } from "../src/domain/contact";
import { OrderRejectedError, TransportUnavailableError } from "../src/transport/errors";
import { createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport, SubmitContactInput } from "../src/transport/types";

const SITE = "http://alpha.localhost:3000";
const STORE = "65a000000000000000000011";
const good = { ...emptyContactForm(), name: "Sara Khan", email: "sara@example.com", message: "Do you deliver to Quetta?", consent: true };

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

type Seen = { url: string; method: string; body: string | null };
function remote(status: number, body: unknown, attempts?: { n: number }) {
  const seen: Seen[] = [];
  const transport = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: STORE,
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      if (attempts) attempts.n += 1;
      seen.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  return { transport, seen };
}

check("a good form has no problems; every rule names its field", () => {
  assert.deepEqual(validateContactForm(good), {});
  assert.deepEqual(validateContactForm({ ...good, email: "", phone: "0300 1234567" }), {});
  assert.ok(validateContactForm({ ...good, name: "  " }).name);
  assert.ok(validateContactForm({ ...good, name: "x".repeat(CONTACT_LIMITS.name + 1) }).name);
  assert.ok(validateContactForm({ ...good, email: "not-an-email" }).email);
  assert.ok(validateContactForm({ ...good, email: "", phone: "" }).email, "neither an email nor a phone");
  assert.ok(validateContactForm({ ...good, phone: "call me" }).phone);
  assert.ok(validateContactForm({ ...good, message: "hi" }).message);
  assert.ok(validateContactForm({ ...good, message: "x".repeat(CONTACT_LIMITS.message + 1) }).message);
  assert.ok(validateContactForm({ ...good, consent: false }).consent);
});

check("the input to send is trimmed, leaves empty optional fields null, always says consent, and carries the honeypot only when it is filled", () => {
  assert.deepEqual(toContactInput({ ...good, name: "  Sara ", email: " sara@example.com ", phone: "", message: " Hello there " }), {
    name: "Sara",
    email: "sara@example.com",
    phone: null,
    message: "Hello there",
    consent: true,
    website: null,
  });
  assert.equal(toContactInput({ ...good, website: "http://spam.test" }).website, "http://spam.test");
});

check("the remote transport posts to /contact with the body, and a stored message (received: true) is a success", async () => {
  const { transport, seen } = remote(201, { data: { received: true } });
  await transport.submitContact!({ name: "Sara", email: "sara@example.com", phone: null, message: "Hello there", consent: true, website: null });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "http://seller.test/api/storefront/v1/stores/" + STORE + "/contact");
  assert.equal(seen[0]!.method, "POST");
  assert.deepEqual(JSON.parse(seen[0]!.body!), { name: "Sara", email: "sara@example.com", message: "Hello there", consent: true });
});

check("it is NEVER a success unless the backend says the message was kept: a 200 with another body, an empty body and a gateway error all reject", async () => {
  for (const [status, body] of [[200, {}], [200, { data: { received: false } }], [200, null], [502, { error: { code: "STOREFRONT_UNAVAILABLE" } }], [503, {}]] as Array<[number, unknown]>) {
    const { transport } = remote(status, body);
    await assert.rejects(() => transport.submitContact!({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), (error: unknown) => error instanceof TransportUnavailableError, status + " " + JSON.stringify(body));
  }
});

check("a write is never retried, even when the connection fails", async () => {
  const attempts = { n: 0 };
  const transport = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: STORE,
    fetchImpl: (async () => {
      attempts.n += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  });
  await assert.rejects(() => transport.submitContact!({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), (error: unknown) => error instanceof TransportUnavailableError);
  assert.equal(attempts.n, 1);
});

check("the backend's refusals are typed: a field error keeps its field, the limiter is rate_limited, an inactive store is store_inactive", async () => {
  const invalid = remote(400, { error: { code: "INVALID_REQUEST", message: "Enter a valid email address." }, field: "email" });
  await assert.rejects(() => invalid.transport.submitContact!({ name: "Sara", email: "x", message: "Hello there", consent: true }), (error: unknown) => {
    assert.ok(error instanceof OrderRejectedError);
    assert.deepEqual(error.rejection, { code: "invalid_request", message: "Enter a valid email address.", field: "email" });
    return true;
  });
  const limited = remote(429, { error: { code: "RATE_LIMITED", message: "Too many" }, retryAfterSeconds: 30 });
  await assert.rejects(() => limited.transport.submitContact!({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), (error: unknown) => error instanceof OrderRejectedError && error.rejection.code === "rate_limited");
  const inactive = remote(403, { error: { code: "STORE_NOT_ACTIVE", message: "no" } });
  await assert.rejects(() => inactive.transport.submitContact!({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), (error: unknown) => error instanceof OrderRejectedError && error.rejection.code === "store_inactive");
});

check("the shopper sees a plain sentence for each failure, never a stack or a code", () => {
  assert.match(contactFailure(new OrderRejectedError({ code: "rate_limited", retryAfterSeconds: 30 })).message, /wait a few minutes/);
  assert.equal(contactFailure(new OrderRejectedError({ code: "rate_limited", retryAfterSeconds: null })).rateLimited, true);
  assert.deepEqual(contactFailure(new OrderRejectedError({ code: "invalid_request", message: "Enter a valid email address.", field: "email" })), { message: "Enter a valid email address.", field: "email" });
  assert.match(contactFailure(new OrderRejectedError({ code: "store_inactive" })).message, /not taking messages/);
  assert.match(contactFailure(new TransportUnavailableError("network", "down")).message, /could not send/);
  assert.match(contactFailure(new Error("boom")).message, /could not send/);
});

function bff(transport: Partial<OrderTransport>) {
  return createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport: transport as OrderTransport }) });
}
const bffRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(SITE + "/api/storefront/contact", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "alpha.localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

check("the BFF route passes a good message to the transport and answers 201 received only after the transport resolved", async () => {
  const sent: SubmitContactInput[] = [];
  const routes = bff({ submitContact: async (input) => void sent.push(input) });
  const response = await routes.contact(bffRequest({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true, extra: "stripped" }), { tenantKey: "alpha", clientIp: null });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { received: true } });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { name: "Sara", email: "sara@example.com", phone: null, message: "Hello there", consent: true, website: null });
});

check("the BFF route is NOT a success when the transport fails: unavailable is 503, a refusal keeps its code", async () => {
  const down = bff({
    submitContact: async () => {
      throw new TransportUnavailableError("http", "down", 503);
    },
  });
  const response = await down.contact(bffRequest({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), { tenantKey: "alpha", clientIp: null });
  assert.equal(response.status, 503);
  const limited = bff({
    submitContact: async () => {
      throw new OrderRejectedError({ code: "rate_limited", retryAfterSeconds: 30 });
    },
  });
  assert.equal((await limited.contact(bffRequest({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), { tenantKey: "alpha", clientIp: null })).status, 429);
  const none = bff({});
  assert.equal((await none.contact(bffRequest({ name: "Sara", email: "sara@example.com", message: "Hello there", consent: true }), { tenantKey: "alpha", clientIp: null })).status, 503, "a transport with no contact method is not a success");
});

check("the BFF route forwards the honeypot (the backend answers it like a success and keeps nothing)", async () => {
  const sent: SubmitContactInput[] = [];
  const routes = bff({ submitContact: async (input) => void sent.push(input) });
  await routes.contact(bffRequest({ name: "Bot", email: "bot@example.com", message: "Buy cheap now", consent: true, website: "http://spam.test" }), { tenantKey: "alpha", clientIp: null });
  assert.equal(sent[0]!.website, "http://spam.test");
});

check("the BFF route refuses a bad body (400, no call), a foreign origin (403) and an unknown store (404)", async () => {
  let calls = 0;
  const routes = bff({ submitContact: async () => void (calls += 1) });
  const ctx = { tenantKey: "alpha", clientIp: null };
  for (const body of [{}, { name: "", email: "a@b.co", message: "Hello there", consent: true }, { name: "Sara", email: "a@b.co", message: "Hello there", consent: false }, { name: "Sara", email: "a@b.co", message: "x".repeat(3001), consent: true }]) {
    assert.equal((await routes.contact(bffRequest(body), ctx)).status, 400, JSON.stringify(body).slice(0, 50));
  }
  assert.equal((await routes.contact(bffRequest({ name: "Sara", email: "a@b.co", message: "Hello there", consent: true }, { origin: "https://evil.example" }), ctx)).status, 403);
  assert.equal((await routes.contact(bffRequest({ name: "Sara", email: "a@b.co", message: "Hello there", consent: true }), { tenantKey: null, clientIp: null })).status, 404);
  assert.equal(calls, 0);
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
