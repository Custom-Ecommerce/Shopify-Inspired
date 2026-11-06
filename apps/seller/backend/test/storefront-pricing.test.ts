import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, roundMoney } from '../src/lib/storefront/pricing';
import { statusAfterRelease, statusAfterReserve } from '../src/lib/storefront/stock';
import { generateOrderId, normalizeOrderId } from '../src/lib/storefront/order-id';

const store = { deliveryRate: 250, freeDeliveryThreshold: 5000 };

test('subtotal is price times quantity, summed', () => {
  const t = computeTotals([{ unitPrice: 1200, qty: 2, deliveryCharge: null }, { unitPrice: 500, qty: 1, deliveryCharge: null }], store);
  assert.equal(t.subtotal, 2900);
});

test('a product with no charge of its own pays the store default rate', () => {
  const t = computeTotals([{ unitPrice: 1000, qty: 1, deliveryCharge: null }], store);
  assert.deepEqual(t, { subtotal: 1000, deliveryCharges: 250, total: 1250 });
});

test('a product charge overrides the store rate, including a free-delivery product at 0', () => {
  assert.equal(computeTotals([{ unitPrice: 1000, qty: 1, deliveryCharge: 100 }], store).deliveryCharges, 100);
  assert.equal(computeTotals([{ unitPrice: 1000, qty: 1, deliveryCharge: 0 }], store).deliveryCharges, 0);
});

test('one parcel pays the highest line charge once, not the sum', () => {
  const t = computeTotals(
    [{ unitPrice: 100, qty: 3, deliveryCharge: 150 }, { unitPrice: 100, qty: 1, deliveryCharge: 300 }, { unitPrice: 100, qty: 1, deliveryCharge: null }],
    store,
  );
  assert.equal(t.deliveryCharges, 300);
});

test('delivery is free at or above the threshold, charged just below it', () => {
  assert.equal(computeTotals([{ unitPrice: 5000, qty: 1, deliveryCharge: null }], store).deliveryCharges, 0);
  assert.equal(computeTotals([{ unitPrice: 4999, qty: 1, deliveryCharge: null }], store).deliveryCharges, 250);
});

test('a null or zero threshold means the store has no free-delivery offer', () => {
  assert.equal(computeTotals([{ unitPrice: 99999, qty: 1, deliveryCharge: null }], { deliveryRate: 250, freeDeliveryThreshold: null }).deliveryCharges, 250);
  assert.equal(computeTotals([{ unitPrice: 99999, qty: 1, deliveryCharge: null }], { deliveryRate: 250, freeDeliveryThreshold: 0 }).deliveryCharges, 250);
});

test('float noise is rounded away', () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(computeTotals([{ unitPrice: 0.1, qty: 3, deliveryCharge: 0 }], store).total, 0.3);
});

test('stock status moves down on reserve and up on release, never against a manual choice', () => {
  assert.equal(statusAfterReserve({ stockQuantity: 0, stockStatus: 'in_stock' }), 'out_of_stock');
  assert.equal(statusAfterReserve({ stockQuantity: 3, stockStatus: 'in_stock', lowStockThreshold: 5 }), 'low_stock');
  assert.equal(statusAfterReserve({ stockQuantity: 30, stockStatus: 'in_stock', lowStockThreshold: 5 }), null);
  assert.equal(statusAfterReserve({ stockQuantity: 3, stockStatus: 'in_stock' }), null);

  assert.equal(statusAfterRelease({ stockQuantity: 1, stockStatus: 'out_of_stock' }), 'in_stock');
  assert.equal(statusAfterRelease({ stockQuantity: 1, stockStatus: 'out_of_stock', lowStockThreshold: 5 }), 'low_stock');
  assert.equal(statusAfterRelease({ stockQuantity: 30, stockStatus: 'low_stock', lowStockThreshold: 5 }), 'in_stock');
  assert.equal(statusAfterRelease({ stockQuantity: 0, stockStatus: 'out_of_stock' }), null);
});

test('order ids are prefixed, unambiguous, and normalised from hand-typed input', () => {
  for (let i = 0; i < 200; i += 1) assert.match(generateOrderId(), /^ORD-[A-HJKMNP-Z2-9]{8}$/);
  assert.equal(normalizeOrderId(' ord-7kq4m2xa '), 'ORD-7KQ4M2XA');
  assert.equal(normalizeOrderId('7kq4 m2xa'), 'ORD-7KQ4M2XA');
});
