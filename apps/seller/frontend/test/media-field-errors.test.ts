import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxyGet } from "../lib/proxy";

// Sprint 7 (S7-B1): field-error passthrough for the new media and theme answers. The BFF keeps the backend's code, field and where-used list, so a form
// can mark the field and the delete dialog can name the places. (Same pattern as field-error-passthrough.test.ts.)
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backendAnswers(status: number, payload: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

const ask = (path: string) => proxyGet(new NextRequest("http://seller.test/api/proxy/x"), path, { auth: "none" });

test("a 400 MEDIA_RENAME_INVALID from the backend reaches the browser with its code and field", async () => {
  backendAnswers(400, { errors: [{ message: "Only the name of a file can be changed." }], code: "MEDIA_RENAME_INVALID", field: "url" });
  const res = await ask("/api/media/1");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; code: string; field?: string };
  assert.equal(body.code, "MEDIA_RENAME_INVALID");
  assert.equal(body.field, "url");
  assert.match(body.error, /name of a file/);
});

test("a 409 MEDIA_IN_USE from the backend keeps where the file is used, so the dashboard can name the places", async () => {
  const features = [{ key: "products", label: "Products", count: 2, items: [{ id: "65a000000000000000000301", title: "Lawn suit" }] }];
  backendAnswers(409, {
    errors: [{ message: "This file is still in use. Remove it from the places listed first." }],
    code: "MEDIA_IN_USE",
    mediaId: "65a000000000000000000101",
    inUse: true,
    total: 2,
    features,
    products: 2,
    branding: [],
  });
  const res = await ask("/api/media/1");
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code: string; details?: { features?: unknown; total?: number; products?: number; branding?: unknown } };
  assert.equal(body.code, "MEDIA_IN_USE");
  assert.deepEqual(body.details?.features, features);
  assert.equal(body.details?.total, 2);
  assert.equal(body.details?.products, 2);
  assert.deepEqual(body.details?.branding, []);
});

test("a 422 THEME_NOT_AVAILABLE from the backend reaches the browser with its code and field", async () => {
  backendAnswers(422, { errors: [{ message: "This theme is not available yet. Choose Stiletto." }], code: "THEME_NOT_AVAILABLE", field: "theme.activeTheme" });
  const res = await ask("/api/stores/1");
  assert.equal(res.status, 422);
  const body = (await res.json()) as { code: string; field?: string; error: string };
  assert.equal(body.code, "THEME_NOT_AVAILABLE");
  assert.equal(body.field, "theme.activeTheme");
  assert.match(body.error, /not available yet/);
});

test("another error code never gets the media usage details", async () => {
  backendAnswers(409, { errors: [{ message: "Conflict" }], code: "CATEGORY_IN_USE", features: [{ key: "x" }], total: 9 });
  const res = await ask("/api/categories/1");
  const body = (await res.json()) as { code: string; details?: unknown };
  assert.equal(body.code, "CATEGORY_IN_USE");
  assert.ok(!JSON.stringify(body.details ?? null).includes('"features"'), "only MEDIA_IN_USE carries the usage list");
});
