import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API_DOCS_HREF,
  API_KEY_NAME_MAX,
  API_KEY_SCOPES,
  SCOPE_COPY,
  SECRET_ONCE_NOTE,
  createProblems,
  createdText,
  isLive,
  keyStatusText,
  keyUsageText,
  lastUsedText,
  revokeConfirmText,
  scopesText,
  toggleScope,
} from "../lib/api-keys-view";

// Sprint 8 (S8-B4, D-118): the pure half of the API keys page, its portal routes and the served copy of the docs.

const read = (path: string) => readFileSync(join(process.cwd(), ...path.split("/")), "utf8").replace(/\r\n/g, "\n");

test("the two read scopes, each with words for the owner", () => {
  assert.deepEqual([...API_KEY_SCOPES], ["products:read", "orders:read"]);
  for (const scope of API_KEY_SCOPES) assert.ok(SCOPE_COPY[scope].name && SCOPE_COPY[scope].help);
  assert.equal(scopesText(["products:read", "orders:read"]), "Read products, Read orders");
});

test("the create form names the field that is wrong", () => {
  assert.deepEqual(createProblems({ name: "Warehouse sync", scopes: ["products:read"] }), {});
  assert.deepEqual(Object.keys(createProblems({ name: "  ", scopes: ["products:read"] })), ["name"]);
  assert.deepEqual(Object.keys(createProblems({ name: "x".repeat(API_KEY_NAME_MAX + 1), scopes: ["orders:read"] })), ["name"]);
  assert.deepEqual(Object.keys(createProblems({ name: "<b>", scopes: ["orders:read"] })), ["name"]);
  assert.deepEqual(Object.keys(createProblems({ name: "ok", scopes: [] })), ["scopes"]);
  assert.deepEqual(Object.keys(createProblems({ name: "ok", scopes: ["orders:write"] })), ["scopes"]);
});

test("ticking a permission keeps the list in a fixed order with no repeats", () => {
  assert.deepEqual(toggleScope(["orders:read"], "products:read", true), ["products:read", "orders:read"]);
  assert.deepEqual(toggleScope(["products:read"], "products:read", true), ["products:read"]);
  assert.deepEqual(toggleScope(["products:read", "orders:read"], "products:read", false), ["orders:read"]);
});

test("a key row says whether it is live, when it was made and last used", () => {
  assert.equal(isLive({ revokedAt: null }), true);
  assert.equal(isLive({ revokedAt: "2026-11-20T10:00:00.000Z" }), false);
  assert.equal(keyStatusText({ revokedAt: null }), "Active");
  assert.match(keyStatusText({ revokedAt: "2026-11-20T10:00:00.000Z" }), /^Revoked 20 Nov/);
  assert.equal(lastUsedText({ lastUsedAt: null }), "Never used");
  assert.match(lastUsedText({ lastUsedAt: "2026-11-20T10:00:00.000Z" }), /^Last used 20 Nov/);
  assert.match(createdText({ createdAt: "2026-11-20T20:00:00.000Z" }), /^Created 21 Nov/, "the date of Pakistan");
});

test("the usage line, the once-only note and the revoke confirm", () => {
  assert.equal(keyUsageText({ used: 1, limit: 2 }), "1 of 2 keys in use");
  assert.equal(keyUsageText({ used: 0, limit: 1 }), "0 of 1 key in use");
  assert.equal(keyUsageText({ used: 3, limit: null }), "3 active keys");
  assert.match(SECRET_ONCE_NOTE, /You will not see it again/);
  assert.match(revokeConfirmText({ name: "Sync" }), /"Sync" stops working at once/);
});

test("the page shows the secret once: it is never put in storage, a URL or the console, and the docs are linked", () => {
  const page = read("app/(dashboard)/s/[storeId]/api-keys/page.tsx");
  assert.doesNotMatch(page, /localStorage|sessionStorage|console\.|document\.cookie|searchParams/);
  assert.match(page, /SECRET_ONCE_NOTE/);
  assert.match(page, /clipboard\.writeText\(secret\)/);
  assert.match(page, /API_DOCS_HREF/);
  assert.match(page, /canUse\(activeStore\.role, "apiKeys"\)/);
});

test("the docs the portal serves are the docs of the repository, word for word", () => {
  assert.equal(API_DOCS_HREF, "/docs/api-v1.md");
  assert.equal(read("public/docs/api-v1.md"), read("../../../docs/api-v1.md"));
});

test("the team and key portal routes use the store helpers that do not bind body.store (the backend schemas are strict)", () => {
  const helpers = read("lib/store-proxy.ts");
  assert.equal((helpers.match(/export function proxyStore/g) ?? []).length, (helpers.match(/bindStore: false/g) ?? []).length);
  const routes: Record<string, RegExp[]> = {
    "team/route.ts": [/proxyStoreGet\(/],
    "team/invite/route.ts": [/proxyStorePostBody\(/],
    "team/[memberId]/route.ts": [/proxyStorePatchBody\(/],
    "team/[memberId]/[action]/route.ts": [/isMemberAction\(action\)/, /proxyStorePostBody\(/],
    "api-keys/route.ts": [/proxyStoreGet\(/, /proxyStorePostBody\(/],
    "api-keys/[keyId]/revoke/route.ts": [/proxyStorePost\(/],
  };
  for (const [file, expected] of Object.entries(routes)) {
    const source = read("app/api/proxy/stores/[id]/" + file);
    for (const pattern of expected) assert.match(source, pattern, file);
    assert.doesNotMatch(source, /\bproxy(Post|Patch|Put)\(/, file + " goes through the store helpers only");
  }
});
