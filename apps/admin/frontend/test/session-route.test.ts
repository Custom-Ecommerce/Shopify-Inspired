import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";

const OID = "65a000000000000000000001";
const USER = { id: OID, name: "Op Erator", email: "op@example.com", role: "admin", store: null };

let POST: (request: Request) => Promise<Response>;
let DELETE: (request: Request) => Promise<Response>;
const realFetch = globalThis.fetch;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  const route = await import("../app/api/session/route");
  POST = route.POST;
  DELETE = route.DELETE;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});

function stubBackend(status: number, payload: unknown): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function loginRequest(payload: unknown): Request {
  return new Request("http://admin.local/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const VALID = { email: "op@example.com", password: "a-password" };

test("a successful sign-in sets an HttpOnly cookie and never returns the token in the body", async () => {
  const calls = stubBackend(200, { token: "tok.en.value", user: USER });
  const response = await POST(loginRequest(VALID));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /markaz-admin-session=tok\.en\.value/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=28800/);
  const text = await response.text();
  assert.equal(text.includes("tok.en.value"), false);
  assert.equal((JSON.parse(text) as { user: { id: string } }).user.id, OID);
  assert.equal(calls[0].url, "http://admin.test/api/admin/session");
  assert.equal(calls[0].init?.method, "POST");
});

test("a refused sign-in passes its status through and sets no cookie", async () => {
  stubBackend(401, { error: "Invalid email or password" });
  const response = await POST(loginRequest(VALID));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(((await response.json()) as { error: string }).error, "Invalid email or password");
});

test("a locked account is reported as 423", async () => {
  stubBackend(423, { error: "Account is temporarily locked. Try again later." });
  assert.equal((await POST(loginRequest(VALID))).status, 423);
});

test("an invalid body is refused with 422 and the backend is not called", async () => {
  const calls = stubBackend(200, {});
  const response = await POST(loginRequest({ email: "nope", password: "" }));
  assert.equal(response.status, 422);
  assert.equal(calls.length, 0);
});

test("a body that is not JSON is refused with 400", async () => {
  stubBackend(200, {});
  assert.equal((await POST(loginRequest("not json"))).status, 400);
});

test("an unreachable backend is 503", async () => {
  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  assert.equal((await POST(loginRequest(VALID))).status, 503);
});

test("a missing backend address is 503 and nothing is sent", async () => {
  const calls = stubBackend(200, {});
  delete process.env.ADMIN_BACKEND_API_URL;
  assert.equal((await POST(loginRequest(VALID))).status, 503);
  assert.equal(calls.length, 0);
});

test("a backend that returns a seller account is refused with 502 and no cookie", async () => {
  stubBackend(200, { token: "tok", user: { ...USER, role: "seller" } });
  const response = await POST(loginRequest(VALID));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a malformed backend answer is 502", async () => {
  stubBackend(200, { nothing: true });
  assert.equal((await POST(loginRequest(VALID))).status, 502);
});

test("signing out clears the cookie", async () => {
  const response = await DELETE(new Request("http://localhost/api/session", { method: "DELETE" }));
  assert.equal(response.status, 204);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /markaz-admin-session=;/);
  assert.match(cookie, /Max-Age=0/);
});