import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NAV_GROUPS, visibleNavGroups } from "../components/dashboard/nav-config";
import {
  datesText,
  monthsText,
  parseReferralListState,
  rangeProblem,
  referralExportHref,
  referralStateToQuery,
  voidedText,
} from "../lib/referrals";

// Sprint 8 (S8-B6, D-118): the read-only Referrals page of the console.

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), ...file.split("/")), "utf8");

test("the list state comes from the URL; nonsense falls back to the defaults", () => {
  assert.deepEqual(parseReferralListState(new URLSearchParams("")), { page: 1, status: "all", q: "", from: "", to: "" });
  assert.deepEqual(parseReferralListState(new URLSearchParams("page=3&status=capped&q= sana &from=2026-11-01&to=2026-11-30")), { page: 3, status: "capped", q: "sana", from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(parseReferralListState(new URLSearchParams("page=0&status=paid&from=yesterday")), { page: 1, status: "all", q: "", from: "", to: "" });
});

test("the query leaves out the defaults, and the export link carries the days only", () => {
  const state = { page: 2, status: "rewarded" as const, q: "sana", from: "2026-11-01", to: "" };
  assert.equal(referralStateToQuery(state), "page=2&status=rewarded&q=sana&from=2026-11-01");
  assert.equal(referralStateToQuery({ page: 1, status: "all", q: "", from: "", to: "" }), "");
  assert.equal(referralExportHref(state), "/api/referrals/export?from=2026-11-01");
  assert.equal(referralExportHref({ from: "", to: "" }), "/api/referrals/export");
  assert.equal(rangeProblem("2026-11-30", "2026-11-01"), "The start date is after the end date.");
  assert.equal(rangeProblem("2026-11-01", ""), null);
});

test("a row's words, and the note when the earning payment was voided", () => {
  assert.equal(monthsText({ status: "rewarded", months: 1 }), "1 free month");
  assert.equal(monthsText({ status: "capped", months: 0 }), "No reward");
  assert.equal(datesText({ createdAt: "2026-11-01T10:00:00.000Z", rewardedAt: "2026-11-20T10:00:00.000Z" }), "Signed up 1 Nov 2026, rewarded 20 Nov 2026");
  assert.equal(voidedText({ paymentVoidedAt: null }), null);
  assert.match(voidedText({ paymentVoidedAt: "2026-11-22T10:00:00.000Z" })!, /not taken back/);
});

test("the menu entry needs referrals.read", () => {
  const item = NAV_GROUPS.flatMap((group) => group.items).find((entry) => entry.href === "/referrals")!;
  assert.equal(item.capability, "referrals.read");
  assert.equal(visibleNavGroups(["plans.read"]).some((group) => group.items.some((entry) => entry.href === "/referrals")), false);
});

test("the page is read only and fits a 375 px screen", () => {
  const view = read("components/referrals/referrals-view.tsx");
  assert.doesNotMatch(view, /method:|useAdminMutation|<form/, "nothing is written");
  assert.match(view, /w-full max-w-4xl min-w-0/);
  assert.match(view, /grid-cols-1 gap-3 sm:grid-cols-3/, "the filters stack on a phone");
  assert.match(view, /break-all/, "a long email wraps");
  assert.match(view, /min-h-11/);
  assert.doesNotMatch(view, /<table|DataTable|min-w-\[|w-\[\d{3,}px\]/);
});

test("the proxy forwards only the known filters", () => {
  assert.match(read("app/api/referrals/route.ts"), /\["status", "q", "from", "to", "page", "limit"\]/);
  assert.match(read("app/api/referrals/export/route.ts"), /const ALLOWED = \["from", "to"\] as const;/);
});
