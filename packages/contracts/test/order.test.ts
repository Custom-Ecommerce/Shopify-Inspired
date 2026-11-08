
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSchema } from '../src/order';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: '65a000000000000000000005',
    orderGroupId: 'grp-1',
    store: '65a000000000000000000001',
    orderId: 'ORD-1',
    idempotencyKey: 'idem-1',
    status: 'pending',
    paymentMethod: 'cod',
    customerName: 'Sara',
    phone: '03001234567',
    city: 'Karachi',
    address: 'Block 5',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2 }],
    subtotal: 2400,
    deliveryCharges: 200,
    total: 2600,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('an order parses', () => {
  assert.equal(orderSchema.safeParse(order()).success, true);
});

test('a missing total is reported against total', () => {
  const { total: _omit, ...rest } = order();
  assert.deepEqual(failingPaths(orderSchema.safeParse(rest)), ['total']);
});

test('a zero quantity is reported against the line quantity', () => {
  const bad = order({ items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 0 }] });
  assert.deepEqual(failingPaths(orderSchema.safeParse(bad)), ['items.0.quantity']);
});

test('the wire identity is id, not _id', () => {
  assert.deepEqual(failingPaths(orderSchema.safeParse(order({ id: 'nope' }))), ['id']);
});
