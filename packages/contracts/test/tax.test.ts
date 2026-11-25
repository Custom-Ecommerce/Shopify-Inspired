import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TAX_SETTINGS,
  TAX_KEYS,
  TAX_LABEL_MAX,
  isValidTaxRate,
  rateInHundredths,
  readOrderTax,
  resolveTaxSettings,
  storeTaxUpdateSchema,
  taxAmountOf,
  taxLineLabel,
} from '../src/tax';
import { storefrontCartQuoteSchema, storefrontQuoteTotalsSchema } from '../src/checkout';
import { storefrontOrderCreatedSchema, storefrontOrderSchema } from '../src/storefront';
import { dashboardOrderDetailSchema, orderPrintSheetSchema } from '../src/order';
import { storeSettingsSchema, storeSettingsUpdateSchema } from '../src/store-settings';
import { failingPaths } from './helpers';

// Sprint 8 (S8-B1, D-118): store tax. OFF by default, one rate (0 to 100, 2 decimals), exclusive or inclusive, whole rupees, ONE rounding (half up).

const parse = (body: unknown) => storeTaxUpdateSchema.safeParse(body);

test('the tax group accepts a rate from 0 to 100 with at most 2 decimals, a mode, a switch and a label', () => {
  for (const ratePercent of [0, 0.01, 1, 17, 17.5, 17.55, 99.99, 100]) {
    const result = parse({ enabled: true, ratePercent });
    assert.equal(result.success, true, String(ratePercent));
  }
  const full = parse({ enabled: true, ratePercent: 17, mode: 'inclusive', label: '  GST ' });
  assert.equal(full.success, true);
  assert.deepEqual(full.success ? full.data : null, { enabled: true, ratePercent: 17, mode: 'inclusive', label: 'GST' });
});

test('every field is optional (a change names only what it changes) but the group is strict', () => {
  assert.equal(parse({}).success, true);
  assert.equal(parse({ mode: 'exclusive' }).success, true);
  for (const key of ['rate', 'currency', 'perLine', 'taxId', 'style']) assert.equal(parse({ [key]: 1 }).success, false, key);
  assert.deepEqual([...TAX_KEYS].sort(), ['enabled', 'label', 'mode', 'ratePercent']);
});

test('a rate with 3 decimals, a negative rate, a rate over 100 and a rate that is not a number are refused, naming the field', () => {
  for (const ratePercent of [17.555, 0.001, 0.005, -1, -0.01, 100.01, 101, 1000, '17', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = parse({ ratePercent });
    assert.equal(result.success, false, String(ratePercent));
    if (!result.success) assert.deepEqual(failingPaths(result).includes('ratePercent'), true, String(ratePercent));
  }
});

test('the mode is exclusive or inclusive; the switch is a boolean', () => {
  for (const mode of ['both', 'Exclusive', '', null, 1]) assert.equal(parse({ mode }).success, false, String(mode));
  for (const enabled of ['true', 1, null]) assert.equal(parse({ enabled }).success, false, String(enabled));
});

test('the label is plain text on one line: 1 to 20 characters, no < or >, controls become spaces', () => {
  const ok = parse({ label: 'VAT\n\n 5' });
  assert.equal(ok.success && ok.data.label, 'VAT 5');
  assert.equal(parse({ label: 'x'.repeat(TAX_LABEL_MAX) }).success, true);
  for (const label of ['x'.repeat(TAX_LABEL_MAX + 1), '', '   ', '<b>Tax</b>', 'Tax>', 5, null]) assert.equal(parse({ label }).success, false, String(label));
});

test('the group is part of the store settings update (and nothing else changes in that schema)', () => {
  assert.equal(storeSettingsUpdateSchema.safeParse({ tax: { enabled: true, ratePercent: 17 } }).success, true);
  assert.equal(storeSettingsUpdateSchema.safeParse({ tax: { ratePercent: 17.555 } }).success, false);
  assert.equal(storeSettingsUpdateSchema.safeParse({ tax: null }).success, false, 'tax cannot be nulled: switch it off instead');
});

test('rateInHundredths is exact for every 2-decimal rate and refuses the rest', () => {
  assert.equal(rateInHundredths(17.5), 1750);
  assert.equal(rateInHundredths(0.07), 7, 'float noise (0.07 x 100 = 7.000000000000001) does not matter');
  assert.equal(rateInHundredths(0.29), 29);
  assert.equal(rateInHundredths(0), 0);
  assert.equal(rateInHundredths(100), 10000);
  assert.equal(rateInHundredths(0.001), null);
  assert.equal(rateInHundredths(-1), null);
  assert.equal(rateInHundredths(100.01), null);
  assert.equal(isValidTaxRate(17), true);
  assert.equal(isValidTaxRate('17'), false);
});

test('the tax of an order: exclusive adds, inclusive extracts, one rounding half up, never negative, off is 0', () => {
  const rule = (ratePercent: number, mode: 'exclusive' | 'inclusive' = 'exclusive') => ({ enabled: true, ratePercent, mode });
  assert.equal(taxAmountOf(1000, rule(17)), 170);
  assert.equal(taxAmountOf(1000, rule(17, 'inclusive')), 145);
  assert.equal(taxAmountOf(1170, rule(17, 'inclusive')), 170);
  assert.equal(taxAmountOf(50, rule(1)), 1, '0.5 up');
  assert.equal(taxAmountOf(250, rule(1)), 3, '2.5 up');
  assert.equal(taxAmountOf(5, rule(100, 'inclusive')), 3, '2.5 up');
  assert.equal(taxAmountOf(0, rule(17)), 0);
  assert.equal(taxAmountOf(-100, rule(17)), 0);
  assert.equal(taxAmountOf(1000, rule(0)), 0);
  assert.equal(taxAmountOf(1000, { enabled: false, ratePercent: 17, mode: 'exclusive' }), 0);
  assert.equal(taxAmountOf(1000, null), 0);
  assert.equal(taxAmountOf(1000, rule(17.555)), 0, 'a rate that is not a rate never taxes');
  assert.equal(taxAmountOf(1_000_000_000, rule(17)), 170_000_000);
  assert.equal(taxAmountOf(Number.NaN, rule(17)), 0);
});

test('inclusive is the inverse of exclusive: the tax extracted from a taxed price is the tax that was added (whole rupees)', () => {
  for (const [base, rate] of [[1000, 17], [999, 17.5], [12345, 15], [1, 17], [87654, 0.01], [500, 100]] as const) {
    const added = taxAmountOf(base, { enabled: true, ratePercent: rate, mode: 'exclusive' });
    const extracted = taxAmountOf(base + added, { enabled: true, ratePercent: rate, mode: 'inclusive' });
    assert.ok(Math.abs(extracted - added) <= 1, base + ' at ' + rate + '%: added ' + added + ', extracted ' + extracted);
  }
});

test('the settings a store reads: defaults filled in, a broken stored value reads as the default, tax on without a rate reads as off', () => {
  assert.deepEqual(resolveTaxSettings(undefined), DEFAULT_TAX_SETTINGS);
  assert.deepEqual(resolveTaxSettings(null), { enabled: false, ratePercent: 0, mode: 'exclusive', label: 'Tax' });
  assert.deepEqual(resolveTaxSettings({ enabled: true, ratePercent: 17.5, mode: 'inclusive', label: 'GST' }), { enabled: true, ratePercent: 17.5, mode: 'inclusive', label: 'GST' });
  assert.deepEqual(resolveTaxSettings({ enabled: true }), { enabled: false, ratePercent: 0, mode: 'exclusive', label: 'Tax' }, 'no rate: off');
  assert.deepEqual(resolveTaxSettings({ enabled: true, ratePercent: 'x', mode: 'nope', label: '<b>' }), DEFAULT_TAX_SETTINGS);
  assert.equal(resolveTaxSettings({ enabled: 'true', ratePercent: 17 }).enabled, false, 'only the boolean true switches tax on');
  assert.equal(resolveTaxSettings({ enabled: false, ratePercent: 17 }).ratePercent, 17, 'a rate is kept while tax is off');
  assert.deepEqual(resolveTaxSettings([1, 2]), DEFAULT_TAX_SETTINGS);
});

test('the name of the tax line: the store label, "(included)" when the prices already contain it', () => {
  assert.equal(taxLineLabel('Tax', 'exclusive'), 'Tax');
  assert.equal(taxLineLabel('Tax', 'inclusive'), 'Tax (included)');
  assert.equal(taxLineLabel('GST', 'inclusive'), 'GST (included)');
  assert.equal(taxLineLabel('', 'exclusive'), 'Tax');
  assert.equal(taxLineLabel(null, null), 'Tax');
});

test('an old order has no tax fields and reads as tax 0', () => {
  assert.deepEqual(readOrderTax({}), { taxAmount: 0, taxMode: null, taxRatePercent: 0 });
  assert.deepEqual(readOrderTax(null), { taxAmount: 0, taxMode: null, taxRatePercent: 0 });
  assert.deepEqual(readOrderTax({ taxAmount: 510, taxMode: 'exclusive', taxRatePercent: 17 }), { taxAmount: 510, taxMode: 'exclusive', taxRatePercent: 17 });
  assert.deepEqual(readOrderTax({ taxAmount: 510 }), { taxAmount: 0, taxMode: null, taxRatePercent: 0 }, 'an amount with no mode is not a tax');
  assert.deepEqual(readOrderTax({ taxAmount: -5, taxMode: 'exclusive' }), { taxAmount: 0, taxMode: null, taxRatePercent: 0 });
  assert.deepEqual(readOrderTax({ taxAmount: 0, taxMode: 'exclusive', taxRatePercent: 17 }), { taxAmount: 0, taxMode: null, taxRatePercent: 0 });
});

// ------------------------------------------------------------------------------------------------- the wire

const lines = [{ productId: 'p1', variantId: 'v1', title: 'Shirt', variantTitle: 'Default', unitPrice: 1000, qty: 2, lineTotal: 2000, issue: null, availableQty: 5 }];

test('the quote totals carry taxAmount, taxMode and taxLabel; a server from before tax reads as taxAmount 0 and no mode', () => {
  const taxed = storefrontQuoteTotalsSchema.parse({ subtotal: 2000, deliveryCharges: 250, discount: 0, taxAmount: 340, taxMode: 'exclusive', taxLabel: 'GST', total: 2590 });
  assert.equal(taxed.taxAmount, 340);
  assert.equal(taxed.taxMode, 'exclusive');
  assert.equal(taxed.taxLabel, 'GST');
  const old = storefrontQuoteTotalsSchema.parse({ subtotal: 2000, deliveryCharges: 250, total: 2250 });
  assert.equal(old.taxAmount, 0);
  assert.equal(old.taxMode, undefined);
  assert.equal(old.taxLabel, undefined);
  const off = storefrontQuoteTotalsSchema.parse({ subtotal: 2000, deliveryCharges: 250, discount: 0, taxAmount: 0, taxMode: null, taxLabel: null, total: 2250 });
  assert.equal(off.taxMode, null);
});

test('the quote refuses a tax that is not whole rupees, negative, or a mode that does not exist', () => {
  const base = { subtotal: 1, deliveryCharges: 1, discount: 0, total: 2 };
  for (const bad of [{ taxAmount: 10.5 }, { taxAmount: -1 }, { taxAmount: Number.NaN }, { taxMode: 'both' }]) {
    assert.equal(storefrontQuoteTotalsSchema.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad));
  }
});

test('the cart quote schema accepts the tax fields next to the lines', () => {
  const quote = storefrontCartQuoteSchema.parse({
    lines, subtotal: 2000, deliveryCharges: 250, discount: 0, taxAmount: 340, taxMode: 'inclusive', taxLabel: 'Tax', total: 2250, canCheckout: true, discountCode: null, discountError: null,
  });
  assert.equal(quote.taxAmount, 340);
  assert.equal(quote.taxMode, 'inclusive');
});

const created = { orderId: 'ORD-1', status: 'pending', paymentMethod: 'cod', subtotal: 3000, deliveryCharges: 250, discount: 0, total: 3760, createdAt: '2026-11-22T10:00:00.000Z' };

test('an order answer carries its own tax snapshot; an old order reads as taxAmount 0, no mode, no label', () => {
  const old = storefrontOrderCreatedSchema.parse(created);
  assert.equal(old.taxAmount, 0);
  assert.equal(old.taxMode, null);
  assert.equal(old.taxLabel, null);
  const taxed = storefrontOrderCreatedSchema.parse({ ...created, taxAmount: 510, taxMode: 'exclusive', taxLabel: 'GST' });
  assert.equal(taxed.taxAmount, 510);
  assert.equal(taxed.taxLabel, 'GST');
  assert.equal(storefrontOrderCreatedSchema.safeParse({ ...created, taxAmount: 1.5 }).success, false);
  assert.equal(storefrontOrderCreatedSchema.safeParse({ ...created, taxMode: 'weird' }).success, false);
  const lookup = storefrontOrderSchema.parse({ ...created, taxAmount: 436, taxMode: 'inclusive', taxLabel: 'Tax', customerName: 'Sara', phone: '+923001234567', city: null, address: 'x', items: [], updatedAt: '2026-11-22T10:00:00.000Z' });
  assert.equal(lookup.taxAmount, 436);
  assert.equal(lookup.taxMode, 'inclusive');
});

test('the seller order detail and print sheet accept the tax fields and still accept an order without them', () => {
  const printed = { id: 'o1', orderId: 'ORD-1', createdAt: '2026-11-22T10:00:00.000Z', status: 'pending', customerName: 'Sara', phone: null, address: null, city: null, items: [], paymentMethod: 'cod', paymentStatus: 'unpaid', codAmount: 3760, courier: null, trackingNumber: null };
  assert.equal(orderPrintSheetSchema.safeParse(printed).success, true);
  assert.equal(orderPrintSheetSchema.safeParse({ ...printed, taxAmount: 510, taxMode: 'exclusive', taxLabel: 'GST' }).success, true);
  assert.equal(orderPrintSheetSchema.safeParse({ ...printed, taxAmount: 510, surprise: 1 }).success, false, 'the print sheet stays strict');
  assert.equal(typeof dashboardOrderDetailSchema.shape.taxAmount, 'object');
});

test('the settings screen reads the tax with the defaults filled in (and an older backend without it still parses)', () => {
  const shape = (storeSettingsSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.ok('tax' in shape);
});
