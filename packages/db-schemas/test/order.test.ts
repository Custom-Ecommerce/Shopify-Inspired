import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Order, ORDER_PAYMENT_METHODS } from '../src';

// Validates documents in memory. No database connection is needed.

const STORE = '65a000000000000000000011';

function order(overrides: Record<string, unknown> = {}) {
  return new Order({
    store: STORE,
    orderId: 'ORD-ABCD2345',
    items: [{ productId: 'p1', productTitle: 'Shirt', unitPrice: 1200, quantity: 2 }],
    ...overrides,
  });
}

test('an order written before Part 7 (no customer, no key) still validates', () => {
  const doc = order();
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.idempotencyKey, undefined);
  assert.equal(doc.paymentMethod, undefined);
});

test('a storefront order carries the customer, payment method, and idempotency key', () => {
  const doc = order({
    idempotencyKey: 'idem-12345678',
    paymentMethod: 'cod',
    customerName: 'Sara Khan',
    phone: '+923001234567',
    address: 'House 12, Street 4, Block 5',
    city: 'Karachi',
    orderGroupId: 'grp-1',
  });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.customerName, 'Sara Khan');
  assert.equal(doc.phone, '+923001234567');
  assert.equal(doc.city, 'Karachi');
});

test('payment method is limited to the contract options', () => {
  assert.deepEqual([...ORDER_PAYMENT_METHODS], ['cod', 'card']);
  assert.notEqual(order({ paymentMethod: 'bitcoin' }).validateSync(), undefined);
});

test('an idempotency key that is too short is rejected', () => {
  assert.notEqual(order({ idempotencyKey: 'abc' }).validateSync(), undefined);
});

test('idempotency is a unique partial index per store', () => {
  const index = Order.schema.indexes().find(([fields]) => 'idempotencyKey' in fields);
  assert.ok(index, 'idempotencyKey index exists');
  assert.deepEqual(index[0], { store: 1, idempotencyKey: 1 });
  assert.equal(index[1]?.unique, true);
  // Partial, so orders created before the key existed do not collide on a missing value.
  assert.deepEqual(index[1]?.partialFilterExpression, { idempotencyKey: { $type: 'string' } });
});

test('an order id is unique within a store', () => {
  const index = Order.schema.indexes().find(([fields]) => 'orderId' in fields);
  assert.ok(index, 'orderId index exists');
  assert.deepEqual(index[0], { store: 1, orderId: 1 });
  assert.equal(index[1]?.unique, true);
});
