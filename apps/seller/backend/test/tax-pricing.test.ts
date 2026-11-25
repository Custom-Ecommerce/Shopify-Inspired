import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commissionBase } from '../src/lib/commission';
import { computeTotals, priceCart, type DiscountRule, type PricingLine, type PricingStore } from '../src/lib/storefront/pricing';

// Sprint 8 (S8-B1, D-118): the tax of an order. OFF by default; ONE rate; exclusive adds it, inclusive extracts it; it applies to (subtotal - discount) and
// never to delivery; ONE rounding (half up) on the whole tax amount; the commission base never includes it (D-089).

type Rule = NonNullable<PricingStore['tax']>;
const tax = (ratePercent: number, mode: Rule['mode'] = 'exclusive', label = 'Tax'): Rule => ({ enabled: true, ratePercent, mode, label });
const store = (rule?: Rule, extra: Partial<PricingStore> = {}): PricingStore => ({
  deliveryRate: 250,
  freeDeliveryThreshold: 5000,
  ...(rule ? { tax: rule } : {}),
  ...extra,
});
const line = (unitPrice: number, qty = 1, productId = '65a0000000000000000000a1'): PricingLine => ({ productId, unitPrice, qty, deliveryCharge: null });
const A2 = '65a0000000000000000000a2';
const A3 = '65a0000000000000000000a3';
const NOW = new Date('2026-11-09T12:00:00Z');
const EID10: DiscountRule = { _id: 'd1', code: 'EID10', type: 'percentage', value: 10, usedCount: 0, isActive: true, applicableProducts: [] };

test('tax is OFF by default: no tax amount, no mode, the total is items plus delivery', () => {
  const totals = computeTotals([line(1000)], store());
  assert.deepEqual(totals, { subtotal: 1000, deliveryCharges: 250, discount: 0, taxAmount: 0, total: 1250 });
  const off = computeTotals([line(1000)], store({ enabled: false, ratePercent: 17, mode: 'exclusive', label: 'Tax' }));
  assert.deepEqual(off, totals, 'a stored rate does nothing while tax is off');
});

test('exclusive: the tax is added on top, total = subtotal - discount + tax + delivery', () => {
  const totals = computeTotals([line(1000)], store(tax(17)), 0);
  assert.equal(totals.taxAmount, 170);
  assert.equal(totals.taxMode, 'exclusive');
  assert.equal(totals.taxLabel, 'Tax');
  assert.equal(totals.total, 1000 + 170 + 250);

  const discounted = computeTotals([line(2000)], store(tax(17)), 400);
  assert.equal(discounted.taxAmount, 272, 'tax is on subtotal minus discount: 1600 x 17%');
  assert.equal(discounted.total, 1600 + 272 + 250);
});

test('inclusive: the tax is extracted from the prices and the total does not change', () => {
  const totals = computeTotals([line(1170)], store(tax(17, 'inclusive')), 0);
  assert.equal(totals.taxAmount, 170, '1170 x 17 / 117');
  assert.equal(totals.taxMode, 'inclusive');
  assert.equal(totals.total, 1170 + 250, 'items plus delivery, exactly as with tax off');
  assert.equal(totals.total, computeTotals([line(1170)], store()).total);

  assert.equal(computeTotals([line(1000)], store(tax(17, 'inclusive'))).taxAmount, 145, '1000 x 17 / 117 = 145.29');
  assert.equal(computeTotals([line(1000)], store(tax(17.5, 'inclusive'))).taxAmount, 149, '1000 x 17.5 / 117.5 = 148.94');
});

test('the rate edge cases: 0, 17, 17.5, 0.01, 100', () => {
  assert.equal(computeTotals([line(1000)], store(tax(0))).taxAmount, 0, 'a rate of 0 adds nothing');
  assert.equal(computeTotals([line(1000)], store(tax(0))).total, 1250);
  assert.equal(computeTotals([line(1000)], store(tax(17))).taxAmount, 170);
  assert.equal(computeTotals([line(1000)], store(tax(17.5))).taxAmount, 175);
  assert.equal(computeTotals([line(999)], store(tax(17.5))).taxAmount, 175, '174.825 rounds up');
  assert.equal(computeTotals([line(1000)], store(tax(0.01))).taxAmount, 0, '0.1 rounds down');
  assert.equal(computeTotals([line(5000)], store(tax(0.01))).taxAmount, 1, '0.5 rounds half up');
  assert.equal(computeTotals([line(1000)], store(tax(100))).taxAmount, 1000);
  assert.equal(computeTotals([line(1000)], store(tax(100, 'inclusive'))).taxAmount, 500, 'half of a 100% inclusive price is tax');
});

test('rounding is half up, applied ONCE to the whole tax amount, never per line', () => {
  // 1% of 50 = 0.5 -> 1, of 150 = 1.5 -> 2, of 250 = 2.5 -> 3 (half up, not banker rounding).
  assert.equal(computeTotals([line(50)], store(tax(1))).taxAmount, 1);
  assert.equal(computeTotals([line(150)], store(tax(1))).taxAmount, 2);
  assert.equal(computeTotals([line(250)], store(tax(1))).taxAmount, 3);
  // Two lines of Rs. 50: per line each would round 0.5 up to 1 (= 2); on the whole 100 x 1% = 1.
  assert.equal(computeTotals([line(50), line(50, 1, A2)], store(tax(1))).taxAmount, 1);
  // Three lines of Rs. 33 at 17%: per line 5.61 -> 6 each (18); on the whole 99 x 17% = 16.83 -> 17.
  assert.equal(computeTotals([line(33), line(33, 1, A2), line(33, 1, A3)], store(tax(17))).taxAmount, 17);
  assert.equal(computeTotals([line(5)], store(tax(100, 'inclusive'))).taxAmount, 3, '2.5 rounds half up');
});

test('Rs. 1 items: a tax that rounds to nothing is 0, and a few of them add up before rounding', () => {
  assert.equal(computeTotals([line(1)], store(tax(17))).taxAmount, 0, '0.17');
  assert.equal(computeTotals([line(1, 3)], store(tax(17))).taxAmount, 1, '0.51');
  assert.equal(computeTotals([line(1, 3)], store(tax(17))).total, 3 + 1 + 250);
  assert.equal(computeTotals([line(1)], store(tax(100))).taxAmount, 1);
});

test('a discount equal to the subtotal leaves nothing to tax; the total is delivery only', () => {
  const exclusive = computeTotals([line(1000)], store(tax(17)), 1000);
  assert.equal(exclusive.taxAmount, 0);
  assert.equal(exclusive.total, 250);
  const inclusive = computeTotals([line(1000)], store(tax(17, 'inclusive')), 1000);
  assert.equal(inclusive.taxAmount, 0);
  assert.equal(inclusive.total, 250);
  // A discount larger than the subtotal never makes a negative tax.
  assert.equal(computeTotals([line(1000)], store(tax(17)), 5000).taxAmount, 0);
});

test('large amounts keep exact whole rupees', () => {
  const big = computeTotals([line(100_000_000, 10)], store(tax(17), { freeDeliveryThreshold: null }));
  assert.equal(big.subtotal, 1_000_000_000);
  assert.equal(big.taxAmount, 170_000_000);
  assert.equal(big.total, 1_000_000_000 + 170_000_000 + 250);
  const inclusive = computeTotals([line(100_000_000, 10)], store(tax(17, 'inclusive'), { freeDeliveryThreshold: null }));
  assert.equal(inclusive.taxAmount, 145_299_145, '1e9 x 17 / 117 = 145299145.299');
  assert.equal(inclusive.total, 1_000_000_000 + 250);
  assert.equal(Number.isInteger(computeTotals([line(99_999_999, 7)], store(tax(17.55))).taxAmount), true);
});

test('delivery is never taxed: the tax is the same with delivery charged, free, or per product', () => {
  const charged = computeTotals([line(1000)], store(tax(10)));
  assert.equal(charged.deliveryCharges, 250);
  assert.equal(charged.taxAmount, 100, '10% of 1000, not of 1250');
  const free = computeTotals([line(6000)], store(tax(10)));
  assert.equal(free.deliveryCharges, 0);
  assert.equal(free.taxAmount, 600);
  assert.equal(free.total, 6600);
  const own = computeTotals([{ ...line(1000), deliveryCharge: 400 }], store(tax(10)));
  assert.equal(own.deliveryCharges, 400);
  assert.equal(own.taxAmount, 100);
  assert.equal(own.total, 1000 + 100 + 400);
  const inclusive = computeTotals([line(1000)], store(tax(10, 'inclusive')));
  assert.equal(inclusive.taxAmount, 91, '1000 x 10 / 110 = 90.9');
  assert.equal(inclusive.total, 1250, 'delivery is added to the (tax inclusive) items, not taxed');
});

test('the free-delivery threshold is judged on the items after discount, as before, tax or not', () => {
  assert.equal(computeTotals([line(5000)], store(tax(17))).deliveryCharges, 0);
  assert.equal(computeTotals([line(5000)], store(tax(17)), 100).deliveryCharges, 250);
  assert.equal(computeTotals([line(5000)], store(tax(17, 'inclusive'))).deliveryCharges, 0, 'inclusive tax does not move the threshold either');
});

test('the commission base is subtotal minus discount and is the same with tax off, exclusive or inclusive (D-089)', () => {
  const results = [undefined, tax(17), tax(17, 'inclusive')].map((rule) => {
    const priced = priceCart([line(2000)], store(rule), { code: 'EID10', rule: EID10 }, NOW);
    const order = { _id: 'o', store: 's', subtotal: priced.totals.subtotal, discountAmount: priced.totals.discount, total: priced.totals.total };
    return { base: commissionBase(order), total: priced.totals.total, tax: priced.totals.taxAmount };
  });
  assert.deepEqual(results.map((entry) => entry.base), [1800, 1800, 1800]);
  assert.deepEqual(results.map((entry) => entry.total), [2050, 2050 + 306, 2050], 'only the exclusive total carries the tax');
  assert.deepEqual(results.map((entry) => entry.tax), [0, 306, 262], '1800 x 17% = 306; 1800 x 17 / 117 = 261.5');
});

test('priceCart (the quote and the order share it) carries the tax with and without a code', () => {
  const without = priceCart([line(1000, 2)], store(tax(17, 'exclusive', 'GST')), null, NOW);
  assert.equal(without.totals.taxAmount, 340);
  assert.equal(without.totals.taxLabel, 'GST');
  const refused = priceCart([line(1000, 2)], store(tax(17)), { code: 'NOPE', rule: null }, NOW);
  assert.equal(refused.refusal?.reason, 'unknown');
  assert.equal(refused.totals.taxAmount, 340, 'a refused code still quotes the tax');
  const withCode = priceCart([line(1000, 2)], store(tax(17)), { code: 'EID10', rule: EID10 }, NOW);
  assert.equal(withCode.totals.discount, 200);
  assert.equal(withCode.totals.taxAmount, 306);
});

test('a rule that is not a rate never taxes, even if one reaches the pricing function', () => {
  assert.equal(computeTotals([line(1000)], store(tax(17.555))).taxAmount, 0);
  assert.equal(computeTotals([line(1000)], store(tax(-5))).taxAmount, 0);
  assert.equal(computeTotals([line(1000)], store(tax(150))).taxAmount, 0);
  assert.equal(computeTotals([line(1000)], store(tax(Number.NaN))).taxAmount, 0);
});
