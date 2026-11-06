import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const ID = "65a000000000000000000010";
const realFetch = globalThis.fetch;

let listGET: (request: NextRequest) => Promise<Response>;
let detailGET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let statusPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  listGET = (await import("../app/api/stores/route")).GET;
  detailGET = (await import("../app/api/stores/[id]/route")).GET;
  statusPOST = (await import("../app/api/stores/[id]/status/route")).POST;
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

function get(path: string, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local" + path, { headers: cookie ? { cookie } : {} });
}

function post(body: unknown, headers: Record<string, string> = {}, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local/api/stores/" + ID + "/status", {
    method: "POST",
    headers: { "content-type": "application/json", host: "admin.local", ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const bearer = (call: Call) => (call.init?.headers as Record<string, string>).authorization;

test("the list needs the cookie and does not call the backend without it", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await listGET(get("/api/stores", ""))).status, 401);
  assert.equal(calls.length, 0);
});

test("the list forwards only known parameters, with the token as a bearer", async () => {
  const calls = stubBackend(200, { docs: [], totalDocs: 0, totalPages: 0, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false });
  const response = await listGET(get("/api/stores?page=2&q=looms&status=active&limit=20&evil=1&$where=x"));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/stores?page=2&limit=20&q=looms&status=active");
  assert.equal(bearer(calls[0]), "Bearer tok");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a session the backend refuses is 401 and clears the cookie", async () => {
  stubBackend(401, { error: "Invalid or expired session" });
  const response = await listGET(get("/api/stores"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("set-cookie") ?? "", /markaz-admin-session=;.*Max-Age=0|Max-Age=0/);
});

test("an unreachable backend is 503 and the cookie is kept", async () => {
  process.env.ADMIN_BACKEND_API_URL = "";
  const response = await listGET(get("/api/stores"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a backend validation error is passed on with its issues, and an unexpected failure is 502", async () => {
  stubBackend(422, { error: "Invalid request", issues: [{ path: "status", message: "bad" }] });
  const refused = await listGET(get("/api/stores?status=zzz"));
  assert.equal(refused.status, 422);
  assert.deepEqual(((await refused.json()) as { issues: unknown[] }).issues, [{ path: "status", message: "bad" }]);

  stubBackend(500, { error: "Internal error" });
  assert.equal((await listGET(get("/api/stores"))).status, 502);
});

test("the detail answers 404 for a malformed id without calling the backend, and forwards a good id", async () => {
  const calls = stubBackend(200, { store: {} });
  assert.equal((await detailGET(get("/api/stores/nope"), ctx("nope"))).status, 404);
  assert.equal(calls.length, 0);
  await detailGET(get("/api/stores/" + ID), ctx(ID));
  assert.equal(calls[0].url, "http://admin.test/api/admin/stores/" + ID);
});

test("the status change is refused without a reason before the backend is called", async () => {
  const calls = stubBackend(200, {});
  const response = await statusPOST(post({ status: "suspended" }), ctx(ID));
  assert.equal(response.status, 422);
  assert.equal(calls.length, 0);
  assert.equal((await statusPOST(post({ status: "archived", reason: "because" }), ctx(ID))).status, 422);
  assert.equal((await statusPOST(post("not json"), ctx(ID))).status, 400);
});

test("a valid status change is forwarded as signed-in POST with the cleaned body", async () => {
  const calls = stubBackend(200, { store: { id: ID }, queued: null });
  const response = await statusPOST(post({ status: "suspended", reason: "  policy breach  ", extra: "dropped" }), ctx(ID));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/stores/" + ID + "/status");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { status: "suspended", reason: "policy breach" });
  assert.equal(bearer(calls[0]), "Bearer tok");
});

test("a status change from another origin, or without the cookie, is refused", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await statusPOST(post({ status: "suspended", reason: "policy" }, { origin: "http://evil.example" }), ctx(ID))).status, 403);
  assert.equal((await statusPOST(post({ status: "suspended", reason: "policy" }, {}, ""), ctx(ID))).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await statusPOST(post({ status: "suspended", reason: "policy" }, { origin: "http://admin.local" }), ctx(ID))).status, 200);
});

test("a conflict from the backend reaches the browser as 409 with its message", async () => {
  stubBackend(409, { error: "The store was changed by someone else. Reload and try again." });
  const response = await statusPOST(post({ status: "suspended", reason: "policy" }), ctx(ID));
  assert.equal(response.status, 409);
  assert.match(((await response.json()) as { error: string }).error, /changed by someone else/);
});
