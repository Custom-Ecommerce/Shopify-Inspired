import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ApiError, listCommissionLedger, listCommissionRates, listSubscriptionPlans } from "../lib/api/client";

const OID = "65a000000000000000000010";
const NOW = "2026-10-11T10:00:00.000Z";
const realFetch = globalThis.fetch;

let ledgerGET: (request: NextRequest) => Promise<Response>;
let ratesGET: (request: NextRequest) => Promise<Response>;
let plansGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  ledgerGET = (await import("../app/api/commission/ledger/route")).GET;
  ratesGET = (await import("../app/api/commission/rates/route")).GET;
  plansGET = (await import("../app/api/subscription-plans/route")).GET;
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

function get(path: string, cookie = "markaz-admin-session=tok"): NextRequest {
  return new NextRequest("http://admin.local" + path, { headers: cookie ? { cookie } : {} });
}

const meta = { totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };
const bucket = { count: 1, orderAmount: 125000, commissionAmount: 5000 };
const ledgerState = { view: "ledger", page: 1, q: "", status: "", mode: "" } as const;

const entry = {
  id: OID,
  store: { id: OID, name: "Looms" },
  orderAmount: 125000,
  commissionRate: 4,
  commissionAmount: 5000,
  status: "pending",
  paymentMethod: "card",
  settlementDate: null,
  settlementRef: null,
  createdAt: NOW,
};

test("listCommissionLedger calls the same-origin proxy and returns validated rows with totals", async () => {
  const urls = stub(200, { docs: [entry], ...meta, totals: { pending: bucket, settled: { ...bucket, count: 0 } } });
  const result = await listCommissionLedger({ ...ledgerState, page: 2, status: "pending" });
  assert.equal(urls[0].url, "/api/commission/ledger?page=2&status=pending&limit=20");
  assert.equal(result.docs[0].id, OID);
  assert.equal(result.totals.pending.commissionAmount, 5000);
});

test("a ledger answer that breaks the contract is refused, not shown", async () => {
  stub(200, { docs: [{ ...entry, id: undefined, _id: OID }], ...meta, totals: { pending: bucket, settled: bucket } });
  await assert.rejects(listCommissionLedger(ledgerState), (err: unknown) => err instanceof ApiError && err.status === 502);
  stub(200, { docs: [entry], ...meta });
  await assert.rejects(listCommissionLedger(ledgerState), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("listCommissionRates sends the rate-source filter and returns the default rate", async () => {
  const item = { id: OID, name: "Looms", status: "active", commissionMode: "custom", commissionRate: 7.5, effectiveRate: 7.5 };
  const urls = stub(200, { docs: [item], ...meta, defaultRate: 4 });
  const result = await listCommissionRates({ view: "rates", page: 1, q: "looms", status: "", mode: "custom" });
  assert.equal(urls[0].url, "/api/commission/rates?q=looms&mode=custom&limit=20");
  assert.equal(result.defaultRate, 4);
  assert.equal(result.docs[0].effectiveRate, 7.5);
});

test("listSubscriptionPlans sends the tier and returns the plans with their counts", async () => {
  const plan = { id: OID, name: "Pro monthly", tier: "pro", stripePriceId: "price_123", createdAt: NOW, updatedAt: NOW };
  const urls = stub(200, { docs: [plan], ...meta, counts: { basic: 0, pro: 1, premium: 0 } });
  const result = await listSubscriptionPlans({ page: 1, q: "", tier: "pro" });
  assert.equal(urls[0].url, "/api/subscription-plans?tier=pro&limit=20");
  assert.equal(result.counts.pro, 1);
  stub(200, { docs: [{ ...plan, tier: "gold" }], ...meta, counts: { basic: 0, pro: 1, premium: 0 } });
  await assert.rejects(listSubscriptionPlans({ page: 1, q: "", tier: "" }), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("a failed commerce call carries the status and the backend's message", async () => {
  stub(403, { error: "Forbidden" });
  await assert.rejects(listCommissionLedger(ledgerState), (err: unknown) => err instanceof ApiError && err.status === 403 && err.message === "Forbidden");
  stub(503, {});
  await assert.rejects(listSubscriptionPlans({ page: 1, q: "", tier: "" }), (err: unknown) => err instanceof ApiError && err.status === 503);
});

const ROUTES: Array<[string, string, () => (request: NextRequest) => Promise<Response>]> = [
  ["ledger", "/api/commission/ledger", () => ledgerGET],
  ["rates", "/api/commission/rates", () => ratesGET],
  ["plans", "/api/subscription-plans", () => plansGET],
];

for (const [name, path, handler] of ROUTES) {
  test(name + ": the cookie is required, and the backend is not called without it", async () => {
    const calls = stub(200, {});
    assert.equal((await handler()(get(path, ""))).status, 401);
    assert.equal(calls.length, 0);
  });

  test(name + ": a refused session is 401 and clears the cookie, an unreachable backend is 503, an unexpected failure is 502", async () => {
    stub(401, { error: "Invalid or expired session" });
    const refused = await handler()(get(path));
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get("set-cookie") ?? "", /Max-Age=0/);
    stub(500, { error: "Internal error" });
    assert.equal((await handler()(get(path))).status, 502);
    process.env.ADMIN_BACKEND_API_URL = "";
    assert.equal((await handler()(get(path))).status, 503);
  });

  test(name + ": a backend validation error is passed on with its issues", async () => {
    stub(422, { error: "Invalid request", issues: [{ path: "page", message: "bad" }] });
    const response = await handler()(get(path + "?page=0"));
    assert.equal(response.status, 422);
    assert.deepEqual(((await response.json()) as { issues: unknown[] }).issues, [{ path: "page", message: "bad" }]);
  });
}

test("the ledger forwards only page, limit, q, and status, with the token as a bearer", async () => {
  const calls = stub(200, {});
  const response = await ledgerGET(get("/api/commission/ledger?page=2&q=looms&status=settled&limit=20&mode=custom&evil=1&$where=x"));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://admin.test/api/admin/commission/ledger?page=2&limit=20&q=looms&status=settled");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the rates forward only page, limit, q, and mode, and the plans only page, limit, q, and tier", async () => {
  const calls = stub(200, {});
  await ratesGET(get("/api/commission/rates?mode=custom&status=settled&q=x&page=3"));
  assert.equal(calls[0].url, "http://admin.test/api/admin/commission/rates?page=3&q=x&mode=custom");
  await plansGET(get("/api/subscription-plans?tier=pro&mode=custom&q=y"));
  assert.equal(calls[1].url, "http://admin.test/api/admin/subscription-plans?q=y&tier=pro");
  await plansGET(get("/api/subscription-plans"));
  assert.equal(calls[2].url, "http://admin.test/api/admin/subscription-plans");
});
