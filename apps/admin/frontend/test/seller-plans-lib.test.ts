import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminSellerPlansResponseSchema } from "../lib/contracts";
import {
  PLAN_STATUS_TEXT,
  PLAN_STATUS_TONE,
  apiKeysText,
  atLimit,
  daysLeftText,
  planSummaryLine,
  plansBySeller,
  sellerIdsOf,
  usageText,
} from "../lib/seller-plans";

// Sprint 6 EP-14.US02.T08 (D-118): the wording of the sellers page's plan column. Pure functions.

const limits = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true };
const used = { stores: 1, products: 12, staffSeats: 0, apiKeys: 0 };
const row = (sellerId: string, status: "trial" | "active" | "grace" | "expired" | "cancelled" | "none", daysLeft: number | null) => ({
  sellerId,
  plan: { key: "growth", name: "Growth" },
  status,
  periodEnd: null,
  daysLeft,
  limits,
  used,
});
const A = "65a000000000000000000001";
const B = "65a000000000000000000002";

test("every status has a label and a tone", () => {
  for (const status of ["trial", "active", "grace", "expired", "cancelled", "none"] as const) {
    assert.ok(PLAN_STATUS_TEXT[status], status);
    assert.ok(PLAN_STATUS_TONE[status], status);
  }
  assert.equal(PLAN_STATUS_TEXT.none, "No subscription");
  assert.equal(PLAN_STATUS_TEXT.grace, "Grace period");
});

test("usage reads 'N of M' and 'N of unlimited'; a seller at or over a limit is marked, an unlimited one never", () => {
  assert.equal(usageText(1, 3), "1 of 3");
  assert.equal(usageText(12, null), "12 of unlimited");
  assert.equal(usageText(1500, 2000), "1500 of 2,000");
  assert.equal(atLimit(3, 3), true);
  assert.equal(atLimit(5, 3), true, "over the limit is at the limit");
  assert.equal(atLimit(2, 3), false);
  assert.equal(atLimit(9999, null), false);
  assert.equal(atLimit(0, 0), true);
});

test("days left: today, one day, many days, and nothing without a date", () => {
  assert.equal(daysLeftText(null), "");
  assert.equal(daysLeftText(0), "ends today");
  assert.equal(daysLeftText(1), "1 day left");
  assert.equal(daysLeftText(9), "9 days left");
});

test("the summary line joins the status and the days left", () => {
  assert.equal(planSummaryLine({ status: "active", daysLeft: 9 }), "Active, 9 days left");
  assert.equal(planSummaryLine({ status: "grace", daysLeft: 0 }), "Grace period, ends today");
  assert.equal(planSummaryLine({ status: "expired", daysLeft: null }), "Expired");
  assert.equal(planSummaryLine({ status: "none", daysLeft: null }), "No subscription");
});

test("the rows are found by seller id, the ids asked for are the page's, once each", () => {
  const map = plansBySeller([row(A, "active", 9), row(B, "none", null)]);
  assert.equal(map.get(A)?.status, "active");
  assert.equal(map.get(B)?.plan.name, "Growth");
  assert.equal(map.get("65a000000000000000000099"), undefined, "a seller the call did not answer for has no plan: the column shows a dash");
  assert.deepEqual(sellerIdsOf([{ id: A }, { id: B }, { id: A }]), [A, B]);
  assert.deepEqual(sellerIdsOf([]), []);
});

test("the contract the page reads: an answer parses, a bad status or a fractional count does not", () => {
  assert.equal(adminSellerPlansResponseSchema.safeParse({ plans: [row(A, "active", 9)] }).success, true);
  assert.equal(adminSellerPlansResponseSchema.safeParse({ plans: [{ ...row(A, "active", 9), status: "paused" }] }).success, false);
  assert.equal(adminSellerPlansResponseSchema.safeParse({ plans: [{ ...row(A, "active", 9), used: { ...used, stores: 1.5 } }] }).success, false);
  assert.equal(adminSellerPlansResponseSchema.safeParse({ plans: [] }).success, true);
});

test("S8-B5: the API key count per seller, read from the usage of the same signed call", () => {
  assert.equal(apiKeysText({ used: { ...used, apiKeys: 2 }, limits }), "API keys 2 of 3");
  assert.equal(apiKeysText({ used, limits: { ...limits, apiKeys: null } }), "API keys 0 of unlimited");
  assert.match(readFileSync(join(process.cwd(), "components", "sellers", "sellers-view.tsx"), "utf8"), /apiKeysText\(plan\)/);
});

test("the sellers list stacks on a phone, so the member counts, plan and action buttons are not pushed off the screen", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), ...path.split("/")), "utf8");
  assert.match(read("components/sellers/sellers-view.tsx"), /label="Sellers"\s+stackOnPhone/);
  const table = read("components/shared/data-table.tsx");
  for (const part of ["max-md:hidden", "max-md:block max-md:whitespace-normal", "stackOnPhone = false"]) assert.ok(table.includes(part), part);
});
