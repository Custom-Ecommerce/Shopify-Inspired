import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const realFetch = globalThis.fetch;

let sellersGET: (request: NextRequest) => Promise<Response>;
let syncGET: (request: NextRequest) => Promise<Response>;
let auditGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  sellersGET = (await import("../app/api/sellers/route")).GET;
  syncGET = (await import("../app/api/sync/outbox/route")).GET;
  auditGET = (await import("../app/api/audit/route")).GET;
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

const bearer = (call: Call) => (call.init?.headers as Record<string, string>).authorization;

const ROUTES: Array<[string, string, string, () => (request: NextRequest) => Promise<Response>]> = [
  ["sellers", "/api/sellers", "/api/admin/sellers", () => sellersGET],
  ["sync outbox", "/api/sync/outbox", "/api/admin/sync/outbox", () => syncGET],
  ["audit", "/api/audit", "/api/admin/audit", () => auditGET],
];

for (const [name, path, backendPath, handler] of ROUTES) {
  test(name + ": the cookie is required, and the backend is not called without it", async () => {
    const calls = stubBackend(200, {});
    assert.equal((await handler()(get(path, ""))).status, 401);
    assert.equal(calls.length, 0);
  });

  test(name + ": a session the backend refuses is 401 and clears the cookie; an unreachable backend is 503", async () => {
    stubBackend(401, { error: "Invalid or expired session" });
    const refused = await handler()(get(path));
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get("set-cookie") ?? "", /Max-Age=0/);
    process.env.ADMIN_BACKEND_API_URL = "";
    const down = await handler()(get(path));
    assert.equal(down.status, 503);
    assert.equal(down.headers.get("set-cookie"), null);
  });

  test(name + ": a backend validation error is passed on with its issues, and an unexpected failure is 502", async () => {
    stubBackend(422, { error: "Invalid request", issues: [{ path: "page", message: "bad" }] });
    const refused = await handler()(get(path + "?page=0"));
    assert.equal(refused.status, 422);
    assert.deepEqual(((await refused.json()) as { issues: unknown[] }).issues, [{ path: "page", message: "bad" }]);
    stubBackend(500, { error: "Internal error" });
    assert.equal((await handler()(get(path))).status, 502);
    assert.equal(backendPath.startsWith("/api/admin/"), true);
  });
}

test("the seller list forwards only page, limit, and q, with the token as a bearer", async () => {
  const calls = stubBackend(200, { docs: [] });
  const response = await sellersGET(get("/api/sellers?page=2&q=aisha&limit=20&status=x&evil=1&$where=x"));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/sellers?page=2&limit=20&q=aisha");
  assert.equal(bearer(calls[0]), "Bearer tok");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the sync outbox forwards only page, limit, and status, and the bare path when there is no query", async () => {
  const calls = stubBackend(200, {});
  await syncGET(get("/api/sync/outbox?status=pending&q=x&page=3"));
  assert.equal(calls[0].url, "http://admin.test/api/admin/sync/outbox?page=3&status=pending");
  await syncGET(get("/api/sync/outbox"));
  assert.equal(calls[1].url, "http://admin.test/api/admin/sync/outbox");
});

test("the audit log forwards only page, limit, q, and action", async () => {
  const calls = stubBackend(200, {});
  await auditGET(get("/api/audit?action=store.suspend&q=65a000000000000000000010&page=2&status=x&evil=1"));
  assert.equal(calls[0].url, "http://admin.test/api/admin/audit?page=2&q=65a000000000000000000010&action=store.suspend");
});
