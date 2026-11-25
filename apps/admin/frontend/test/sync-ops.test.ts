import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { NAV_GROUPS } from "../components/dashboard/nav-config";
import { ApiError, listFailedEmails, retryDeadEvents, retryFailedEmails, runRetentionNow } from "../lib/api/client";
import { RETRY_MAX, canApply, failedEmailIds, kindLabel, retentionLines, retentionTotal, retryButtonText, retryResultText, retryableEventIds } from "../lib/sync-ops";

// Sprint 6 (S6-B7): the retry buttons, the failed-email section and the Retention page. Pure helpers, the client and the same-origin routes.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});
const ID = (n: number) => "65a0000000000000000000" + String(n).padStart(2, "0");
const NOW = "2026-11-20T10:00:00.000Z";

test("only dead events are retried from the page, at most 100", () => {
  const events = [{ id: ID(1), status: "dead" }, { id: ID(2), status: "sent" }, { id: ID(3), status: "pending" }, { id: ID(4), status: "dead" }] as const;
  assert.deepEqual(retryableEventIds(events), [ID(1), ID(4)]);
  const many = Array.from({ length: 150 }, (_, i) => ({ id: "65a00000000000000" + String(i).padStart(7, "0"), status: "dead" as const }));
  assert.equal(retryableEventIds(many).length, RETRY_MAX);
  assert.equal(failedEmailIds(many).length, 100);
});

test("the wording of the retry button and of its result", () => {
  assert.deepEqual([retryButtonText(0), retryButtonText(1), retryButtonText(5)], ["Nothing to retry", "Retry this event", "Retry 5 events"]);
  assert.equal(retryResultText({ requested: 3, retried: 3, skipped: 0 }), "3 events back in the queue.");
  assert.equal(retryResultText({ requested: 3, retried: 2, skipped: 1 }), "2 events back in the queue; 1 had already moved.");
  assert.equal(retryResultText({ requested: 2, retried: 0, skipped: 2 }), "Nothing was retried: 2 events had already moved.");
  assert.equal(retryResultText({ requested: 1, retried: 1, skipped: 0 }, "email"), "1 email back in the queue.");
  assert.equal(kindLabel("order_placed_customer"), "Order placed customer");
});

const dry = { dryRun: true, at: NOW, targets: [
  { key: "notification_outbox", days: 90, eligible: 12, purged: 0, more: false },
  { key: "sync_outbox", days: 30, eligible: 0, purged: 0, more: false },
  { key: "stock_movements", days: 365, eligible: 600, purged: 0, more: true },
  { key: "product_trash", days: 365, eligible: 1, purged: 0, more: false },
] } as const;

test("the retention page shows what a dry run found, and offers Apply only after a dry run that found something", () => {
  assert.equal(retentionTotal(dry as never), 613);
  assert.equal(canApply(null), false);
  assert.equal(canApply(dry as never), true);
  assert.equal(canApply({ ...dry, targets: dry.targets.map((t) => ({ ...t, eligible: 0 })) } as never), false, "nothing to remove");
  assert.equal(canApply({ ...dry, dryRun: false } as never), false, "an applied run is not a dry run");
  const lines = retentionLines(dry as never);
  assert.equal(lines[0]!.label, "Sent emails older than 90 days");
  assert.equal(lines[0]!.text, "12 would be removed");
  assert.match(lines[2]!.text, /more than one run can take/);
  const applied = retentionLines({ ...dry, dryRun: false, targets: dry.targets.map((t) => ({ ...t, purged: Math.min(t.eligible, 500) })) } as never);
  assert.equal(applied[2]!.text, "500 removed, more are left for the next run");
});

test("the navigation has the Retention page for settings.write only", () => {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/retention");
  assert.ok(item);
  assert.equal(item!.capability, "settings.write");
});

function stub(status: number, payload: unknown): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("the client posts the ids, the failed-email list never needs a body field, and a dry run sends an empty body", async () => {
  let calls = stub(200, { requested: 2, retried: 2, skipped: 0 });
  assert.equal((await retryDeadEvents([ID(1), ID(2)])).retried, 2);
  assert.equal(calls[0]!.url, "/api/sync/retry");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { ids: [ID(1), ID(2)] });
  calls = stub(200, { requested: 1, retried: 1, skipped: 0 });
  await retryFailedEmails([ID(3)]);
  assert.equal(calls[0]!.url, "/api/notifications/retry");
  calls = stub(200, { docs: [{ id: ID(4), kind: "order_placed_customer", recipient: "a***@e***.com", attempts: 5, errorCode: "SMTP_TIMEOUT", createdAt: NOW, updatedAt: NOW }], totalDocs: 1 });
  assert.equal((await listFailedEmails()).docs[0]!.recipient, "a***@e***.com");
  stub(200, { docs: [{ id: ID(4), kind: "x", recipient: "a@b.test", attempts: 1, errorCode: null, createdAt: NOW, updatedAt: NOW, payload: { phone: "0300" } }], totalDocs: 1 });
  await assert.rejects(() => listFailedEmails(), (e: unknown) => e instanceof ApiError && e.status === 502, "a row with a payload key is refused by the strict contract");
  calls = stub(200, { dryRun: true, at: NOW, targets: [] });
  await runRetentionNow(false);
  assert.equal(calls[0]!.init?.body, "{}");
  calls = stub(200, { dryRun: false, at: NOW, targets: [] });
  await runRetentionNow(true);
  assert.equal(calls[0]!.init?.body, JSON.stringify({ apply: true }));
  stub(403, { error: "Forbidden" });
  await assert.rejects(() => runRetentionNow(true), (e: unknown) => e instanceof ApiError && e.status === 403);
});

type Handler = (r: NextRequest) => Promise<Response>;
let retryPOST: Handler;
let mailPOST: Handler;
let retentionPOST: Handler;
let failedGET: Handler;
before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  retryPOST = (await import("../app/api/sync/retry/route")).POST;
  mailPOST = (await import("../app/api/notifications/retry/route")).POST;
  retentionPOST = (await import("../app/api/retention/route")).POST;
  failedGET = (await import("../app/api/notifications/failed/route")).GET;
});
const post = (url: string, body: unknown, cookie = "markaz-admin-session=tok") =>
  new NextRequest("http://admin.local" + url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test("the retry routes validate the strict body (1 to 100 distinct ids) before the backend, and forward nothing else", async () => {
  const calls = stub(200, { requested: 1, retried: 1, skipped: 0 });
  assert.equal((await retryPOST(post("/api/sync/retry", { ids: [ID(1)] }))).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/sync/retry");
  for (const body of [{}, { ids: [] }, { ids: ["x"] }, { ids: [ID(1), ID(1)] }, { ids: [ID(1)], all: true }, { ids: Array.from({ length: 101 }, (_, i) => "65a00000000000000" + String(i).padStart(7, "0")) }]) {
    assert.equal((await retryPOST(post("/api/sync/retry", body))).status, 422, JSON.stringify(body).slice(0, 40));
    assert.equal((await mailPOST(post("/api/notifications/retry", body))).status, 422);
  }
  assert.equal(calls.length, 1);
  assert.equal((await retryPOST(post("/api/sync/retry", { ids: [ID(1)] }, ""))).status, 401);
});

test("the retention route: an empty body is a dry run, apply must be a boolean, any other key is refused, the session is needed", async () => {
  const calls = stub(200, { dryRun: true, at: NOW, targets: [] });
  assert.equal((await retentionPOST(post("/api/retention", {}))).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/retention");
  assert.equal((await retentionPOST(post("/api/retention", { apply: true }))).status, 200);
  for (const body of [{ apply: "yes" }, { apply: true, days: 1 }, []]) assert.equal((await retentionPOST(post("/api/retention", body))).status, 422, JSON.stringify(body));
  assert.equal((await retentionPOST(post("/api/retention", {}, ""))).status, 401);
  assert.equal(calls.length, 2);
  stub(403, { error: "Forbidden" });
  assert.equal((await retentionPOST(post("/api/retention", { apply: true }))).status, 403);
  stub(200, { docs: [], totalDocs: 0 });
  assert.equal((await failedGET(new NextRequest("http://admin.local/api/notifications/failed", { headers: { cookie: "markaz-admin-session=tok" } }))).status, 200);
});
