
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCommission, resolveEffectiveCommissionRate } from '../src/commission';

test('percentage formula matches Payload: 4 percent of 100000 minor units is 4000', () => {
  assert.equal(computeCommission(100000, 4), 4000);
});

test('rounding matches Payload: Math.round on the minor-unit product', () => {
  assert.equal(computeCommission(1005, 50), 503);
});

test('a fraction such as 0.04 is a valid percentage, so it yields 0 minor units on 100000', () => {
  assert.equal(computeCommission(100000, 0.04), 40);
});

test('rates above 100 percent are rejected', () => {
  assert.throws(() => computeCommission(1000, 101), RangeError);
});

test('negative order amounts are rejected for a new sale (refunds are written separately)', () => {
  assert.throws(() => computeCommission(-500, 4), RangeError);
});

test('inherit stores use the platform default', () => {
  assert.equal(resolveEffectiveCommissionRate({ commissionMode: 'inherit', commissionRate: 2 }, 4), 4);
});

test('custom stores use their own rate, not the platform default', () => {
  assert.equal(resolveEffectiveCommissionRate({ commissionMode: 'custom', commissionRate: 7 }, 4), 7);
});

test('a missing mode behaves as custom', () => {
  assert.equal(resolveEffectiveCommissionRate({ commissionRate: 7 }, 4), 7);
});

test('inherit with no usable platform default falls back to the store rate', () => {
  assert.equal(resolveEffectiveCommissionRate({ commissionMode: 'inherit', commissionRate: 3 }, null), 3);
});

test('no usable rate at all returns null so the caller can refuse to guess', () => {
  assert.equal(resolveEffectiveCommissionRate({ commissionMode: 'custom', commissionRate: null }, 4), null);
});
