import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscountSchema, updateDiscountSchema, discountSchema } from '../src/discount';
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

test('an update request may change only isActive, maxUses, and endDate', () => {
  assert.equal(updateDiscountSchema.safeParse({ isActive: false }).success, true);
  assert.equal(updateDiscountSchema.safeParse({ value: 50 }).success, false);
  assert.equal(updateDiscountSchema.safeParse({}).success, false);
});

test('a stored discount with the wire identity parses', () => {
  const doc = { id: OID, store: OID, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, applicableProducts: [], isActive: true, createdAt: NOW, updatedAt: NOW };
  assert.equal(discountSchema.safeParse(doc).success, true);
});
