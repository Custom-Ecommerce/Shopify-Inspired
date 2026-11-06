import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const realFetch = globalThis.fetch;
const ID = "65a000000000000000000001";

let listGET: (request: NextRequest) => Promise<Response>;
let listPOST: (request: NextRequest) => Promise<Response>;
let itemPATCH: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let itemDELETE: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  const list = await import("../app/api/categories/route");
  const item = await import("../app/api/categories/[id]/route");
  listGET = list.GET;
  listPOST = list.POST;
  itemPATCH = item.PATCH;
  itemDELETE = item.DELETE;
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

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local" + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

test("the list forwards only page, limit, and q, with the token as a bearer", async () => {
  const calls = stubBackend(200, { docs: [] });
  const response = await listGET(req("GET", "/api/categories?page=2&q=lawn&limit=20&evil=1&$where=x"));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/categories?page=2&limit=20&q=lawn");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
});

test("every method needs the cookie, and the backend is not called without it", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await listGET(req("GET", "/api/categories", undefined, {}, ""))).status, 401);
  assert.equal((await listPOST(req("POST", "/api/categories", { name: "A" }, {}, ""))).status, 401);
  assert.equal((await itemPATCH(req("PATCH", "/api/categories/" + ID, { order: 1 }, {}, ""), ctx())).status, 401);
  assert.equal((await itemDELETE(req("DELETE", "/api/categories/" + ID, undefined, {}, ""), ctx())).status, 401);
  assert.equal(calls.length, 0);
});

test("create is validated here: a bad body never reaches the backend", async () => {
  const calls = stubBackend(200, {});
  const bad = await listPOST(req("POST", "/api/categories", { name: "" }));
  assert.equal(bad.status, 422);
  assert.ok(Array.isArray(((await bad.json()) as { issues: unknown[] }).issues));
  assert.equal((await listPOST(req("POST", "/api/categories", "not json"))).status, 400);
  assert.equal(calls.length, 0);
});

test("create forwards the checked body as a POST", async () => {
  const calls = stubBackend(201, { category: { id: ID } });
  const response = await listPOST(req("POST", "/api/categories", { name: "Lawn", order: 2 }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/categories");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: "Lawn", order: 2 });
});

test("update and delete refuse a bad id before calling the backend", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await itemPATCH(req("PATCH", "/api/categories/nope", { order: 1 }), ctx("nope"))).status, 404);
  assert.equal((await itemDELETE(req("DELETE", "/api/categories/nope"), ctx("nope"))).status, 404);
  assert.equal((await itemPATCH(req("PATCH", "/api/categories/" + ID, {}), ctx())).status, 422);
  assert.equal(calls.length, 0);
});

test("update forwards a PATCH and delete forwards a DELETE", async () => {
  const calls = stubBackend(200, { ok: true });
  assert.equal((await itemPATCH(req("PATCH", "/api/categories/" + ID, { slug: "lawn-2" }), ctx())).status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/categories/" + ID);
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal((await itemDELETE(req("DELETE", "/api/categories/" + ID), ctx())).status, 200);
  assert.equal(calls[1].init?.method, "DELETE");
});

test("a write from another origin is refused without calling the backend", async () => {
  const calls = stubBackend(200, {});
  const headers = { origin: "http://evil.example" };
  assert.equal((await listPOST(req("POST", "/api/categories", { name: "A" }, headers))).status, 403);
  assert.equal((await itemPATCH(req("PATCH", "/api/categories/" + ID, { order: 1 }, headers), ctx())).status, 403);
  assert.equal((await itemDELETE(req("DELETE", "/api/categories/" + ID, undefined, headers), ctx())).status, 403);
  assert.equal(calls.length, 0);
});

test("a slug clash is passed on as 409, a refused session clears the cookie, and a failure is 502", async () => {
  stubBackend(409, { error: "Another category already uses that slug." });
  const clash = await listPOST(req("POST", "/api/categories", { name: "Lawn" }));
  assert.equal(clash.status, 409);
  assert.equal(((await clash.json()) as { error: string }).error, "Another category already uses that slug.");
  stubBackend(401, { error: "Invalid or expired session" });
  const refused = await itemDELETE(req("DELETE", "/api/categories/" + ID), ctx());
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get("set-cookie") ?? "", /Max-Age=0/);
  stubBackend(500, { error: "Internal error" });
  assert.equal((await itemDELETE(req("DELETE", "/api/categories/" + ID), ctx())).status, 502);
});
