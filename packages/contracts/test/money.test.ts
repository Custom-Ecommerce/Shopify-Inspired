import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_MAX_PKR, compareAtPriceProblem, rupeesInputSchema, toWholeRupees, wholeRupeesSchema } from '../src/money';

test('a price rounds to the nearest rupee', () => {
  assert.equal(toWholeRupees(0.4), 0);
  assert.equal(toWholeRupees(0.5), 1);
  assert.equal(toWholeRupees(1499.5), 1500);
  assert.equal(toWholeRupees(1499.49), 1499);
  assert.equal(toWholeRupees(0), 0);
  assert.equal(toWholeRupees(2500), 2500);
});

test('anything that cannot be a price is refused, not rounded', () => {
  for (const value of [-1, -0.4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, PRICE_MAX_PKR + 1, '100', null, undefined]) {
    assert.equal(toWholeRupees(value), null, String(value));
  }
  assert.equal(toWholeRupees(PRICE_MAX_PKR), PRICE_MAX_PKR);
});

test('the request schema rounds what a seller sends and refuses the rest', () => {
  assert.equal(rupeesInputSchema.parse(1499.5), 1500);
  for (const value of [-1, -0.4, Number.NaN, Number.POSITIVE_INFINITY, PRICE_MAX_PKR + 1, '100']) {
    assert.equal(rupeesInputSchema.safeParse(value).success, false, String(value));
  }
});

test('a stored or returned price is never a decimal', () => {
  assert.equal(wholeRupeesSchema.safeParse(1500).success, true);
  assert.equal(wholeRupeesSchema.safeParse(1499.5).success, false);
  assert.equal(wholeRupeesSchema.safeParse(-1).success, false);
});

test('compare-at must be strictly above the price, and may be absent', () => {
  assert.equal(compareAtPriceProblem(1000, null), null);
  assert.equal(compareAtPriceProblem(1000, undefined), null);
  assert.equal(compareAtPriceProblem(1000, 1001), null);
  assert.notEqual(compareAtPriceProblem(1000, 1000), null);
  assert.notEqual(compareAtPriceProblem(1000, 999), null);
});
