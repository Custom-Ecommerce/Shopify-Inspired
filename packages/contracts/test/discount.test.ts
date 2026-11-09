import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscountSchema, discountValueProblem, updateDiscountSchema, discountSchema } from '../src/discount';
import { STOREFRONT_DISCOUNT_REFUSALS, discountRefusalMessage, storefrontCartQuoteRequestSchema } from '../src/checkout';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';
const OID = '65a000000000000000000011';

test('a create request with a valid type parses, and the code is kept as written', () => {
  const ok = createDiscountSchema.safeParse({ code: 'EID10', type: 'percentage', value: 10 });
  assert.equal(ok.success, true);
});

test('an unknown discount type is reported against type', () => {
  assert.deepEqual(failingPaths(createDiscountSchema.safeParse({ code: 'X', type: 'bogus', value: 1 })), ['type']);
});

test('a create request cannot set the store (strict)', () => {
  const bad = { code: 'X', type: 'percentage', value: 1, store: OID };
  assert.equal(createDiscountSchema.safeParse(bad).success, false);
});

test('an update request may change the value, minimum, dates, maxUses, isActive and archive, and nothing else', () => {
  for (const change of [{ isActive: false }, { value: 50 }, { minOrderAmount: 1000 }, { minOrderAmount: null }, { maxUses: 5 }, { maxUses: null }, { startDate: NOW }, { endDate: null }, { archived: true }]) {
    assert.equal(updateDiscountSchema.safeParse(change).success, true, JSON.stringify(change));
  }
  for (const change of [{}, { code: 'NEW' }, { type: 'fixed_amount' }, { usedCount: 0 }, { store: OID }, { archivedAt: NOW }]) {
    assert.equal(updateDiscountSchema.safeParse(change).success, false, JSON.stringify(change));
  }
});

test('a new code is percentage or fixed only: the two old types cannot be created', () => {
  for (const type of ['free_delivery', 'buy_x_get_y']) {
    assert.deepEqual(failingPaths(createDiscountSchema.safeParse({ code: 'X', type, value: 1 })), ['type']);
  }
});

test('a percentage is a whole number from 1 to 100', () => {
  for (const value of [1, 50, 100]) assert.equal(createDiscountSchema.safeParse({ code: 'X', type: 'percentage', value }).success, true, String(value));
  for (const value of [0, -1, 101, 10.5]) assert.deepEqual(failingPaths(createDiscountSchema.safeParse({ code: 'X', type: 'percentage', value })), ['value']);
});

test('a fixed amount is whole rupees of at least 1', () => {
  assert.equal(createDiscountSchema.safeParse({ code: 'X', type: 'fixed_amount', value: 500 }).success, true);
  for (const value of [0, 99.5, -5]) assert.deepEqual(failingPaths(createDiscountSchema.safeParse({ code: 'X', type: 'fixed_amount', value })), ['value']);
});

test('a code is trimmed and stored in capitals, and limited to plain characters', () => {
  const parsed = createDiscountSchema.parse({ code: '  eid-10_a ', type: 'percentage', value: 10 });
  assert.equal(parsed.code, 'EID-10_A');
  for (const code of ['', '   ', 'has space', '<script>', 'X'.repeat(41)]) {
    const paths = failingPaths(createDiscountSchema.safeParse({ code, type: 'percentage', value: 10 }));
    assert.ok(paths.length > 0 && paths.every((path) => path === 'code'), code);
  }
});

test('the minimum order is whole rupees, and the end must be after the start', () => {
  assert.deepEqual(failingPaths(createDiscountSchema.safeParse({ code: 'X', type: 'percentage', value: 1, minOrderAmount: 10.5 })), ['minOrderAmount']);
  const later = '2026-10-02T00:00:00.000Z';
  assert.equal(createDiscountSchema.safeParse({ code: 'X', type: 'percentage', value: 1, startDate: NOW, endDate: later }).success, true);
  assert.deepEqual(failingPaths(createDiscountSchema.safeParse({ code: 'X', type: 'percentage', value: 1, startDate: later, endDate: NOW })), ['endDate']);
});

test('an old type still reads, and an archived code carries its date', () => {
  const doc = { id: OID, store: OID, code: 'OLD', type: 'free_delivery', value: 0, usedCount: 0, applicableProducts: [], isActive: true, archivedAt: NOW, createdAt: NOW, updatedAt: NOW };
  assert.equal(discountSchema.safeParse(doc).success, true);
});

test('value checks depend on the type, and an old type cannot be given a new value', () => {
  assert.equal(discountValueProblem('percentage', 100), null);
  assert.notEqual(discountValueProblem('percentage', 101), null);
  assert.equal(discountValueProblem('fixed_amount', 101), null);
  assert.notEqual(discountValueProblem('free_delivery', 1), null);
});

test('every refusal has plain words; unknown is the one message archived codes share', () => {
  for (const reason of STOREFRONT_DISCOUNT_REFUSALS) assert.ok(discountRefusalMessage(reason).length > 0, reason);
  assert.equal(discountRefusalMessage('unknown'), 'This code is not valid.');
  assert.equal(discountRefusalMessage('minimum_not_met', 2500), 'Spend at least Rs. 2,500 to use this code.');
});

test('a code on a quote or an order is optional, in capitals, and limited in length', () => {
  const lines = [{ productId: 'p1', qty: 1 }];
  assert.equal(storefrontCartQuoteRequestSchema.parse({ lines, discountCode: ' eid10 ' }).discountCode, 'EID10');
  assert.equal('discountCode' in storefrontCartQuoteRequestSchema.parse({ lines }), false);
  assert.equal(storefrontCartQuoteRequestSchema.parse({ lines, discountCode: null }).discountCode, null);
  assert.deepEqual(failingPaths(storefrontCartQuoteRequestSchema.safeParse({ lines, discountCode: 'X'.repeat(41) })), ['discountCode']);
  assert.deepEqual(failingPaths(storefrontCartQuoteRequestSchema.safeParse({ lines, discountCode: { $ne: '' } })), ['discountCode']);
});

test('a stored discount with the wire identity parses', () => {
  const doc = { id: OID, store: OID, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, applicableProducts: [], isActive: true, createdAt: NOW, updatedAt: NOW };
  assert.equal(discountSchema.safeParse(doc).success, true);
});
