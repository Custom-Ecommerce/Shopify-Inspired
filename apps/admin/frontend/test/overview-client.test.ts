import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, getOverview } from "../lib/api/client";

const NOW = "2026-10-11T10:00:00.000Z";
const realFetch = globalThis.fetch;
const overview = {
  stores: { total: 8, byStatus: { pending: 2, active: 5, suspended: 1, archived: 0 } },
  sellers: { total: 7, newInWindow: 2, windowDays: 30 },
  ledger: {
    pending: { count: 3, orderAmount: 120000, commissionAmount: 4800 },
    settled: { count: 10, orderAmount: 900000, commissionAmount: 36000 },
  },
  outbox: { counts: { pending: 1, sent: 10, dead: 0 }, oldestPendingAt: NOW, lastSentAt: null },
  generatedAt: NOW,
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  method: string | undefined;
}

function stub(status: number, payload: unknown): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

test("getOverview calls the same-origin proxy and returns the validated overview", async () => {
  const seen = stub(200, overview);
  const result = await getOverview();
  assert.equal(seen[0].url, "/api/overview");
  assert.equal(seen[0].method, undefined);
  assert.equal(result.stores.total, 8);
  assert.equal(result.sellers.newInWindow, 2);
  assert.equal(result.ledger.settled.commissionAmount, 36000);
  assert.equal(result.outbox.lastSentAt, null);
});

test("an answer that breaks the contract is refused, not shown", async () => {
  stub(200, { ...overview, stores: { ...overview.stores, total: -1 } });
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 502);
  const { outbox, ...withoutOutbox } = overview;
  void outbox;
  stub(200, withoutOutbox);
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 502);
  stub(200, { overview });
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("a failed read carries the status and the message", async () => {
  stub(403, { error: "Forbidden" });
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 403 && err.message === "Forbidden");
  stub(401, {});
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 401 && err.message === "Your session has expired. Sign in again.");
  stub(503, {});
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 503 && err.message === "The admin service is unavailable. Try again shortly.");
});

test("a network failure is an ApiError with status 0, and an aborted call is rethrown as it is", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  await assert.rejects(getOverview(), (err: unknown) => err instanceof ApiError && err.status === 0);
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = (async () => {
    throw new DOMException("aborted", "AbortError");
  }) as typeof fetch;
  await assert.rejects(getOverview(controller.signal), (err: unknown) => !(err instanceof ApiError));
});
