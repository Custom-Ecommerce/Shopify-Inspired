import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, refCookie, refFromCookies, refFromSearch, signupRef } from "../lib/referral-cookie";
import { OFF_TEXT, earnedText, howItWorksText, joinedText, rewardText, shareText, statusText } from "../lib/referrals-view";
import { roleCan, roleSeesMenu } from "../lib/role-access";

// Sprint 8 (S8-B5, D-118): remembering ?ref= through signup, and the read-only referrals page.

const read = (path: string) => readFileSync(join(process.cwd(), ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
const CODE = "SANA2345";

test("?ref= is read only when it is a well-formed code", () => {
  assert.equal(refFromSearch("?ref=" + CODE), CODE);
  assert.equal(refFromSearch("?next=%2F&ref=" + CODE.toLowerCase()), CODE);
  for (const search of ["", "?ref=", "?ref=abc", "?ref=SANA234O", "?ref=<script>", "?other=" + CODE]) assert.equal(refFromSearch(search), null, search);
});

test("the cookie holds only the code, for 7 days, SameSite=Lax, readable by the page, Secure on https", () => {
  assert.equal(REFERRAL_COOKIE_MAX_AGE, 604800);
  assert.equal(refCookie(CODE, false), "markaz-ref=SANA2345; Path=/; Max-Age=604800; SameSite=Lax");
  assert.equal(refCookie(CODE, true), "markaz-ref=SANA2345; Path=/; Max-Age=604800; SameSite=Lax; Secure");
  assert.doesNotMatch(refCookie(CODE, true), /HttpOnly|Domain=/i);
});

test("the remembered code is read back; a tampered value is ignored", () => {
  assert.equal(refFromCookies("a=1; " + REFERRAL_COOKIE + "=" + CODE + "; b=2"), CODE);
  for (const cookies of ["", "a=1", "markaz-ref=", "markaz-ref=nope", "x-markaz-ref=" + CODE]) assert.equal(refFromCookies(cookies), null, cookies);
});

test("a signup sends the code of the address first, else the remembered one (after a detour through email the address has none)", () => {
  assert.equal(signupRef("?ref=NEWC2345", "markaz-ref=" + CODE), "NEWC2345");
  assert.equal(signupRef("", "markaz-ref=" + CODE), CODE);
  assert.equal(signupRef("", ""), null);
});

test("the signup page remembers the code, and the portal route forwards it and clears the cookie once signup completes", () => {
  const page = read("app/signup/page.tsx");
  assert.match(page, /document\.cookie = refCookie\(/);
  assert.match(page, /signupRef\(window\.location\.search, document\.cookie\)/);
  const route = read("app/api/auth/signup/route.ts");
  assert.match(route, /req\.cookies\.get\(REFERRAL_COOKIE\)/);
  assert.match(route, /response\.cookies\.set\(REFERRAL_COOKIE, "", \{ path: "\/", maxAge: 0/);
  // Cleared on the success response only: it comes after the last error return.
  assert.ok(route.indexOf('response.cookies.set(REFERRAL_COOKIE, ""') > route.lastIndexOf("{ status:"));
});

test("the words of the page and of a row", () => {
  assert.equal(howItWorksText({ enabled: false, rewardMonths: 0, monthlyCap: 5 }), OFF_TEXT);
  assert.match(howItWorksText({ enabled: true, rewardMonths: 1, monthlyCap: 5 }), /1 free month, for at most 5 referrals a month/);
  assert.equal(statusText({ status: "pending" }), "Pending");
  assert.equal(statusText({ status: "rewarded" }), "Rewarded");
  assert.equal(rewardText({ status: "pending", monthsRewarded: 0 }), "No reward yet");
  assert.equal(rewardText({ status: "rewarded", monthsRewarded: 2 }), "2 free months");
  assert.match(joinedText({ createdAt: "2026-11-20T20:00:00.000Z" }), /^Joined 21 Nov/);
  assert.equal(earnedText({ referred: 3, pending: 2, rewarded: 1, monthsEarned: 1 }), "1 free month earned from 1 of 3 referred");
  assert.equal(shareText({ code: CODE, shareLink: "https://s.test/signup?ref=" + CODE }), "https://s.test/signup?ref=" + CODE);
  assert.equal(shareText({ code: CODE, shareLink: null }), CODE);
});

test("owner only: the menu entry and the page", () => {
  assert.equal(roleCan("owner", "referrals.read"), true);
  assert.equal(roleSeesMenu("owner", "/referrals"), true);
  for (const role of ["manager", "staff", "support"]) {
    assert.equal(roleCan(role, "referrals.read"), false, role);
    assert.equal(roleSeesMenu(role, "/referrals"), false, role);
  }
});

test("the page is read only, never shows an email, and fits a 375 px screen", () => {
  const page = read("app/(dashboard)/s/[storeId]/referrals/page.tsx");
  assert.match(page, /roleCan\(activeStore\.role, "referrals\.read"\)/);
  assert.doesNotMatch(page, /method:|<form|\.email|referred\./, "nothing is written and no email exists to show");
  assert.match(page, /w-full max-w-3xl min-w-0/, "the column shrinks with the screen");
  assert.match(page, /block break-all/, "the long link wraps instead of scrolling the page");
  assert.match(page, /min-h-11 w-full sm:w-auto/, "the copy button fills the card and is a thumb target");
  assert.match(page, /flex-col gap-2 py-4 sm:flex-row/, "a row stacks on a phone");
  assert.doesNotMatch(page, /<table|DataTable|min-w-\[|w-\[\d{3,}px\]/, "nothing wider than the screen");
});

test("the portal route asks the backend with no parameters", () => {
  const route = read("app/api/dashboard/referrals/route.ts");
  assert.match(route, /proxyGet\(req, "\/api\/referrals"/);
  assert.doesNotMatch(route, /where\[|searchParams|depth/);
});
