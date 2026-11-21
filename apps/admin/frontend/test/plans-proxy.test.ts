import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ApiError, archivePlan, createPlan, updatePlan } from "../lib/api/client";

// Sprint 6 EP-14.US01: the same-origin proxy routes and the client of the plan screens. The backend is stubbed.

const ID = "65a0000000000000000000c1";
const realFetch = globalThis.fetch;
const NOW = "2026-11-20T10:00:00.000Z";

type Ctx = { params: Promise<{ id: string }> };
let listPOST: (request: NextRequest) => Promise<Response>;
let onePATCH: (request: NextRequest, context: Ctx) => Promise<Response>;
let archivePOST: (request: NextRequest, context: Ctx) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  listPOST = (await import("../app/api/subscription-plans/route")).POST;
  onePATCH = (await import("../app/api/subscription-plans/[id]/route")).PATCH;
  archivePOST = (await import("../app/api/subscription-plans/[id]/archive/route")).POST;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});

type Call = { url: string; init: RequestInit | undefined };

function stub(status: number, payload: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });

function req(method: string, path: string, body?: unknown, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local" + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const limits = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true };
const create = { key: "growth", name: "Growth", priceRs: 2500, limits, features: ["Premium themes"], sortOrder: 2, reason: "Launch plan" };
const planRow = { id: ID, key: "growth", name: "Growth", priceRs: 2500, interval: "month", limits, features: [], isActive: true, sortOrder: 2, stripePriceId: null, tier: null, revision: 0, archivedAt: null, createdAt: NOW, updatedAt: NOW };

test("POST create forwards the checked body with the session; a fractional price, no reason or an unknown field never reach the backend", async () => {
  const calls = stub(201, { plan: planRow });
  const ok = await listPOST(req("POST", "/api/subscription-plans", { ...create, name: "  Growth  " }));
  assert.equal(ok.status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/subscription-plans");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).name, "Growth");

  for (const bad of [{ ...create, priceRs: 2500.5 }, { ...create, reason: "" }, { ...create, key: "Bad Key" }, { ...create, isActive: false }, { ...create, limits: { ...limits, stores: 0 } }, {}]) {
    const response = await listPOST(req("POST", "/api/subscription-plans", bad));
    assert.equal(response.status, 422, JSON.stringify(bad));
    assert.ok(Array.isArray(((await response.json()) as { issues: unknown[] }).issues));
  }
  assert.equal((await listPOST(req("POST", "/api/subscription-plans", "not json"))).status, 400);
  assert.equal(calls.length, 1);
});

test("every write needs the session cookie, and the backend is not called without it", async () => {
  const calls = stub(200, {});
  assert.equal((await listPOST(req("POST", "/api/subscription-plans", create, ""))).status, 401);
  assert.equal((await onePATCH(req("PATCH", "/api/subscription-plans/" + ID, { revision: 1, name: "X Plan", reason: "Rename" }, ""), ctx(ID))).status, 401);
  assert.equal((await archivePOST(req("POST", "/api/subscription-plans/" + ID + "/archive", { revision: 1, reason: "Retired" }, ""), ctx(ID))).status, 401);
  assert.equal(calls.length, 0);
});

test("PATCH forwards the checked update to the plan's own path; bad bodies and a bad id are refused here", async () => {
  const calls = stub(200, { plan: { ...planRow, revision: 1 } });
  const ok = await onePATCH(req("PATCH", "/api/subscription-plans/" + ID, { revision: 0, priceRs: 3000, reason: "Price rise" }), ctx(ID));
  assert.equal(ok.status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/subscription-plans/" + ID);
  assert.equal(calls[0]!.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { revision: 0, priceRs: 3000, reason: "Price rise" });

  for (const bad of [{ revision: 0, reason: "Nothing changes" }, { priceRs: 3000, reason: "No revision" }, { revision: 0, key: "other", reason: "Rekey" }, { revision: 0, priceRs: 1.5, reason: "Fraction" }]) {
    assert.equal((await onePATCH(req("PATCH", "/api/subscription-plans/" + ID, bad), ctx(ID))).status, 422, JSON.stringify(bad));
  }
  assert.equal((await onePATCH(req("PATCH", "/api/subscription-plans/nope", { revision: 0, name: "Ghost", reason: "Missing" }), ctx("nope"))).status, 404);
  assert.equal(calls.length, 1);
});

test("archive forwards only { revision, reason } to the archive path, and there is no delete route", async () => {
  const calls = stub(200, { plan: { ...planRow, isActive: false } });
  const ok = await archivePOST(req("POST", "/api/subscription-plans/" + ID + "/archive", { revision: 2, reason: " Retired " }), ctx(ID));
  assert.equal(ok.status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/subscription-plans/" + ID + "/archive");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { revision: 2, reason: "Retired" });
  assert.equal((await archivePOST(req("POST", "/api/subscription-plans/" + ID + "/archive", { revision: 2 }), ctx(ID))).status, 422);
  assert.equal((await archivePOST(req("POST", "/api/subscription-plans/" + ID + "/archive", { revision: 2, reason: "Retired", hard: true }), ctx(ID))).status, 422);
  assert.equal((await archivePOST(req("POST", "/api/subscription-plans/nope/archive", { revision: 2, reason: "Retired" }), ctx("nope"))).status, 404);
  const files = [await import("../app/api/subscription-plans/route"), await import("../app/api/subscription-plans/[id]/route"), await import("../app/api/subscription-plans/[id]/archive/route")];
  for (const file of files) assert.equal("DELETE" in file, false);
});

test("a conflict from the backend keeps its status and message", async () => {
  stub(409, { error: "A plan with this key already exists." });
  const response = await listPOST(req("POST", "/api/subscription-plans", create));
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { error: string }).error, "A plan with this key already exists.");
});

// ---------------------------------------------------------------------------------------------------------------- the client

test("createPlan, updatePlan and archivePlan call the proxy and return the validated plan", async () => {
  let calls = stub(200, { plan: planRow });
  const created = await createPlan(create);
  assert.equal(calls[0]!.url, "/api/subscription-plans");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(created.plan.key, "growth");

  calls = stub(200, { plan: { ...planRow, revision: 1 } });
  const updated = await updatePlan(ID, { revision: 0, priceRs: 3000, reason: "Price rise" });
  assert.equal(calls[0]!.url, "/api/subscription-plans/" + ID);
  assert.equal(calls[0]!.init?.method, "PATCH");
  assert.equal(updated.plan.revision, 1);

  calls = stub(200, { plan: { ...planRow, isActive: false, archivedAt: NOW } });
  const archived = await archivePlan(ID, { revision: 1, reason: "Retired" });
  assert.equal(calls[0]!.url, "/api/subscription-plans/" + ID + "/archive");
  assert.equal(archived.plan.isActive, false);
});

test("an answer that breaks the contract is refused, and a refusal keeps its status", async () => {
  stub(200, { plan: { ...planRow, priceRs: 2500.5 } });
  await assert.rejects(createPlan(create), (err: unknown) => err instanceof ApiError && err.status === 502);
  stub(409, { error: "The plan was changed by someone else. Reload and try again." });
  await assert.rejects(updatePlan(ID, { revision: 0, priceRs: 3000, reason: "Price rise" }), (err: unknown) => err instanceof ApiError && err.status === 409);
  stub(422, { error: "Invalid request", issues: [{ path: "priceRs", message: "The price must be whole rupees." }] });
  await assert.rejects(createPlan(create), (err: unknown) => err instanceof ApiError && err.status === 422 && err.issues[0]!.path === "priceRs");
});
