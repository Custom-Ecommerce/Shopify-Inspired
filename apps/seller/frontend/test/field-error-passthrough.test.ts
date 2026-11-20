import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxyGet } from "../lib/proxy";

// Sprint 4 SB-5 B6: the BFF keeps the backend's field name and message on a 400, so a form can mark the field.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a 400 { error, code, field } from the backend reaches the browser with its field", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "the delivery rate cannot be negative", code: "STORE_SETTINGS_INVALID", field: "delivery.defaultRate" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const res = await proxyGet(new NextRequest("http://seller.test/api/proxy/x"), "/api/stores/1", { auth: "none" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; code: string; field?: string };
  assert.equal(body.field, "delivery.defaultRate");
  assert.equal(body.code, "STORE_SETTINGS_INVALID");
  assert.match(body.error, /negative/);
});

// SB-11 (V-06): the refusal for card only on a theme without card checkout is a 422 and keeps its code and field too.
test("a 422 CARD_CHECKOUT_UNSUPPORTED_BY_THEME from the backend reaches the browser with its code and field", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "This theme cannot take card payments yet." }], code: "CARD_CHECKOUT_UNSUPPORTED_BY_THEME", field: "payments.codEnabled" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const res = await proxyGet(new NextRequest("http://seller.test/api/proxy/x"), "/api/stores/1", { auth: "none" });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: string; code: string; field?: string };
  assert.equal(body.code, "CARD_CHECKOUT_UNSUPPORTED_BY_THEME");
  assert.equal(body.field, "payments.codEnabled");
  assert.match(body.error, /card payments/);
});
