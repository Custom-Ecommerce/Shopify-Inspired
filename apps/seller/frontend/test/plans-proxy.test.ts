import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../app/api/dashboard/plans/route";

// Sprint 6 EP-14.US01.T07: the seller dashboard reads the plans through its own BFF route, with the session and no store.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const plan = { key: "free", name: "Free", priceRs: 0, interval: "month", limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false }, features: [], sortOrder: 1 };

function stub(status: number, payload: unknown): Array<{ url: string; headers: Record<string, string> }> {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

const request = (cookie?: string) => new NextRequest("http://seller.local/api/dashboard/plans", { headers: cookie ? { cookie } : {} });

test("a signed-in seller's request is forwarded to /api/plans with the session, and the plans come back", async () => {
  const seen = stub(200, { plans: [plan] });
  const res = await GET(request("markaz-session=tok"));
  assert.equal(res.status, 200);
  assert.match(seen[0]!.url, /\/api\/plans$/);
  const authorization = Object.entries(seen[0]!.headers).find(([name]) => name.toLowerCase() === "authorization")?.[1];
  assert.equal(authorization, "JWT tok");
  assert.deepEqual(((await res.json()) as { plans: unknown[] }).plans, [plan]);
});

test("no session cookie is refused here, and the backend is never called", async () => {
  const seen = stub(200, { plans: [] });
  const res = await GET(request());
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
});

test("a refusal from the backend keeps its status", async () => {
  stub(403, { error: "Only a seller can read the plans" });
  const res = await GET(request("markaz-session=tok"));
  assert.equal(res.status, 403);
});
