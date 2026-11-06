import { test } from "node:test";
import assert from "node:assert/strict";
import { discountPercent, productAvailability, variantAvailability } from "./commerce";

test("discountPercent is a whole percent of the compare-at price", () => {
  assert.equal(discountPercent(750, 1000), 25);
  assert.equal(discountPercent(999, 1500), 33);
  assert.equal(discountPercent(0, 1000), 100);
});

test("discountPercent is 0 when there is no real discount", () => {
  assert.equal(discountPercent(1000, null), 0);
  assert.equal(discountPercent(1000, undefined), 0);
  assert.equal(discountPercent(1000, 1000), 0);
  assert.equal(discountPercent(1000, 900), 0);
  assert.equal(discountPercent(Number.NaN, 1000), 0);
  assert.equal(discountPercent(-5, 1000), 0);
  assert.equal(discountPercent(100, Number.POSITIVE_INFINITY), 0);
});

test("a variant's availability comes from its count and threshold", () => {
  assert.equal(variantAvailability({ trackQuantity: true, stockQuantity: 0 }), "out_of_stock");
  assert.equal(variantAvailability({ trackQuantity: true, stockQuantity: 3, lowStockThreshold: 3 }), "low_stock");
  assert.equal(variantAvailability({ trackQuantity: true, stockQuantity: 4, lowStockThreshold: 3 }), "in_stock");
  assert.equal(variantAvailability({ trackQuantity: true, stockQuantity: 4, lowStockThreshold: null }), "in_stock");
  assert.equal(variantAvailability({ trackQuantity: false, stockQuantity: 0, lowStockThreshold: 5 }), "in_stock");
});

test("the best variant decides the product, and out of stock needs every variant out", () => {
  assert.equal(productAvailability(["out_of_stock", "low_stock", "in_stock"]), "in_stock");
  assert.equal(productAvailability(["out_of_stock", "low_stock"]), "low_stock");
  assert.equal(productAvailability(["out_of_stock", "out_of_stock"]), "out_of_stock");
  assert.equal(productAvailability([]), "out_of_stock");
});
