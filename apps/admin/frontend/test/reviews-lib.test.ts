import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { NAV_GROUPS, pageTitleFor } from "../components/dashboard/nav-config";
import { REVIEW_COPY, availableReviewAction, parseReviewListState, reviewStateToQuery } from "../lib/reviews";

// Sprint 5 EP-21.US01.T05 (D-108): the admin console's review page: the list state in the URL, the one action a review offers, the words, the nav entry
// and the proxy routes (the cookie is required, only known filters and keys are forwarded, the body is checked before the backend is called).

const OID = "65a000000000000000000011";
const REVIEW = "65a0000000000000000f0001";
const realFetch = globalThis.fetch;

let listGET: (request: NextRequest) => Promise<Response>;
let actionPOST: (request: NextRequest, context: { params: Promise<{ action: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  listGET = (await import("../app/api/reviews/route")).GET;
  actionPOST = (await import("../app/api/reviews/[action]/route")).POST;
});

afterEach(() => {
  globalThis.fetch = realFetch;
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

const post = (action: string, body: unknown, cookie = "markaz-admin-session=tok") =>
  actionPOST(
    new NextRequest("http://admin.local/api/reviews/" + action, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ action }) },
  );

test("the list state is read from the URL, unreadable values fall back, defaults are left out of the query", () => {
  assert.deepEqual(parseReviewListState(new URLSearchParams("page=3&status=rejected&storeId=" + OID)), { page: 3, status: "rejected", storeId: OID });
  assert.deepEqual(parseReviewListState(new URLSearchParams("page=0&status=pending&storeId=nope")), { page: 1, status: "", storeId: "" });
  assert.deepEqual(parseReviewListState(new URLSearchParams("")), { page: 1, status: "", storeId: "" });
  assert.equal(reviewStateToQuery({ page: 1, status: "", storeId: "" }), "");
  assert.equal(reviewStateToQuery({ page: 2, status: "approved", storeId: OID }, true), "page=2&status=approved&storeId=" + OID + "&limit=20");
});

test("a shown review offers Hide (with a reason); a hidden one offers Unhide (no reason)", () => {
  assert.equal(availableReviewAction({ status: "approved" }), "hide");
  assert.equal(availableReviewAction({ status: "pending" }), "hide");
  assert.equal(availableReviewAction({ status: "rejected" }), "unhide");
  assert.equal(REVIEW_COPY.hide.needsReason, true);
  assert.equal(REVIEW_COPY.unhide.needsReason, false);
  assert.equal(REVIEW_COPY.hide.button, "Hide");
  assert.equal(REVIEW_COPY.unhide.button, "Unhide");
});

test("Reviews is a live navigation item with its page, and owns the header title", () => {
  const item = NAV_GROUPS.flatMap((group) => group.items).find((entry) => entry.href === "/reviews");
  assert.equal(item?.status, "live");
  assert.equal(pageTitleFor("/reviews"), "Reviews");
});

test("GET /api/reviews: the cookie is required, and only the known filters are forwarded to the admin backend", async () => {
  const none = stubBackend(200, {});
  assert.equal((await listGET(new NextRequest("http://admin.local/api/reviews"))).status, 401);
  assert.equal(none.length, 0);
  const calls = stubBackend(200, { docs: [] });
  const res = await listGET(new NextRequest("http://admin.local/api/reviews?status=rejected&page=2&limit=20&storeId=" + OID + "&q=x&evil=1", { headers: { cookie: "markaz-admin-session=tok" } }));
  assert.equal(res.status, 200);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/api/admin/reviews");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "page", "status", "storeId"]);
});

test("POST /api/reviews/hide: an unknown action is 404, a bad body is refused HERE (400 or 422) and the backend is not called", async () => {
  const calls = stubBackend(200, {});
  assert.equal((await post("delete", { reviewId: REVIEW })).status, 404);
  assert.equal((await post("hide", "not json")).status, 400);
  assert.equal((await post("hide", { reviewId: "nope", reason: "Abusive language" })).status, 422);
  assert.equal((await post("hide", { reviewId: REVIEW })).status, 422);
  assert.equal((await post("hide", { reviewId: REVIEW, reason: "no" })).status, 422);
  assert.equal((await post("hide", { reviewId: REVIEW, reason: "x".repeat(301) })).status, 422);
  assert.equal((await post("unhide", {})).status, 422);
  assert.equal(calls.length, 0);
});

test("hide forwards ONLY the review id and the trimmed reason; unhide forwards only the id; the session cookie travels as the bearer", async () => {
  const calls = stubBackend(200, { reviewId: REVIEW, status: "rejected" });
  assert.equal((await post("hide", { reviewId: REVIEW, reason: "  Abusive language  ", adminId: "someone-else", store: OID })).status, 200);
  assert.equal(new URL(calls[0]!.url).pathname, "/api/admin/reviews/hide");
  assert.equal(String(calls[0]!.init?.body), JSON.stringify({ reviewId: REVIEW, reason: "Abusive language" }));
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.equal((await post("unhide", { reviewId: REVIEW, reason: "ignored" })).status, 200);
  assert.equal(new URL(calls[1]!.url).pathname, "/api/admin/reviews/unhide");
  assert.equal(String(calls[1]!.init?.body), JSON.stringify({ reviewId: REVIEW }));
});
