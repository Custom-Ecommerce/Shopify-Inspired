import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRs, stockReasonLabel, stockStatusLabel } from "../lib/format";
import { discountPercent } from "../lib/product-pricing";
import { isErrorCode } from "../lib/error-codes";
import { parseStorePath, storeBasePath, storeHref, switchTargetHref } from "../lib/store-routes";

// Sprint 4 SB-9: a baseline for the pure helpers that had no test. No React, no network.

test("storeHref builds a store-scoped path for every shape of relative path", () => {
  assert.equal(storeHref("42"), "/s/42");
  assert.equal(storeHref("42", "/"), "/s/42");
  assert.equal(storeHref("42", "/orders"), "/s/42/orders");
  assert.equal(storeHref("42", "orders"), "/s/42/orders");
  assert.equal(storeHref("42", "?foo=1"), "/s/42?foo=1");
  assert.equal(storeHref("42", "/orders?status=x"), "/s/42/orders?status=x");
});

test("storeBasePath encodes the store id", () => {
  assert.equal(storeBasePath("a b/c"), "/s/a%20b%2Fc");
});

test("parseStorePath splits a store path and returns null for anything else", () => {
  assert.deepEqual(parseStorePath("/s/42/orders/7"), { storeId: "42", rest: "/orders/7" });
  assert.deepEqual(parseStorePath("/s/42"), { storeId: "42", rest: "" });
  assert.deepEqual(parseStorePath("/s/a%20b/x"), { storeId: "a b", rest: "/x" });
  assert.equal(parseStorePath("/login"), null);
  assert.equal(parseStorePath("/s/"), null);
});

test("switchTargetHref keeps the section and drops the detail route", () => {
  assert.equal(switchTargetHref("9", "/orders/123"), "/s/9/orders");
  assert.equal(switchTargetHref("9", "/products/new"), "/s/9/products");
  assert.equal(switchTargetHref("9", ""), "/s/9");
});

test("formatRs prints whole rupees with a fixed locale", () => {
  assert.equal(formatRs(0), "Rs. 0");
  assert.equal(formatRs(4500), "Rs. 4,500");
  assert.equal(formatRs(1250000), "Rs. 1,250,000");
});

test("stock labels: known values are worded, unknown ones are shown readably", () => {
  assert.equal(stockStatusLabel("in_stock"), "In stock");
  assert.equal(stockStatusLabel("out_of_stock"), "Out of stock");
  assert.equal(stockStatusLabel("on_backorder"), "On backorder");
  assert.equal(stockReasonLabel("order_cancelled"), "Order cancelled, stock returned");
  assert.equal(stockReasonLabel("counted_by_hand"), "counted by hand");
});

test("discountPercent is a whole percent of the compare-at price", () => {
  assert.equal(discountPercent(800, 1000), 20);
  assert.equal(discountPercent(667, 1000), 33);
});

test("discountPercent is 0 when there is no real saving or the numbers are bad", () => {
  assert.equal(discountPercent(1000, null), 0);
  assert.equal(discountPercent(1000, 1000), 0);
  assert.equal(discountPercent(1200, 1000), 0);
  assert.equal(discountPercent(-5, 1000), 0);
  assert.equal(discountPercent(Number.NaN, 1000), 0);
});

test("isErrorCode accepts the known codes only", () => {
  assert.equal(isErrorCode("FORBIDDEN"), true);
  assert.equal(isErrorCode("UPSTREAM_ERROR"), true);
  assert.equal(isErrorCode("toString"), false);
  assert.equal(isErrorCode(403), false);
  assert.equal(isErrorCode(undefined), false);
});
