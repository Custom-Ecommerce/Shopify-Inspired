import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as subscriptionGET } from "../app/api/dashboard/subscription/route";
import { GET as instructionsGET } from "../app/api/dashboard/subscription/instructions/route";
import { POST as paymentsPOST } from "../app/api/dashboard/subscription/payments/route";
import { POST as claimPOST } from "../app/api/dashboard/subscription/payments/claim/route";
import { POST as downgradePOST } from "../app/api/dashboard/subscription/downgrade/route";
import { POST as cancelPOST } from "../app/api/dashboard/subscription/cancel/route";
import { readProblem } from "../lib/subscription-view";

// Sprint 6 EP-14 (S6-B4): the seller portal's BFF routes for the plan. The plan belongs to the seller, so every route needs the session only; the
// backend's bodies are strict, so nothing is added to them (bindStore false: no `store` key ever reaches the backend).

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function stub(status: number, payload: unknown, extraHeaders: Record<string, string> = {}): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: String(init?.method), headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...extraHeaders } });
  }) as typeof fetch;
  return seen;
}

const header = (seen: Seen, name: string): string | undefined => Object.entries(seen.headers).find(([key]) => key.toLowerCase() === name)?.[1];

const get = (path: string, cookie = "markaz-session=tok") => new NextRequest("http://seller.local" + path, { headers: cookie ? { cookie } : {} });
const post = (path: string, body: unknown, cookie = "markaz-session=tok") =>
  new NextRequest("http://seller.local" + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const ROUTES: Array<[string, (req: NextRequest) => Promise<Response>, string, unknown]> = [
  ["/api/dashboard/subscription/payments", paymentsPOST, "/api/subscription/payments", { planKey: "growth" }],
  ["/api/dashboard/subscription/payments/claim", claimPOST, "/api/subscription/payments/claim", { paymentId: "65a0000000000000000e0001", method: "bank", reference: "R-1" }],
  ["/api/dashboard/subscription/downgrade", downgradePOST, "/api/subscription/downgrade", { planKey: "starter" }],
  ["/api/dashboard/subscription/cancel", cancelPOST, "/api/subscription/cancel", { cancelAtPeriodEnd: true }],
];

test("the reads go to the backend with the session and no store", async () => {
  const seen = stub(200, { subscription: null, open: null, payments: [] });
  const res = await subscriptionGET(get("/api/dashboard/subscription"));
  assert.equal(res.status, 200);
  assert.match(seen[0]!.url, /\/api\/subscription$/);
  assert.equal(seen[0]!.method, "GET");
  assert.equal(header(seen[0]!, "authorization"), "JWT tok");
  assert.equal(header(seen[0]!, "x-store-id"), undefined);
  const instructions = stub(200, { paymentInstructions: "Pay here", supportEmail: null, supportPhone: null });
  assert.equal((await instructionsGET(get("/api/dashboard/subscription/instructions"))).status, 200);
  assert.match(instructions[0]!.url, /\/api\/subscription\/instructions$/);
});

test("each write is forwarded to its backend route with the body exactly as sent: no store, no amount added", async () => {
  for (const [path, handler, upstream, body] of ROUTES) {
    const seen = stub(200, { ok: true });
    const res = await handler(post(path, body));
    assert.equal(res.status, 200, path);
    assert.ok(seen[0]!.url.endsWith(upstream), path);
    assert.equal(seen[0]!.method, "POST");
    assert.deepEqual(JSON.parse(seen[0]!.body ?? "null"), body, path + ': the body is the one sent (bindStore false)');
    assert.equal(header(seen[0]!, "authorization"), "JWT tok");
    assert.equal(header(seen[0]!, "x-store-id"), undefined, path);
  }
});

test("a store id in a browser's request is not turned into a header, and the body's own keys are not stripped here (the backend refuses them)", async () => {
  const seen = stub(400, { errors: [{ message: "Invalid request" }], code: "ACCOUNT_BODY_INVALID", field: "store" });
  const res = await paymentsPOST(new NextRequest("http://seller.local/api/dashboard/subscription/payments?storeId=65a000000000000000000011", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "markaz-session=tok", "x-store-id": "65a000000000000000000011" },
    body: JSON.stringify({ planKey: "growth", store: "65a000000000000000000011" }),
  }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { field: string }).field, "store");
  assert.equal(header(seen[0]!, "x-store-id"), undefined);
  assert.equal(seen[0]!.url.includes("storeId="), false, "the client's store key is stripped from the query");
});

test("without a session cookie every route answers 401 and the backend is never called", async () => {
  const seen = stub(200, {});
  assert.equal((await subscriptionGET(get("/api/dashboard/subscription", ""))).status, 401);
  assert.equal((await instructionsGET(get("/api/dashboard/subscription/instructions", ""))).status, 401);
  for (const [path, handler, , body] of ROUTES) assert.equal((await handler(post(path, body, ""))).status, 401, path);
  assert.equal(seen.length, 0);
});

test("a refusal keeps its status, its code and the field the form should mark", async () => {
  stub(400, { errors: [{ message: "Enter the transfer reference." }], code: "ACCOUNT_BODY_INVALID", field: "reference" });
  const res = await claimPOST(post("/api/dashboard/subscription/payments/claim", { paymentId: "x" }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; code: string; field: string };
  assert.deepEqual([body.error, body.code, body.field], ["Enter the transfer reference.", "ACCOUNT_BODY_INVALID", "reference"]);
  stub(409, { errors: [{ message: "You already have a payment waiting for a decision." }], code: "PAYMENT_OPEN" });
  const open = await paymentsPOST(post("/api/dashboard/subscription/payments", { planKey: "growth" }));
  assert.deepEqual([open.status, ((await open.json()) as { code: string }).code], [409, "PAYMENT_OPEN"]);
});

test("a refused downgrade keeps what exceeds, per limit, so the page can list it", async () => {
  stub(422, {
    errors: [{ message: "You cannot move to the Starter plan yet." }],
    code: "DOWNGRADE_EXCEEDS_LIMITS",
    exceeds: [{ limit: "stores", allowed: 2, used: 3 }, { limit: "products", allowed: 100, used: 120 }],
  });
  const res = await downgradePOST(post("/api/dashboard/subscription/downgrade", { planKey: "starter" }));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal((body as { code: string }).code, "DOWNGRADE_EXCEEDS_LIMITS");
  assert.deepEqual((body as { details: unknown }).details, [{ limit: "stores", allowed: 2, used: 3 }, { limit: "products", allowed: 100, used: 120 }]);
  assert.deepEqual(readProblem(body, "x").exceeds, ["Stores: the plan allows 2 and you have 3.", "Products in a store: the plan allows 100 and you have 120."]);
});

test("a rate limit keeps its Retry-After", async () => {
  stub(429, { errors: [{ message: "Too many attempts. Please wait and try again." }], code: "RATE_LIMITED", retryAfterSeconds: 120 }, { "retry-after": "120" });
  const res = await paymentsPOST(post("/api/dashboard/subscription/payments", { planKey: "growth" }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "120");
});

test("an unreachable backend is a 502 BACKEND_OFFLINE, not a hang", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const quiet = console.error;
  console.error = () => {};
  try {
    const res = await subscriptionGET(get("/api/dashboard/subscription"));
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { code: string }).code, "BACKEND_OFFLINE");
  } finally {
    console.error = quiet;
  }
});
