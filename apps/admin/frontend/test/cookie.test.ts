import { test } from "node:test";
import assert from "node:assert/strict";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, clearedSessionCookie, sessionCookie } from "../lib/cookie";

test("the cookie name is markaz-admin-session, distinct from the seller console", () => {
  assert.equal(SESSION_COOKIE, "markaz-admin-session");
});

test("the session cookie is HttpOnly, same-site lax, site-wide, and lives eight hours", () => {
  const cookie = sessionCookie("tok", false);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/");
  assert.equal(cookie.maxAge, SESSION_MAX_AGE_SECONDS);
  assert.equal(SESSION_MAX_AGE_SECONDS, 28800);
});

test("the cookie is Secure in production only", () => {
  assert.equal(sessionCookie("tok", true).secure, true);
  assert.equal(sessionCookie("tok", false).secure, false);
});

test("the cleared cookie is empty and expires at once", () => {
  const cookie = clearedSessionCookie(true);
  assert.equal(cookie.value, "");
  assert.equal(cookie.maxAge, 0);
  assert.equal(cookie.secure, true);
});
