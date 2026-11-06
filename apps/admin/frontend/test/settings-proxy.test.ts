import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const realFetch = globalThis.fetch;

let settingsGET: (request: NextRequest) => Promise<Response>;
let settingsPATCH: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  const route = await import("../app/api/settings/route");
  settingsGET = route.GET;
  settingsPATCH = route.PATCH;
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

test("GET forwards to the backend with the token as a bearer and passes no query on", async () => {
  const calls = stubBackend(200, { settings: { defaultCommissionRate: 4 } });
  const response = await settingsGET(req("GET", "/api/settings?evil=1&$where=x"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls[0].url, "http://admin.test/api/admin/settings");
  assert.equal((calls[0].init?.method ?? "GET"), "GET");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
});

test("both methods need the cookie, and the backend is not called without it", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await settingsGET(req("GET", "/api/settings", undefined, {}, ""))).status, 401);
  assert.equal((await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5 }, {}, ""))).status, 401);
  assert.equal(calls.length, 0);
});

test("PATCH is validated here: a bad body never reaches the backend", async () => {
  const calls = stubBackend(200, {});
  const bad: unknown[] = [
    {},
    { reason: "because" },
    { defaultCommissionRate: -1 },
    { defaultCommissionRate: 101 },
    { defaultCommissionRate: "5" },
    { maxStoresPerSeller: 0 },
    { maxStoresPerSeller: 1001 },
    { maxStoresPerSeller: 2.5 },
    { stripeCommissionNote: "x".repeat(501) },
    { defaultCommissionRate: 5, reason: "   " },
    { defaultCommissionRate: 5, settingsRevision: 9 },
    { defaultCommissionRate: 5, updatedAt: "2026-10-11T10:00:00.000Z" },
  ];
  for (const body of bad) {
    const response = await settingsPATCH(req("PATCH", "/api/settings", body));
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.ok(Array.isArray(((await response.json()) as { issues: unknown[] }).issues));
  }
  assert.equal((await settingsPATCH(req("PATCH", "/api/settings", "not json"))).status, 400);
  assert.equal(calls.length, 0);
});

test("PATCH forwards the checked body as a PATCH, with the note and reason trimmed", async () => {
  const calls = stubBackend(200, { settings: {}, queued: null });
  const response = await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5, stripeCommissionNote: "  Fees  ", reason: "  Q4 pricing  " }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/settings");
  assert.equal(calls[0].init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { defaultCommissionRate: 5, stripeCommissionNote: "Fees", reason: "Q4 pricing" });
});

test("a note cleared with null is forwarded as null", async () => {
  const calls = stubBackend(200, { settings: {}, queued: null });
  assert.equal((await settingsPATCH(req("PATCH", "/api/settings", { stripeCommissionNote: null }))).status, 200);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { stripeCommissionNote: null });
});

test("a write from another origin is refused without calling the backend", async () => {
  const calls = stubBackend(200, {});
  const response = await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5 }, { origin: "http://evil.example" }));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("a revision clash is passed on as 409 and a missing settings document as 404", async () => {
  stubBackend(409, { error: "The settings were changed by someone else. Reload and try again." });
  const clash = await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5 }));
  assert.equal(clash.status, 409);
  assert.equal(((await clash.json()) as { error: string }).error, "The settings were changed by someone else. Reload and try again.");
  stubBackend(404, { error: "Platform settings have not been set up" });
  const missing = await settingsGET(req("GET", "/api/settings"));
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: string }).error, "Platform settings have not been set up");
});

test("the backend's validation issues are passed on with a 422", async () => {
  stubBackend(422, { error: "Invalid request", issues: [{ path: "defaultCommissionRate", message: "must be a number from 0 to 100" }] });
  const response = await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5 }));
  assert.equal(response.status, 422);
  assert.deepEqual(((await response.json()) as { issues: unknown[] }).issues, [{ path: "defaultCommissionRate", message: "must be a number from 0 to 100" }]);
});

test("a refused session clears the cookie, a refused permission is 403, and a backend failure is 502", async () => {
  stubBackend(401, { error: "Invalid or expired session" });
  const refused = await settingsGET(req("GET", "/api/settings"));
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get("set-cookie") ?? "", /Max-Age=0/);
  stubBackend(403, { error: "Forbidden" });
  assert.equal((await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5 }))).status, 403);
  stubBackend(500, { error: "Internal error" });
  assert.equal((await settingsPATCH(req("PATCH", "/api/settings", { defaultCommissionRate: 5 }))).status, 502);
  assert.equal((await settingsGET(req("GET", "/api/settings"))).status, 502);
});
