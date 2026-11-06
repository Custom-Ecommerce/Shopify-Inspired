import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const realFetch = globalThis.fetch;

let overviewGET: (request: NextRequest) => Promise<Response>;
let overviewRoute: Record<string, unknown>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  overviewRoute = (await import("../app/api/overview/route")) as Record<string, unknown>;
  overviewGET = overviewRoute.GET as typeof overviewGET;
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

function req(path: string, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local" + path, { method: "GET", headers: cookie ? { cookie } : {} });
}

test("GET forwards to the backend with the token as a bearer and passes no query on", async () => {
  const calls = stubBackend(200, { stores: { total: 1 } });
  const response = await overviewGET(req("/api/overview?evil=1&$where=x"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls[0].url, "http://admin.test/api/admin/overview");
  assert.equal(calls[0].init?.method ?? "GET", "GET");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.deepEqual(await response.json(), { stores: { total: 1 } });
});

test("the route needs the cookie, and the backend is not called without it", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await overviewGET(req("/api/overview", ""))).status, 401);
  assert.equal(calls.length, 0);
});

test("the overview is read only: the route exports GET and nothing that writes", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(overviewRoute[method], undefined, method);
});

test("a refused session clears the cookie, a refused permission is 403, and an unavailable backend is 503", async () => {
  stubBackend(401, { error: "Invalid or expired session" });
  const refused = await overviewGET(req("/api/overview"));
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get("set-cookie") ?? "", /Max-Age=0/);
  stubBackend(403, { error: "Forbidden" });
  assert.equal((await overviewGET(req("/api/overview"))).status, 403);
  stubBackend(503, { error: "Database unavailable" });
  assert.equal((await overviewGET(req("/api/overview"))).status, 503);
});

test("a backend failure is 502, and an answer that is not JSON is 502", async () => {
  stubBackend(500, { error: "Internal error" });
  assert.equal((await overviewGET(req("/api/overview"))).status, 502);
  globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  assert.equal((await overviewGET(req("/api/overview"))).status, 502);
});
