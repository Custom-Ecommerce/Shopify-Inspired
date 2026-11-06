import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createCategory, deleteCategory, listCategories, updateCategory } from "../lib/api/client";

const OID = "65a000000000000000000001";
const NOW = "2026-10-11T10:00:00.000Z";
const realFetch = globalThis.fetch;
const category = { id: OID, name: "Lawn", slug: "lawn", order: 2, description: null, createdAt: NOW, updatedAt: NOW };
const meta = { totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };

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

test("listCategories calls the same-origin proxy and returns a validated envelope", async () => {
  const seen = stub(200, { docs: [category], ...meta });
  const result = await listCategories({ page: 2, q: "lawn" });
  assert.equal(seen[0].url, "/api/categories?page=2&q=lawn&limit=20");
  assert.equal(result.docs[0].id, OID);
});

test("an answer that breaks the contract is refused, not shown", async () => {
  stub(200, { docs: [{ ...category, id: undefined, _id: OID }], ...meta });
  await assert.rejects(listCategories({ page: 1, q: "" }), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("createCategory posts the body and returns the category", async () => {
  const seen = stub(200, { category });
  const created = await createCategory({ name: "Lawn", order: 2 });
  assert.equal(seen[0].url, "/api/categories");
  assert.equal(seen[0].method, "POST");
  assert.deepEqual(JSON.parse(seen[0].body ?? "{}"), { name: "Lawn", order: 2 });
  assert.equal(created.slug, "lawn");
});

test("updateCategory patches by id, and deleteCategory deletes by id", async () => {
  const seen = stub(200, { category: { ...category, order: 9 } });
  assert.equal((await updateCategory(OID, { order: 9 })).order, 9);
  assert.equal(seen[0].url, "/api/categories/" + OID);
  assert.equal(seen[0].method, "PATCH");
  const gone = stub(200, { deleted: true, id: OID });
  assert.deepEqual(await deleteCategory(OID), { deleted: true, id: OID });
  assert.equal(gone[0].method, "DELETE");
});

test("a failed write carries the status, the message, and the issues", async () => {
  stub(422, { error: "Invalid request", issues: [{ path: "slug", message: "must be text" }] });
  await assert.rejects(createCategory({ name: "A" }), (err: unknown) => err instanceof ApiError && err.status === 422 && err.issues[0].path === "slug");
  stub(409, { error: "Another category already uses that slug." });
  await assert.rejects(updateCategory(OID, { slug: "taken" }), (err: unknown) => err instanceof ApiError && err.status === 409 && err.message === "Another category already uses that slug.");
});
