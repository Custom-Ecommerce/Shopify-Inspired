import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, changeStoreStatus, getStore, listStores } from "../lib/api/client";

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

const row = {
  id: OID,
  name: "Lahore Looms",
  slug: "lahore-looms",
  status: "active",
  domain: null,
  isThemeDemo: false,
  commissionRate: 5,
  commissionMode: "inherit",
  owner: null,
  statusChangedAt: null,
  createdAt: NOW,
};

const detail = {
  ...row,
  internalHandle: null,
  customDomainStatus: "unset",
  suspensionReason: null,
  suspensionNote: null,
  suspendedAt: null,
  archivedAt: null,
  govRevision: 0,
  opsRevision: 0,
  activeTheme: null,
  stripeOnboardingStatus: null,
  stripeChargesEnabled: null,
  updatedAt: NOW,
  history: [],
};

test("listStores calls the same-origin proxy and returns a validated envelope", async () => {
  const urls = stub(200, { docs: [row], totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false });
  const result = await listStores({ page: 2, q: "loom", status: "active" });
  assert.equal(urls[0], "/api/stores?page=2&q=loom&status=active&limit=20");
  assert.equal(result.docs[0].id, OID);
});

test("an answer that breaks the contract is refused, not shown", async () => {
  stub(200, { docs: [{ ...row, id: undefined, _id: OID }], totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false });
  await assert.rejects(listStores({ page: 1, q: "", status: "" }), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("getStore unwraps the store from its envelope", async () => {
  stub(200, { store: detail });
  assert.equal((await getStore(OID)).id, OID);
});

test("a failed call carries the status and the backend's message", async () => {
  stub(404, { error: "Store not found" });
  await assert.rejects(getStore(OID), (err: unknown) => err instanceof ApiError && err.status === 404 && err.message === "Store not found");
  stub(409, {});
  await assert.rejects(changeStoreStatus(OID, { status: "suspended", reason: "policy" }), (err: unknown) => err instanceof ApiError && err.status === 409 && /someone else/.test(err.message));
});

test("changeStoreStatus posts to the proxy and validates the answer", async () => {
  const urls = stub(200, { store: { id: OID, status: "suspended", suspensionReason: "policy", suspensionNote: null, suspendedAt: NOW, statusChangedAt: NOW }, queued: { eventId: "evt_1", revision: 1 } });
  const result = await changeStoreStatus(OID, { status: "suspended", reason: "policy" });
  assert.equal(urls[0], "/api/stores/" + OID + "/status");
  assert.equal(result.store.status, "suspended");
});
