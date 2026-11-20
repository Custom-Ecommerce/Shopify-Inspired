import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  PERIOD_LABELS,
  balanceHint,
  customRangeProblem,
  earningsQuery,
  entryLabel,
  formatPkr,
  formatSignedPkr,
  payoutStatusLabel,
} from "../lib/earnings";

// Sprint 4 EP-05.US04: the wording and the query of the seller's earnings page. Pure functions.

test("money is whole rupees; a negative amount keeps its sign and a signed one says + or -", () => {
  assert.equal(formatPkr(0), "PKR 0");
  assert.equal(formatPkr(12500), "PKR 12,500");
  assert.equal(formatPkr(-500), "-PKR 500");
  assert.equal(formatPkr(99.6), "PKR 100");
  assert.equal(formatPkr(Number.NaN), "-");
  assert.equal(formatSignedPkr(2000), "+PKR 2,000");
  assert.equal(formatSignedPkr(-80), "-PKR 80");
  assert.equal(formatSignedPkr(0), "PKR 0");
});

test("every ledger entry type has a label, and a reversal says what it reverses", () => {
  for (const type of ENTRY_TYPES) assert.ok(ENTRY_TYPE_LABELS[type], type);
  assert.equal(entryLabel({ type: "cod_commission", reversesType: null }), "COD commission");
  assert.equal(entryLabel({ type: "card_sale", reversesType: null }), "Card sale");
  assert.equal(entryLabel({ type: "reversal", reversesType: "card_commission" }), "Reversal of card commission");
  assert.equal(entryLabel({ type: "reversal", reversesType: null }), "Reversal");
  assert.deepEqual(Object.keys(PERIOD_LABELS).sort(), ["30", "7", "90", "custom", "today"]);
});

test("the query leaves out the defaults and sends custom days only for a custom period", () => {
  assert.equal(earningsQuery({ period: "30", from: "", to: "", page: 1, type: "" }), "");
  assert.equal(earningsQuery({ period: "7", from: "2026-11-01", to: "2026-11-05", page: 1, type: "" }), "period=7");
  assert.equal(earningsQuery({ period: "today", from: "", to: "", page: 2, type: "reversal" }), "period=today&page=2&type=reversal");
  assert.equal(earningsQuery({ period: "custom", from: "2026-11-01", to: "2026-11-05", page: 1, type: "" }), "period=custom&from=2026-11-01&to=2026-11-05");
});

test("a custom range needs both days with the first not after the last", () => {
  assert.ok(customRangeProblem("", ""));
  assert.ok(customRangeProblem("2026-11-01", ""));
  assert.ok(customRangeProblem("2026-11-10", "2026-11-01"));
  assert.equal(customRangeProblem("2026-11-01", "2026-11-01"), null);
  assert.equal(customRangeProblem("2026-11-01", "2026-11-30"), null);
});

test("what the page says about the balance and about a payout", () => {
  assert.match(balanceHint(100), /Not paid out yet/);
  assert.match(balanceHint(-100), /You owe the platform/);
  assert.match(balanceHint(0), /Nothing is waiting/);
  assert.equal(payoutStatusLabel("paid"), "Paid");
  assert.equal(payoutStatusLabel("voided"), "Cancelled");
  assert.equal(payoutStatusLabel("failed"), "Failed");
  assert.equal(payoutStatusLabel("pending_settle"), "Processing");
});
