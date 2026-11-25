import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAYOUT_METHOD_LABELS,
  PAYOUT_STATUS_LABELS,
  accountSummary,
  describePayout,
  describeVoid,
  entriesLabel,
  formatRupees,
  payBlockReason,
  payoutFormIssues,
  reportBreakdown,
  reportInputIssue,
  reportQuery,
} from "../lib/payouts";
import { COMMISSION_VIEWS, VIEW_LABELS, commissionStateToUrl, parseCommissionState } from "../lib/commission";
import { toneOf } from "../lib/status";

// Sprint 4 EP-05.US03, US06: the wording, checks and queries of the payout screens. Pure functions.

const ready = { balance: 2110, hasPayoutDetails: true, emailVerified: true, hasPendingPayout: false };

test("money is whole rupees with separators, and a negative balance shows its sign", () => {
  assert.equal(formatRupees(0), "Rs. 0");
  assert.equal(formatRupees(2110), "Rs. 2,110");
  assert.equal(formatRupees(1234567), "Rs. 1,234,567");
  assert.equal(formatRupees(-500), "-Rs. 500");
  assert.equal(formatRupees(1234.6), "Rs. 1,235");
  assert.equal(formatRupees(Number.NaN), "-");
  assert.equal(entriesLabel(1), "1 entry");
  assert.equal(entriesLabel(3), "3 entries");
});

test("the create form needs a method and a reference, and bounds the reference and the note", () => {
  assert.deepEqual(payoutFormIssues({ method: "jazzcash", reference: "JC-778812", note: "" }), {});
  assert.ok(payoutFormIssues({ method: "cheque", reference: "R", note: "" }).method);
  assert.ok(payoutFormIssues({ method: "bank", reference: "   ", note: "" }).reference);
  assert.ok(payoutFormIssues({ method: "bank", reference: "x".repeat(101), note: "" }).reference);
  assert.ok(payoutFormIssues({ method: "bank", reference: "R", note: "y".repeat(501) }).note);
  assert.equal(payoutFormIssues({ method: "bank", reference: "x".repeat(100), note: "y".repeat(500) }).reference, undefined);
});

test("a balance row can be paid only with a positive balance, payout details, a verified email and no stuck payout", () => {
  assert.equal(payBlockReason(ready), null);
  assert.match(payBlockReason({ ...ready, balance: 0 })!, /Nothing to pay/);
  assert.match(payBlockReason({ ...ready, balance: -300 })!, /carries forward/);
  assert.match(payBlockReason({ ...ready, hasPayoutDetails: false })!, /payout details/);
  assert.match(payBlockReason({ ...ready, emailVerified: false })!, /verified/);
  assert.match(payBlockReason({ ...ready, hasPendingPayout: true })!, /stuck/);
  assert.match(payBlockReason({ ...ready, hasPendingPayout: true, balance: -1 })!, /stuck/, "a stuck payout is named first");
});

test("the confirmation sentence says what is recorded: amount, store, method, reference", () => {
  const sentence = describePayout("Zara Lawn", 2110, "jazzcash", " JC-778812 ");
  for (const part of ["Rs. 2,110", "Zara Lawn", "JazzCash", "reference JC-778812.", "told by email", "void it later"]) assert.ok(sentence.includes(part), part);
  assert.ok(describePayout("Zara Lawn", 5, "unknown", "R").includes("by unknown"), "an unknown method is shown as it is");
  const voided = describeVoid("Zara Lawn", 2110);
  for (const part of ["Rs. 2,110", "Zara Lawn", "count in the store's balance again", "told by email"]) assert.ok(voided.includes(part), part);
});

test("a stored account is summarised by its method and last 4, never more", () => {
  assert.equal(accountSummary("jazzcash", "4567"), "JazzCash, ending 4567");
  assert.equal(accountSummary("bank", "6702"), "Bank transfer, ending 6702");
  assert.equal(accountSummary(null, null), "No payout details");
  assert.equal(accountSummary("bank", ""), "No payout details");
  assert.deepEqual(Object.keys(PAYOUT_METHOD_LABELS).sort(), ["bank", "easypaisa", "jazzcash"]);
});

test("the report query sends the custom days only for a custom period, and format only when asked", () => {
  const store = "65a000000000000000000011";
  assert.equal(reportQuery({ storeId: store, period: "30", from: "2026-11-01", to: "2026-11-30" }), "storeId=" + store + "&period=30");
  assert.equal(reportQuery({ storeId: store, period: "custom", from: "2026-11-01", to: "2026-11-30" }), "storeId=" + store + "&period=custom&from=2026-11-01&to=2026-11-30");
  assert.equal(reportQuery({ storeId: store, period: "7", from: "", to: "" }, "csv"), "storeId=" + store + "&period=7&format=csv");
});

test("a custom report period needs both days with the first not after the last", () => {
  assert.equal(reportInputIssue({ period: "30", from: "", to: "" }), null);
  assert.ok(reportInputIssue({ period: "custom", from: "", to: "" }));
  assert.ok(reportInputIssue({ period: "custom", from: "2026-11-01", to: "" }));
  assert.ok(reportInputIssue({ period: "custom", from: "2026-11-10", to: "2026-11-01" }));
  assert.equal(reportInputIssue({ period: "custom", from: "2026-11-01", to: "2026-11-01" }), null);
});

test("every payout status has a label and a tone; a payout that needs the operator warns", () => {
  assert.deepEqual(Object.keys(PAYOUT_STATUS_LABELS).sort(), ["failed", "paid", "pending_settle", "voided"]);
  assert.equal(toneOf("paid"), "success");
  assert.equal(toneOf("pending_settle"), "warning");
  assert.equal(toneOf("failed"), "danger");
  assert.equal(toneOf("voided"), "neutral");
});

test("the commission page has payout views, which keep the page and search in the URL and carry no ledger filter", () => {
  assert.deepEqual([...COMMISSION_VIEWS], ["rates", "history", "payouts", "payout-history"]);
  assert.ok(!(COMMISSION_VIEWS as readonly string[]).includes("ledger"), "the old ledger tab was removed (SB-11)");
  for (const view of COMMISSION_VIEWS) assert.ok(VIEW_LABELS[view], view);
  assert.deepEqual(parseCommissionState(new URLSearchParams("view=payouts&page=2&q=zara&status=settled&mode=custom")), { view: "payouts", page: 2, q: "zara", status: "", mode: "" });
  assert.equal(commissionStateToUrl({ view: "payout-history", page: 3, q: "", status: "", mode: "" }), "view=payout-history&page=3");
  assert.equal(parseCommissionState(new URLSearchParams("view=payout-history")).view, "payout-history");
  assert.equal(parseCommissionState(new URLSearchParams("view=payout")).view, "rates");
});

// Sprint 6 EP-12.US04.T04 (D-116): the commission report labels its cash on delivery and gateway lines.

test("the report breakdown has a cash on delivery line and a gateway line, and says when COD carried no commission", () => {
  const lines = reportBreakdown({ cod: { commissionEarned: 0, sales: 5000, ordersCount: 3 }, gateway: { commissionEarned: 60, sales: 1500, ordersCount: 1 } });
  assert.deepEqual(lines, [
    { key: "cod", label: "Cash on delivery", commissionEarned: 0, sales: 5000, ordersCount: 3, noCommission: true },
    { key: "gateway", label: "Gateway (card)", commissionEarned: 60, sales: 1500, ordersCount: 1, noCommission: false },
  ]);
});

test("a COD line with a commission is not worded as no commission, and an empty COD line is not either", () => {
  assert.equal(reportBreakdown({ cod: { commissionEarned: 100, sales: 5000, ordersCount: 3 } })![0]!.noCommission, false);
  assert.equal(reportBreakdown({ cod: { commissionEarned: 0, sales: 0, ordersCount: 0 } })![0]!.noCommission, false);
});

test("a report without the split (an older backend) has no breakdown", () => {
  assert.equal(reportBreakdown({}), null);
});
