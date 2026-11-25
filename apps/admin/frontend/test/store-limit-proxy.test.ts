import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ApiError, getSellerStoreLimit, setSellerStoreLimit } from "../lib/api/client";

// Sprint 6 EP-12.US02.T02, T03: the same-origin proxy and the client of the Store limit dialog. The backend is stubbed.

const ID = "65a000000000000000000001";
const realFetch = globalThis.fetch;

let limitGET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let limitPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  const route = await import("../app/api/sellers/[id]/store-limit/route");
  limitGET = route.GET;
  limitPOST = route.POST;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});

type Call = { url: string; init: RequestInit | undefined };

function stubBackend(status: number, payload: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, id: string, body?: unknown, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local/api/sellers/" + id + "/store-limit", {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("GET forwards to the backend with the token as a bearer, and a bad id never reaches it", async () => {
  const calls = stubBackend(200, { seller: {} });
  const response = await limitGET(req("GET", ID), ctx(ID));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/sellers/" + ID + "/store-limit");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.equal((await limitGET(req("GET", "not-an-id"), ctx("not-an-id"))).status, 404);
  assert.equal(calls.length, 1);
});

test("both methods need the session cookie, and the backend is not called without it", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await limitGET(req("GET", ID, undefined, ""), ctx(ID))).status, 401);
  assert.equal((await limitPOST(req("POST", ID, { storeLimitOverride: 5, reason: "Agency account" }, ""), ctx(ID))).status, 401);
  assert.equal(calls.length, 0);
});

test("POST is validated here: a bad body never reaches the backend", async () => {
  const calls = stubBackend(200, {});
  const bad: unknown[] = [
    {},
    { storeLimitOverride: 5 },
    { reason: "Agency account" },
    { storeLimitOverride: 0, reason: "Agency account" },
    { storeLimitOverride: 2.5, reason: "Agency account" },
    { storeLimitOverride: 1001, reason: "Agency account" },
    { storeLimitOverride: "5", reason: "Agency account" },
    { storeLimitOverride: 5, reason: "no" },
    { storeLimitOverride: 5, reason: "x".repeat(301) },
    { storeLimitOverride: 5, reason: "Agency account", role: "admin" },
  ];
  for (const body of bad) {
    const response = await limitPOST(req("POST", ID, body), ctx(ID));
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.ok(Array.isArray(((await response.json()) as { issues: unknown[] }).issues));
  }
  assert.equal((await limitPOST(req("POST", ID, "not json"), ctx(ID))).status, 400);
  assert.equal((await limitPOST(req("POST", "not-an-id", { storeLimitOverride: 5, reason: "Agency account" }), ctx("not-an-id"))).status, 404);
  assert.equal(calls.length, 0);
});

test("POST forwards only the checked body, with the reason trimmed, and a null clears", async () => {
  const calls = stubBackend(200, { seller: { id: ID, storeLimitOverride: 5, changed: true } });
  const set = await limitPOST(req("POST", ID, { storeLimitOverride: 5, reason: "  Agency account  " }), ctx(ID));
  assert.equal(set.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/sellers/" + ID + "/store-limit");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { storeLimitOverride: 5, reason: "Agency account" });
  await limitPOST(req("POST", ID, { storeLimitOverride: null, reason: "Back to the plan" }), ctx(ID));
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { storeLimitOverride: null, reason: "Back to the plan" });
});

// ---------------------------------------------------------------------------------------------------------------- the client

const limitAnswer = {
  seller: { id: ID, name: "Ayesha", email: "ayesha@example.com", storeLimitOverride: null, effectiveLimit: 3, source: "env", storesUsed: 1, planLimit: null, platformMax: null, envMax: 3 },
};

test("getSellerStoreLimit calls the same-origin proxy and returns the validated answer", async () => {
  const calls = stubBackend(200, limitAnswer);
  const result = await getSellerStoreLimit(ID);
  assert.equal(calls[0].url, "/api/sellers/" + ID + "/store-limit");
  assert.equal(result.seller.effectiveLimit, 3);
  assert.equal(result.seller.source, "env");
});

test("an answer that breaks the contract is refused, not shown", async () => {
  stubBackend(200, { seller: { ...limitAnswer.seller, source: "magic" } });
  await assert.rejects(getSellerStoreLimit(ID), (err: unknown) => err instanceof ApiError && err.status === 502);
  stubBackend(200, { seller: { ...limitAnswer.seller, effectiveLimit: 0 } });
  await assert.rejects(getSellerStoreLimit(ID), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("setSellerStoreLimit posts the body and returns the seller with changed", async () => {
  const calls = stubBackend(200, { seller: { id: ID, storeLimitOverride: 5, changed: true } });
  const result = await setSellerStoreLimit(ID, { storeLimitOverride: 5, reason: "Agency account" });
  assert.equal(calls[0].url, "/api/sellers/" + ID + "/store-limit");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { storeLimitOverride: 5, reason: "Agency account" });
  assert.deepEqual(result.seller, { id: ID, storeLimitOverride: 5, changed: true });
});

test("a refusal from the backend keeps its status and message", async () => {
  stubBackend(403, { error: "Forbidden" });
  await assert.rejects(setSellerStoreLimit(ID, { storeLimitOverride: 5, reason: "Agency account" }), (err: unknown) => err instanceof ApiError && err.status === 403 && err.message === "Forbidden");
  stubBackend(409, { error: "The store limit was changed by someone else. Reload and try again." });
  await assert.rejects(setSellerStoreLimit(ID, { storeLimitOverride: 5, reason: "Agency account" }), (err: unknown) => err instanceof ApiError && err.status === 409);
});
