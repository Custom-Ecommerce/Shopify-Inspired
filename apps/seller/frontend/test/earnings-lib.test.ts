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

// Sprint 6 EP-12.US04.T03 (D-116): cash on delivery carries no commission while the platform's COD percent is 0.
import {
  codSalesLine,
  commissionRatesText,
  entryAmountText,
  entryTypeText,
  formatPercent,
  isNoCommissionEntry,
  readCommissionRates,
} from "../lib/earnings";

test("a percent has no trailing zero", () => {
  assert.equal(formatPercent(4), "4%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(2.5), "2.5%");
  assert.equal(formatPercent(6.04), "6%");
});

test("the commission answer is read from a newer backend (gatewayRate and codRate) and from an older one (rate and source only)", () => {
  assert.deepEqual(readCommissionRates({ gatewayRate: 6.5, codRate: 2, rate: 6.5, source: "custom" }), { gatewayRate: 6.5, gatewaySource: "custom", codRate: 2 });
  assert.deepEqual(readCommissionRates({ gatewayRate: 4, codRate: 0, rate: 4, source: "default" }), { gatewayRate: 4, gatewaySource: "default", codRate: 0 });
  assert.deepEqual(readCommissionRates({ rate: 4, source: "default" }), { gatewayRate: 4, gatewaySource: "default", codRate: 0 });
  for (const bad of [null, undefined, "x", {}, { rate: "4", source: "default" }, { rate: 4, source: "other" }, { rate: 101, source: "default" }, { gatewayRate: -1, source: "default" }]) {
    assert.equal(readCommissionRates(bad), null, JSON.stringify(bad));
  }
  assert.equal(readCommissionRates({ gatewayRate: 4, codRate: 250, source: "default" })?.codRate, 0);
});

test("while the COD percent is 0 the page says COD has no commission; otherwise it says both rates", () => {
  assert.equal(commissionRatesText({ gatewayRate: 4, gatewaySource: "default", codRate: 0 }), "Card orders 4% (standard rate). Cash on delivery: no commission.");
  assert.equal(commissionRatesText({ gatewayRate: 6.5, gatewaySource: "custom", codRate: 0 }), "Card orders 6.5% (your rate). Cash on delivery: no commission.");
  assert.equal(commissionRatesText({ gatewayRate: 4, gatewaySource: "default", codRate: 2 }), "Card orders 4% (standard rate). Cash on delivery 2%.");
  assert.equal(commissionRatesText({ gatewayRate: 6, gatewaySource: "custom", codRate: 2.5 }), "Card orders 6% (your rate). Cash on delivery 2.5%.");
});

test("a COD ledger row with no commission says so, and a COD row with a commission reads as before", () => {
  const zero = { type: "cod_commission" as const, reversesType: null, amount: 0, rate: 0 };
  assert.equal(isNoCommissionEntry(zero), true);
  assert.equal(entryTypeText(zero), "COD sale (no commission)");
  assert.equal(entryAmountText(zero), "No commission");
  const paid = { type: "cod_commission" as const, reversesType: null, amount: -80, rate: 4 };
  assert.equal(isNoCommissionEntry(paid), false);
  assert.equal(entryTypeText(paid), "COD commission");
  assert.equal(entryAmountText(paid), "-PKR 80");
  const zeroReversal = { type: "reversal" as const, reversesType: "cod_commission" as const, amount: 0, rate: 0 };
  assert.equal(entryTypeText(zeroReversal), "Reversal of COD sale (no commission)");
  assert.equal(entryAmountText(zeroReversal), "No commission");
  assert.equal(entryAmountText({ type: "reversal", reversesType: "cod_commission", amount: 20, rate: 4 }), "+PKR 20");
  // a card row with an amount of 0 is NOT a COD row
  assert.equal(isNoCommissionEntry({ type: "card_commission", amount: 0, rate: 0 }), false);
  assert.equal(entryAmountText({ type: "card_commission", reversesType: null, amount: 0, rate: 0 }), "PKR 0");
});

test("the COD sales line: no commission at 0 percent, the commission paid otherwise, nothing without COD sales", () => {
  const zeroRates = { gatewayRate: 4, gatewaySource: "default" as const, codRate: 0 };
  assert.equal(codSalesLine({ orders: 3, sales: 6000, commission: 0 }, zeroRates), "Cash on delivery sales: PKR 6,000 (3 orders), no commission.");
  assert.equal(codSalesLine({ orders: 1, sales: 2000, commission: 0 }, zeroRates), "Cash on delivery sales: PKR 2,000 (1 order), no commission.");
  assert.equal(codSalesLine({ orders: 2, sales: 3000, commission: 60 }, { ...zeroRates, codRate: 2 }), "Cash on delivery sales: PKR 3,000 (2 orders), commission PKR 60.");
  // with a COD percent above 0 the line states the commission, even when this period's COD sales were collected while it was 0 (PKR 0)
  assert.equal(codSalesLine({ orders: 2, sales: 3000, commission: 0 }, { ...zeroRates, codRate: 2 }), "Cash on delivery sales: PKR 3,000 (2 orders), commission PKR 0.");
  assert.equal(codSalesLine({ orders: 0, sales: 0, commission: 0 }, zeroRates), null);
  assert.equal(codSalesLine(undefined, zeroRates), null);
  assert.equal(codSalesLine({ orders: 2, sales: 3000, commission: 0 }, null), "Cash on delivery sales: PKR 3,000 (2 orders), no commission.");
});
