import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAccess, safeNextPath } from "../lib/access";

test("the login page and every api route are reachable without a cookie", () => {
  assert.deepEqual(decideAccess("/login", false), { action: "allow" });
  assert.deepEqual(decideAccess("/api/session", false), { action: "allow" });
  assert.deepEqual(decideAccess("/api/me", false), { action: "allow" });
});

test("a page without a cookie is sent to login, remembering where it was going", () => {
  assert.deepEqual(decideAccess("/", false), { action: "redirect", to: "/login" });
  assert.deepEqual(decideAccess("/stores", false), { action: "redirect", to: "/login?next=%2Fstores" });
});

test("a request with a cookie continues; the layout verifies it with the backend", () => {
  assert.deepEqual(decideAccess("/stores", true), { action: "allow" });
});

test("the login page is never redirected away on the cookie alone", () => {
  assert.deepEqual(decideAccess("/login", true), { action: "allow" });
});

test("the next path accepts same-site paths only", () => {
  assert.equal(safeNextPath("/stores"), "/stores");
  assert.equal(safeNextPath("/stores?x=1"), "/stores?x=1");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath("/\\evil"), "/");
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath(""), "/");
});
