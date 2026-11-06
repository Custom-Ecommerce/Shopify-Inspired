import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const OID = "65a000000000000000000001";
const USER = { id: OID, name: "Op Erator", email: "op@example.com", role: "admin", store: null };

let GET: (request: NextRequest) => Promise<Response>;
const realFetch = globalThis.fetch;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  GET = (await import("../app/api/me/route")).GET;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubBackend(status: number, payload: unknown): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function meRequest(cookie?: string): NextRequest {
  return new NextRequest("http://admin.local/api/me", { headers: cookie ? { cookie } : {} });
}

test("no cookie is 401 and the backend is not called", async () => {
  const calls = stubBackend(200, { user: USER });
  assert.equal((await GET(meRequest())).status, 401);
  assert.equal(calls.length, 0);
});

test("a valid session returns the operator and sends the token as a bearer", async () => {
  const calls = stubBackend(200, { user: USER });
  const response = await GET(meRequest("markaz-admin-session=tok"));
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { user: { id: string } }).user.id, OID);
  assert.equal(calls[0].url, "http://admin.test/api/admin/me");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
});

test("a session the backend refuses is 401 and the cookie is cleared", async () => {
  stubBackend(401, { error: "Invalid or expired session" });
  const response = await GET(meRequest("markaz-admin-session=stale"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("an unavailable backend is 503 and the cookie is kept", async () => {
  stubBackend(500, { error: "boom" });
  const response = await GET(meRequest("markaz-admin-session=tok"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a backend answer for a non-admin account is treated as unauthorized", async () => {
  stubBackend(200, { user: { ...USER, role: "seller" } });
  assert.equal((await GET(meRequest("markaz-admin-session=tok"))).status, 401);
});
