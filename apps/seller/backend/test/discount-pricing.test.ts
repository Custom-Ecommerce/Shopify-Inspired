import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceCart, type DiscountRule, type PricingLine } from '../src/lib/storefront/pricing';

const store = { deliveryRate: 250, freeDeliveryThreshold: 5000 };
const NOW = new Date('2026-11-09T12:00:00Z');
const A = '65a0000000000000000000a1';
const B = '65a0000000000000000000a2';

const line = (unitPrice: number, qty = 1, productId = A): PricingLine => ({ productId, unitPrice, qty, deliveryCharge: null });
const rule = (fields: Partial<DiscountRule> = {}): DiscountRule => ({ _id: 'd1', code: 'EID10', type: 'percentage', value: 10, usedCount: 0, isActive: true, applicableProducts: [], ...fields });
const price = (lines: PricingLine[], fields: Partial<DiscountRule> | null = {}) =>
  priceCart(lines, store, { code: 'EID10', rule: fields === null ? null : rule(fields) }, NOW);

test('no code leaves the totals alone', () => {
  const { totals, applied, refusal } = priceCart([line(1000)], store, null, NOW);
  assert.deepEqual(totals, { subtotal: 1000, deliveryCharges: 250, discount: 0, total: 1250 });
  assert.equal(applied, null);
  assert.equal(refusal, null);
});

test('percent comes off the subtotal only, never delivery', () => {
  const { totals, applied } = price([line(1000, 2)]);
  assert.deepEqual(totals, { subtotal: 2000, deliveryCharges: 250, discount: 200, total: 2050 });
  assert.equal(applied?.amount, 200);
});

for (const [base, percent, expected] of [
  [999, 10, 100], // 99.9 up
  [994, 10, 99], // 99.4 down
  [1999, 50, 1000], // 999.5, a half goes up
  [1, 50, 1], // 0.5 goes up to the whole rupee
  [333, 33, 110], // 109.89
  [1500, 100, 1500],
] as const) {
  test('percent is whole rupees, nearest: ' + percent + '% of ' + base + ' is ' + expected, () => {
    const { totals } = price([line(base)], { value: percent });
    assert.equal(totals.discount, expected);
    assert.equal(Number.isInteger(totals.total), true);
  });
}

test('fixed takes whole rupees off', () => {
  assert.deepEqual(price([line(2000)], { type: 'fixed_amount', value: 300 }).totals, { subtotal: 2000, deliveryCharges: 250, discount: 300, total: 1950 });
});

test('a discount larger than the subtotal stops at the subtotal; delivery is still paid and the total is never below zero', () => {
  const { totals } = price([line(500)], { type: 'fixed_amount', value: 9000 });
  assert.equal(totals.discount, 500);
  assert.equal(totals.deliveryCharges, 250);
  assert.equal(totals.total, 250);
});

test('100 percent with free delivery is a total of zero, not less', () => {
  const free = priceCart([{ ...line(500), deliveryCharge: 0 }], store, { code: 'X', rule: rule({ value: 100 }) }, NOW);
  assert.equal(free.totals.total, 0);
});

test('free delivery is judged on the subtotal before the discount', () => {
  const justOver = price([line(5000)], { value: 50 });
  assert.equal(justOver.totals.subtotal, 5000);
  assert.equal(justOver.totals.discount, 2500);
  assert.equal(justOver.totals.deliveryCharges, 0, 'the discounted 2500 is below the threshold, and delivery stays free');
  assert.equal(justOver.totals.total, 2500);

  const under = price([line(4999)], { value: 50 });
  assert.equal(under.totals.deliveryCharges, 250);
});

test('the minimum is met exactly at the amount, and refused one rupee short with the amount named', () => {
  assert.equal(price([line(2000)], { minOrderAmount: 2000 }).applied?.amount, 200);
  const short = price([line(1999)], { minOrderAmount: 2000 });
  assert.equal(short.applied, null);
  assert.equal(short.totals.discount, 0);
  assert.deepEqual(short.refusal, { reason: 'minimum_not_met', message: 'Spend at least Rs. 2,000 to use this code.' });
});

test('dates: not before the start, not after the end, and both instants count', () => {
  assert.equal(price([line(1000)], { startDate: new Date(NOW.getTime() + 1) }).refusal?.reason, 'not_started');
  assert.equal(price([line(1000)], { endDate: new Date(NOW.getTime() - 1) }).refusal?.reason, 'expired');
  assert.equal(price([line(1000)], { startDate: NOW, endDate: NOW }).refusal, null);
  assert.equal(price([line(1000)], { startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-30T00:00:00.000Z' }).refusal, null);
});

test('a code limited to products counts only the matching lines', () => {
  const { totals } = price([line(1000, 1, A), line(4000, 1, B)], { applicableProducts: [A], value: 10 });
  assert.equal(totals.subtotal, 5000);
  assert.equal(totals.discount, 100);
});

test('product matching does not depend on case, and handles an ObjectId-like value', () => {
  const asObject = { toString: () => A.toUpperCase() };
  assert.equal(price([line(1000, 1, A)], { applicableProducts: [asObject] }).totals.discount, 100);
});

test('a fixed code limited to products stops at those lines', () => {
  assert.equal(price([line(100, 1, A), line(4000, 1, B)], { type: 'fixed_amount', value: 500, applicableProducts: [A] }).totals.discount, 100);
});

test('a code limited to products not in the cart is refused, and spends nothing', () => {
  const none = price([line(1000, 1, B)], { applicableProducts: [A] });
  assert.equal(none.applied, null);
  assert.equal(none.refusal?.reason, 'not_applicable');
});

test('a percent too small to reach a rupee is refused rather than spent', () => {
  assert.equal(price([line(10)], { value: 1 }).refusal?.reason, 'not_applicable');
});

test('each refusal has its own plain message, and the cart is priced without the code', () => {
  const cases: Array<[Partial<DiscountRule>, string, string]> = [
    [{ isActive: false }, 'inactive', 'This code is not active right now.'],
    [{ startDate: '2027-01-01T00:00:00.000Z' }, 'not_started', 'This code is not active yet.'],
    [{ endDate: '2026-01-01T00:00:00.000Z' }, 'expired', 'This code has expired.'],
    [{ maxUses: 5, usedCount: 5 }, 'used_up', 'This code has been fully used.'],
  ];
  for (const [fields, reason, message] of cases) {
    const result = price([line(1000)], fields);
    assert.deepEqual(result.refusal, { reason, message });
    assert.equal(result.totals.discount, 0);
    assert.equal(result.totals.total, 1250);
  }
});

test('unknown, archived and retired types all give the one same message', () => {
  const expected = { reason: 'unknown', message: 'This code is not valid.' };
  assert.deepEqual(price([line(1000)], null).refusal, expected);
  assert.deepEqual(price([line(1000)], { archivedAt: new Date() }).refusal, expected);
  assert.deepEqual(price([line(1000)], { type: 'free_delivery' }).refusal, expected);
  assert.deepEqual(price([line(1000)], { type: 'buy_x_get_y' }).refusal, expected);
});

test('an archived code says nothing else about itself, even when it is also expired', () => {
  assert.equal(price([line(1000)], { archivedAt: new Date(), endDate: '2020-01-01T00:00:00.000Z', isActive: false }).refusal?.reason, 'unknown');
});

test('maxUses empty means no limit, and 0 means none left', () => {
  assert.equal(price([line(1000)], { maxUses: null, usedCount: 9999 }).refusal, null);
  assert.equal(price([line(1000)], { maxUses: 0 }).refusal?.reason, 'used_up');
  assert.equal(price([line(1000)], { maxUses: 2, usedCount: 1 }).refusal, null);
});

test('an old percent outside 1 to 100 cannot be used', () => {
  assert.equal(price([line(1000)], { value: 150 }).refusal?.reason, 'unknown');
  assert.equal(price([line(1000)], { value: 0 }).refusal?.reason, 'unknown');
});

test('the snapshot holds the rule as it stands, and the id', () => {
  const { applied } = price([line(3000)], { _id: { toString: () => 'abc' }, value: 15, minOrderAmount: 1000 });
  assert.deepEqual(applied?.snapshot, { discountId: 'abc', type: 'percentage', value: 15, minOrderAmount: 1000 });
  assert.equal(applied?.amount, 450);
  assert.equal(applied?.code, 'EID10');
});
