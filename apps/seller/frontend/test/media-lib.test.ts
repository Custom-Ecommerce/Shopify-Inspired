import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteMedia, describeUsage, fetchMediaUsage, mediaDisplayName, renameMedia } from "../lib/media";
import { unavailableThemeNotice } from "../lib/theme-notice";

// Sprint 7 (S7-B1): the dashboard's media calls (rename, usage, delete) with a stubbed store fetch, and the guard on the proxy routes.

const ID = "65a000000000000000000101";
type Seen = { url: string; method: string; body: string | null };

function stub(status: number, payload: unknown): { fetch: (input: string, init?: RequestInit) => Promise<Response>; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (input, init) => {
      seen.push({ url: input, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    },
  };
}

test("a file shows its name, or its alt text until it has one", () => {
  assert.equal(mediaDisplayName({ name: "Summer lookbook", alt: "Shirt" }), "Summer lookbook");
  assert.equal(mediaDisplayName({ name: null, alt: "Shirt" }), "Shirt");
  assert.equal(mediaDisplayName({ alt: "Shirt" }), "Shirt");
  assert.equal(mediaDisplayName({ name: "   ", alt: "Shirt" }), "Shirt");
});

test("rename sends the name and nothing else to the media proxy, and returns the record (its url unchanged)", async () => {
  const s = stub(200, { id: ID, alt: "Shirt", name: "Summer", url: "https://res.cloudinary.com/demo/a.jpg" });
  const result = await renameMedia(s.fetch, ID, "Summer");
  assert.equal(s.seen[0]!.url, "/api/proxy/media/" + ID);
  assert.equal(s.seen[0]!.method, "PATCH");
  assert.deepEqual(JSON.parse(s.seen[0]!.body!), { name: "Summer" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.url, "https://res.cloudinary.com/demo/a.jpg");
});

test("rename keeps the backend's message and field when it is refused (field-error passthrough)", async () => {
  const s = stub(400, { error: "Enter a name.", code: "MEDIA_RENAME_INVALID", field: "name" });
  const result = await renameMedia(s.fetch, ID, "");
  assert.deepEqual(result, { ok: false, message: "Enter a name.", status: 400, field: "name" });
});

test("every call says so when the backend cannot be reached", async () => {
  const down = async (): Promise<Response> => {
    throw new Error("offline");
  };
  assert.deepEqual(await renameMedia(down, ID, "x"), { ok: false, message: "Could not reach the backend. Please try again.", status: 0 });
  assert.equal((await fetchMediaUsage(down, ID)).ok, false);
  assert.equal((await deleteMedia(down, ID)).ok, false);
});

test("usage reads the places a file is used, and describes them in one line", async () => {
  const s = stub(200, {
    mediaId: ID,
    inUse: true,
    total: 3,
    features: [
      { key: "products", label: "Products", count: 2, items: [{ id: "a", title: "Lawn suit" }] },
      { key: "branding", label: "Store settings", count: 1, items: [{ id: "logo", title: "Store logo" }] },
    ],
  });
  const result = await fetchMediaUsage(s.fetch, ID);
  assert.equal(s.seen[0]!.url, "/api/proxy/media/" + ID + "/usage");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.total, 3);
    assert.equal(describeUsage(result.value), "Products (2), Store settings (1)");
    assert.equal(result.value.features[0]!.items[0]!.title, "Lawn suit");
  }
  const free = await fetchMediaUsage(stub(200, { mediaId: ID, inUse: false, total: 0, features: [] }).fetch, ID);
  assert.equal(free.ok && free.value.inUse, false);
});

test("usage ignores a malformed answer instead of trusting it", async () => {
  const bad = await fetchMediaUsage(stub(200, { nope: true }).fetch, ID);
  assert.equal(bad.ok, false);
  const refused = await fetchMediaUsage(stub(404, { error: "Media not found", code: "NOT_FOUND" }).fetch, ID);
  assert.deepEqual(refused, { ok: false, message: "Media not found", status: 404 });
});

test("a refused delete (409 MEDIA_IN_USE) carries the usage list from the proxy's details", async () => {
  const features = [{ key: "products", label: "Products", count: 1, items: [{ id: "p1", title: "Lawn suit" }] }];
  const s = stub(409, { error: "This file is still in use.", code: "MEDIA_IN_USE", details: { mediaId: ID, total: 1, features, products: 1, branding: [] } });
  const result = await deleteMedia(s.fetch, ID);
  assert.equal(s.seen[0]!.method, "DELETE");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.equal(result.usage?.total, 1);
    assert.equal(describeUsage(result.usage!), "Products (1)");
  }
  const done = await deleteMedia(stub(200, { deleted: true }).fetch, ID);
  assert.deepEqual(done, { ok: true, value: true });
});

test("the Theme tab notice names the theme that is not available and the one the store is shown with", () => {
  assert.equal(unavailableThemeNotice("mustafa", "Stiletto"), "The Mustafa theme is not available yet, so your store is shown with Stiletto. Choose Stiletto and save to keep it.");
  assert.match(unavailableThemeNotice("mola", "Stiletto")!, /^The Mola theme is not available yet/);
  assert.equal(unavailableThemeNotice(null, "Stiletto"), null);
  assert.equal(unavailableThemeNotice(undefined, "Stiletto"), null);
  assert.equal(unavailableThemeNotice("", "Stiletto"), null);
});

/** A source file of this package, read from the package folder (the tests run there). */
const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

// The backend's rename schema is strict ({ name } only): a `store` field added by the proxy would be a 400 (the SB-6 lesson). Every media route turns the binding off.
test("every media proxy route has bindStore off on every proxy call, and uses the verified x-store-id instead", () => {
  const routes = ["app/api/proxy/media/[id]/route.ts", "app/api/proxy/media/[id]/usage/route.ts", "app/api/proxy/media/route.ts"];
  for (const path of routes) {
    const text = source(path);
    const calls = text.match(/proxy(Get|Post|Patch|Delete|Put)\(req/g) ?? [];
    const off = text.match(/bindStore:\s*false/g) ?? [];
    assert.ok(calls.length > 0, path);
    assert.equal(off.length, calls.length, path + " must turn bindStore off on every proxy call");
    assert.match(text, /storeScope:\s*"required"/, path);
  }
});

test("the rename route forwards PATCH and DELETE, and the usage route GET, to the backend's media paths", () => {
  const rename = source("app/api/proxy/media/[id]/route.ts");
  assert.match(rename, /export async function PATCH/);
  assert.match(rename, /export async function DELETE/);
  assert.ok(rename.includes("proxyPatch(req, `/api/media/${encodeURIComponent(id)}`"));
  assert.ok(rename.includes("proxyDelete(req, `/api/media/${encodeURIComponent(id)}`"));
  const usage = source("app/api/proxy/media/[id]/usage/route.ts");
  assert.match(usage, /export async function GET/);
  assert.ok(usage.includes("proxyGet(req, `/api/media/${encodeURIComponent(id)}/usage`"));
});
