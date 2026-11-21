import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Sprint 6 EP-14 (S6-B4, D-118): the console's same-origin routes for subscription payments. The backend is stubbed. Only the known filters and the
// known body keys are forwarded; the payment id is the path's; the session cookie becomes a bearer on the server side only.

const ID = "65a0000000000000000e0001";
const realFetch = globalThis.fetch;

type Ctx = { params: Promise<{ id: string; action: string }> };
let listGET: (request: NextRequest) => Promise<Response>;
let actionPOST: (request: NextRequest, context: Ctx) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  listGET = (await import("../app/api/subscription-payments/route")).GET;
  actionPOST = (await import("../app/api/subscription-payments/[id]/[action]/route")).POST;
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

const ctx = (id: string, action: string): Ctx => ({ params: Promise.resolve({ id, action }) });
const COOKIE = "markaz-admin-session=tok";

function get(query: string, cookie = COOKIE): NextRequest {
  return new NextRequest("http://admin.local/api/subscription-payments" + query, { headers: cookie ? { cookie } : {} });
}

function post(action: string, body: unknown, cookie = COOKIE, id = ID): NextRequest {
  return new NextRequest("http://admin.local/api/subscription-payments/" + id + "/" + action, {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("the list forwards only status, page and limit, with the operator's token as a bearer", async () => {
  const calls = stubBackend(200, { docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 0, pendingCount: 0 });
  const res = await listGET(get("?status=claimed&page=2&limit=20&sort=amount&seller=x"));
  assert.equal(res.status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/subscription-payments?status=claimed&page=2&limit=20");
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer tok");
});

test("without the session cookie both routes answer 401 and the backend is never called", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await listGET(get("", ""))).status, 401);
  assert.equal((await actionPOST(post("confirm", { amountRs: 2500, reason: "Slip checked" }, ""), ctx(ID, "confirm"))).status, 401);
  assert.equal(calls.length, 0);
});

test("confirm forwards the amount and the reason to the payment's own backend path, and nothing else", async () => {
  const calls = stubBackend(200, { payment: { id: ID, status: "confirmed" } });
  const res = await actionPOST(post("confirm", { amountRs: 2500, reason: "Slip checked" }), ctx(ID, "confirm"));
  assert.equal(res.status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/subscription-payments/" + ID + "/confirm");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { amountRs: 2500, reason: "Slip checked" });
});

test("reject and void forward the reason only", async () => {
  for (const action of ["reject", "void"]) {
    const calls = stubBackend(200, { payment: { id: ID } });
    assert.equal((await actionPOST(post(action, { reason: "Amount does not match" }), ctx(ID, action))).status, 200);
    assert.equal(calls[0]!.url, "http://admin.test/api/admin/subscription-payments/" + ID + "/" + action);
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { reason: "Amount does not match" });
  }
});

test("a bad body never reaches the backend: a fractional or missing amount, a short reason, and any extra key (an id, a status, a seller) are 422", async () => {
  const calls = stubBackend(200, {});
  const bad: Array<[string, unknown]> = [
    ["confirm", { reason: "Slip checked" }],
    ["confirm", { amountRs: 2500 }],
    ["confirm", { amountRs: 2500.5, reason: "Slip checked" }],
    ["confirm", { amountRs: 0, reason: "Slip checked" }],
    ["confirm", { amountRs: "2500", reason: "Slip checked" }],
    ["confirm", { amountRs: 2500, reason: "ok" }],
    ["confirm", { amountRs: 2500, reason: "Slip checked", status: "confirmed" }],
    ["confirm", { amountRs: 2500, reason: "Slip checked", paymentId: ID }],
    ["reject", {}],
    ["reject", { reason: "four" }],
    ["reject", { reason: "Amount does not match", seller: "x" }],
    ["void", { reason: "x".repeat(301) }],
    ["void", { reason: "<b>wrong</b>" }],
    ["reject", []],
    ["reject", null],
  ];
  for (const [action, body] of bad) {
    const res = await actionPOST(post(action, body), ctx(ID, action));
    assert.equal(res.status, 422, action + " " + JSON.stringify(body));
    const json = (await res.json()) as { error: string; issues: unknown[] };
    assert.ok(json.error.length > 0);
  }
  assert.equal((await actionPOST(post("reject", "not json"), ctx(ID, "reject"))).status, 400);
  assert.equal(calls.length, 0);
});

test("an unknown action or a bad payment id is a 404 before anything is read", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await actionPOST(post("refund", { reason: "Amount does not match" }), ctx(ID, "refund"))).status, 404);
  assert.equal((await actionPOST(post("reject", { reason: "Amount does not match" }, COOKIE, "not-an-id"), ctx("not-an-id", "reject"))).status, 404);
  assert.equal(calls.length, 0);
});

test("a cross-site POST is refused", async () => {
  const calls = stubBackend(200, {});
  const request = new NextRequest("http://admin.local/api/subscription-payments/" + ID + "/confirm", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    body: JSON.stringify({ amountRs: 2500, reason: "Slip checked" }),
  });
  assert.equal((await actionPOST(request, ctx(ID, "confirm"))).status, 403);
  assert.equal(calls.length, 0);
});

test("the backend's own refusal keeps its status and its words: a double confirm, a stale amount, a payment that is not claimed", async () => {
  for (const [status, message] of [
    [409, "Someone else already decided this payment. Reload the list."],
    [409, "This payment is for Rs. 2,500, not Rs. 900. Reload and check the amount."],
    [409, "Only a payment the seller says they paid can be confirmed. This one is rejected."],
    [404, "Payment not found"],
    [403, "You do not have permission to perform this action"],
  ] as const) {
    stubBackend(status, { error: message });
    const res = await actionPOST(post("confirm", { amountRs: 2500, reason: "Slip checked" }), ctx(ID, "confirm"));
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { error: string }).error, message);
  }
});

test("a seller backend that is down is a 503 with its message, and an expired session clears the cookie", async () => {
  stubBackend(503, { error: "Subscription payments is unavailable" });
  assert.equal((await actionPOST(post("reject", { reason: "Amount does not match" }), ctx(ID, "reject"))).status, 503);
  stubBackend(401, { error: "Unauthorized" });
  const res = await actionPOST(post("reject", { reason: "Amount does not match" }), ctx(ID, "reject"));
  assert.equal(res.status, 401);
  assert.match(res.headers.get("set-cookie") ?? "", /markaz-admin-session=;|Max-Age=0|expires=/i);
});
