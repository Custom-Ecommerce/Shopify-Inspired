import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, getSettings, updateSettings } from "../lib/api/client";

const NOW = "2026-10-11T10:00:00.000Z";
const realFetch = globalThis.fetch;
const settings = { defaultCommissionRate: 4, maxStoresPerSeller: 3, stripeCommissionNote: null, settingsRevision: 2, updatedAt: NOW };

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  method: string | undefined;
  body: string | undefined;
}

function stub(status: number, payload: unknown): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

test("getSettings calls the same-origin proxy and returns the validated settings", async () => {
  const seen = stub(200, { settings });
  const result = await getSettings();
  assert.equal(seen[0].url, "/api/settings");
  assert.equal(seen[0].method, undefined);
  assert.equal(result.defaultCommissionRate, 4);
  assert.equal(result.settingsRevision, 2);
  assert.equal(result.stripeCommissionNote, null);
});

test("an answer that breaks the contract is refused, not shown", async () => {
  stub(200, { settings: { ...settings, defaultCommissionRate: 101 } });
  await assert.rejects(getSettings(), (err: unknown) => err instanceof ApiError && err.status === 502);
  stub(200, settings);
  await assert.rejects(getSettings(), (err: unknown) => err instanceof ApiError && err.status === 502);
  stub(200, { settings: { ...settings, _id: undefined, settingsRevision: -1 } });
  await assert.rejects(getSettings(), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("updateSettings patches the body and returns the settings with the queued event", async () => {
  const seen = stub(200, { settings: { ...settings, defaultCommissionRate: 5, settingsRevision: 3 }, queued: { eventId: "01JABCDEFGHJKMNPQRSTVWXYZ0", revision: 3 } });
  const result = await updateSettings({ defaultCommissionRate: 5, reason: "Q4 pricing" });
  assert.equal(seen[0].url, "/api/settings");
  assert.equal(seen[0].method, "PATCH");
  assert.deepEqual(JSON.parse(seen[0].body ?? "{}"), { defaultCommissionRate: 5, reason: "Q4 pricing" });
  assert.equal(result.settings.defaultCommissionRate, 5);
  assert.equal(result.settings.settingsRevision, 3);
  assert.deepEqual(result.queued, { eventId: "01JABCDEFGHJKMNPQRSTVWXYZ0", revision: 3 });
});

test("a change nothing needed to send comes back with queued null", async () => {
  stub(200, { settings: { ...settings, stripeCommissionNote: "Fees" }, queued: null });
  const result = await updateSettings({ stripeCommissionNote: "Fees" });
  assert.equal(result.queued, null);
  assert.equal(result.settings.stripeCommissionNote, "Fees");
});

test("an update answer without the queued field is refused", async () => {
  stub(200, { settings });
  await assert.rejects(updateSettings({ maxStoresPerSeller: 4 }), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("a failed write carries the status, the message, and the issues", async () => {
  stub(422, { error: "Invalid request", issues: [{ path: "defaultCommissionRate", message: "must be a number from 0 to 100" }] });
  await assert.rejects(
    updateSettings({ defaultCommissionRate: 5 }),
    (err: unknown) => err instanceof ApiError && err.status === 422 && err.issues[0].path === "defaultCommissionRate",
  );
  stub(409, { error: "The settings were changed by someone else. Reload and try again." });
  await assert.rejects(
    updateSettings({ defaultCommissionRate: 5 }),
    (err: unknown) => err instanceof ApiError && err.status === 409 && err.message === "The settings were changed by someone else. Reload and try again.",
  );
});

test("a missing settings document and a refused permission are told as they are", async () => {
  stub(404, { error: "Platform settings have not been set up" });
  await assert.rejects(getSettings(), (err: unknown) => err instanceof ApiError && err.status === 404 && err.message === "Platform settings have not been set up");
  stub(403, {});
  await assert.rejects(updateSettings({ defaultCommissionRate: 5 }), (err: unknown) => err instanceof ApiError && err.status === 403 && err.message === "You do not have permission to do that.");
});

test("a network failure is an ApiError with status 0", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  await assert.rejects(getSettings(), (err: unknown) => err instanceof ApiError && err.status === 0);
});
