import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, getSyncOutbox, listAudit, listSellers } from "../lib/api/client";

const OID = "65a000000000000000000010";
const NOW = "2026-10-11T10:00:00.000Z";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, payload: unknown): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return urls;
}

const meta = { totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };

test("listSellers calls the same-origin proxy and returns a validated envelope", async () => {
  const row = { id: OID, name: "Aisha", email: "aisha@example.com", stores: [{ id: OID, name: "Looms", status: "active" }], storeCount: 1, createdAt: NOW };
  const urls = stub(200, { docs: [row], ...meta });
  const result = await listSellers({ page: 2, q: "aisha" });
  assert.equal(urls[0], "/api/sellers?page=2&q=aisha&limit=20");
  assert.equal(result.docs[0].id, OID);
});

test("an answer that breaks the contract is refused, not shown", async () => {
  const row = { _id: OID, name: "Aisha", email: "aisha@example.com", stores: [], storeCount: 0, createdAt: NOW };
  stub(200, { docs: [row], ...meta });
  await assert.rejects(listSellers({ page: 1, q: "" }), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("getSyncOutbox asks for dead letters by default and validates the answer", async () => {
  const event = { id: OID, eventId: "evt_1", target: "seller", entity: "store", entityId: OID, group: "governance", revision: 1, status: "dead", attempts: 8, nextAttemptAt: null, lastError: "boom", sentAt: null, createdAt: NOW };
  const urls = stub(200, { counts: { pending: 0, sent: 3, dead: 1 }, oldestPendingAt: null, lastSentAt: NOW, status: "dead", events: { docs: [event], ...meta } });
  const result = await getSyncOutbox({ page: 1, status: "dead" });
  assert.equal(urls[0], "/api/sync/outbox?limit=20");
  assert.equal(result.counts.dead, 1);
  assert.equal(result.events.docs[0].lastError, "boom");
  const more = stub(200, {});
  await assert.rejects(getSyncOutbox({ page: 2, status: "sent" }), (err: unknown) => err instanceof ApiError && err.status === 502);
  assert.equal(more[0], "/api/sync/outbox?page=2&status=sent&limit=20");
});

test("listAudit sends the filters and returns the entries with the action facets", async () => {
  const entry = { id: OID, action: "store.suspend", entity: "store", entityId: OID, actor: { id: OID, name: "Op" }, reason: "policy", note: null, from: "active", to: "suspended", createdAt: NOW };
  const urls = stub(200, { docs: [entry], ...meta, facets: { actions: ["store.suspend"] } });
  const result = await listAudit({ page: 1, q: "looms", action: "store.suspend" });
  assert.equal(urls[0], "/api/audit?q=looms&action=store.suspend&limit=20");
  assert.deepEqual(result.facets.actions, ["store.suspend"]);
});

test("a failed call carries the status and the backend's message", async () => {
  stub(403, { error: "Forbidden" });
  await assert.rejects(listAudit({ page: 1, q: "", action: "" }), (err: unknown) => err instanceof ApiError && err.status === 403 && err.message === "Forbidden");
  stub(503, {});
  await assert.rejects(getSyncOutbox({ page: 1, status: "dead" }), (err: unknown) => err instanceof ApiError && err.status === 503);
});
