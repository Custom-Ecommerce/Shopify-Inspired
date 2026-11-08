import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Order,
  StockMovement,
  ORDER_CANCEL_REASON_MAX,
  ORDER_COURIER_MAX,
  ORDER_NOTE_MAX,
  ORDER_HISTORY_KINDS,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUS_NOTE_MAX,
  ORDER_STATUSES,
  ORDER_TRACKING_NUMBER_MAX,
  ORDER_TRACKING_URL_MAX,
} from '../src';

// Validates documents in memory. No database connection is needed.

const STORE = '65a000000000000000000011';

function order(overrides: Record<string, unknown> = {}) {
  return new Order({
    store: STORE,
    orderId: 'ORD-ABCD2345',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2 }],
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

// EP-02 OB-1a: the order fields the fulfilment flow needs.

const USER = '65a000000000000000000099';

test('EP-02 status values: the six flow statuses exist and the old returned value still validates', () => {
  for (const status of ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled']) {
    assert.ok((ORDER_STATUSES as readonly string[]).includes(status), status);
    assert.equal(order({ status }).validateSync(), undefined, status);
  }
  assert.equal(order({ status: 'returned' }).validateSync(), undefined);
  assert.notEqual(order({ status: 'shipped' }).validateSync(), undefined);
});

test('a new order without any EP-02 field gets the defaults', () => {
  const doc = order();
  assert.equal(doc.validateSync(), undefined);
  assert.deepEqual(doc.toObject().statusHistory, []);
  assert.deepEqual(doc.toObject().notes, []);
  assert.equal(doc.paymentStatus, 'unpaid');
  assert.equal(doc.courier, null);
  assert.equal(doc.trackingNumber, null);
  assert.equal(doc.trackingUrl, null);
  assert.equal(doc.collectedAt, null);
  assert.equal(doc.collectedAmount, null);
  assert.equal(doc.cancelledAt, null);
  assert.equal(doc.cancelReason, null);
});

test('an order loaded from the database without the EP-02 fields gets the defaults and validates', () => {
  // hydrate() is what a find() does with a stored document; this one predates EP-02.
  const stored = Order.hydrate({
    _id: '65a000000000000000000077',
    store: STORE,
    orderId: 'ORD-OLD23456',
    status: 'confirmed',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 1 }],
    subtotal: 1200,
    deliveryCharges: 0,
    total: 1200,
  });
  assert.equal(stored.validateSync(), undefined);
  assert.equal(stored.status, 'confirmed');
  assert.equal(stored.paymentStatus, 'unpaid');
  assert.deepEqual(stored.toObject().statusHistory, []);
  assert.deepEqual(stored.toObject().notes, []);
});

test('paymentStatus accepts unpaid and collected only', () => {
  assert.deepEqual([...ORDER_PAYMENT_STATUSES], ['unpaid', 'collected']);
  const collected = order({ paymentStatus: 'collected', collectedAt: new Date(), collectedAmount: 2400 });
  assert.equal(collected.validateSync(), undefined);
  assert.notEqual(order({ paymentStatus: 'paid' }).validateSync(), undefined);
  assert.notEqual(order({ paymentStatus: 'refunded' }).validateSync(), undefined);
  assert.notEqual(order({ collectedAmount: -1 }).validateSync(), undefined);
});

test('a status history entry has from, to, by, at and an optional note', () => {
  const at = new Date('2026-11-07T10:00:00.000Z');
  const doc = order({
    status: 'confirmed',
    statusHistory: [
      { from: 'pending', to: 'confirmed', by: USER, at },
      { from: 'confirmed', to: 'confirmed', by: USER, at, note: '  called the customer  ' },
    ],
  });
  assert.equal(doc.validateSync(), undefined);
  const [first, second] = doc.toObject().statusHistory;
  assert.deepEqual(Object.keys(first).sort(), ['at', 'by', 'from', 'note', 'to']);
  assert.equal(first.from, 'pending');
  assert.equal(first.to, 'confirmed');
  assert.equal(String(first.by), USER);
  assert.equal(first.at.toISOString(), at.toISOString());
  assert.equal(first.note, null);
  assert.equal(second.note, 'called the customer');
  // History entries carry no _id of their own.
  assert.equal('_id' in first, false);
});

test('a status history entry needs from, to and by, and only known statuses', () => {
  const bad = (entry: Record<string, unknown>) => order({ statusHistory: [entry] }).validateSync();
  assert.notEqual(bad({ to: 'confirmed', by: USER }), undefined);
  assert.notEqual(bad({ from: 'pending', by: USER }), undefined);
  assert.notEqual(bad({ from: 'pending', to: 'confirmed' }), undefined);
  assert.notEqual(bad({ from: 'pending', to: 'shipped', by: USER }), undefined);
  assert.notEqual(bad({ from: 'pending', to: 'confirmed', by: 'not-an-id' }), undefined);
  assert.notEqual(bad({ from: 'pending', to: 'confirmed', by: USER, note: 'x'.repeat(ORDER_STATUS_NOTE_MAX + 1) }), undefined);
  const stamped = order({ statusHistory: [{ from: 'pending', to: 'confirmed', by: USER }] });
  assert.equal(stamped.validateSync(), undefined);
  assert.ok(stamped.statusHistory[0]?.at instanceof Date, 'at defaults to now');
});

test('an internal note has text, by and at; empty or oversized text is rejected', () => {
  const doc = order({ notes: [{ text: ' Customer asked for evening delivery ', by: USER }] });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.notes[0]?.text, 'Customer asked for evening delivery');
  assert.ok(doc.notes[0]?.at instanceof Date);
  assert.notEqual(order({ notes: [{ text: '   ', by: USER }] }).validateSync(), undefined);
  assert.notEqual(order({ notes: [{ text: 'ok' }] }).validateSync(), undefined);
  assert.notEqual(order({ notes: [{ text: 'x'.repeat(ORDER_NOTE_MAX + 1), by: USER }] }).validateSync(), undefined);
});

test('courier, tracking and cancel fields are stored trimmed and bounded', () => {
  const doc = order({
    status: 'cancelled',
    courier: ' TCS ',
    trackingNumber: ' 1234567890 ',
    trackingUrl: 'https://example.test/track/1234567890',
    cancelledAt: new Date(),
    cancelReason: ' Customer changed their mind ',
  });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.courier, 'TCS');
  assert.equal(doc.trackingNumber, '1234567890');
  assert.equal(doc.cancelReason, 'Customer changed their mind');
  assert.notEqual(order({ courier: 'x'.repeat(ORDER_COURIER_MAX + 1) }).validateSync(), undefined);
  assert.notEqual(order({ trackingNumber: 'x'.repeat(ORDER_TRACKING_NUMBER_MAX + 1) }).validateSync(), undefined);
  assert.notEqual(order({ trackingUrl: 'x'.repeat(ORDER_TRACKING_URL_MAX + 1) }).validateSync(), undefined);
  assert.notEqual(order({ cancelReason: 'x'.repeat(ORDER_CANCEL_REASON_MAX + 1) }).validateSync(), undefined);
});

test('the seller order list indexes exist, none of them unique', () => {
  const indexes = Order.schema.indexes();
  const find = (keys: Record<string, unknown>) =>
    indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys));
  for (const keys of [
    { store: 1, createdAt: -1 },
    { store: 1, status: 1, createdAt: -1 },
    { store: 1, phone: 1 },
    { store: 1, customerName: 1 },
  ]) {
    const index = find(keys);
    assert.ok(index, JSON.stringify(keys));
    assert.notEqual(index[1]?.unique, true, JSON.stringify(keys));
  }
  // The order number index is unchanged: unique within a store.
  assert.equal(find({ store: 1, orderId: 1 })?.[1]?.unique, true);
});

// EP-02 OB-3 (D-066): what placement deducted, and the exactly-once restore marker.

test('an order line may say whether stock was deducted; a missing flag stays missing (an old order)', () => {
  const withFlags = order({
    items: [
      { productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2, stockDeducted: true },
      { productId: 'p2', variantId: 'v2', productTitle: 'Cap', variantTitle: 'Default', unitPrice: 300, quantity: 1, stockDeducted: false },
    ],
  });
  assert.equal(withFlags.validateSync(), undefined);
  assert.equal(withFlags.items[0]?.stockDeducted, true);
  assert.equal(withFlags.items[1]?.stockDeducted, false);
  const old = order();
  assert.equal(old.validateSync(), undefined);
  assert.equal('stockDeducted' in old.toObject().items[0], false);
});

test('stockRestoredAt has no default, so a new or loaded order does not carry it until a cancel sets it', () => {
  assert.equal(order().stockRestoredAt, undefined);
  assert.equal('stockRestoredAt' in order().toObject(), false);
  const at = new Date();
  assert.equal(order({ status: 'cancelled', stockRestoredAt: at }).stockRestoredAt?.getTime(), at.getTime());
});

test('a stock movement may name its order; manual movements do not, and the order index is sparse', () => {
  const base = {
    store: STORE,
    product: '65a0000000000000000000b1',
    variantId: '65a0000000000000000000e1',
    previousQuantity: 3,
    quantity: 5,
    delta: 2,
    reason: 'order_cancelled',
  };
  const withOrder = new StockMovement({ ...base, orderId: '65a000000000000000000077' });
  assert.equal(withOrder.validateSync(), undefined);
  assert.equal(String(withOrder.orderId), '65a000000000000000000077');
  const manual = new StockMovement({ ...base, reason: 'Stock count' });
  assert.equal(manual.validateSync(), undefined);
  assert.equal('orderId' in manual.toObject(), false);
  const index = StockMovement.schema.indexes().find(([fields]) => 'orderId' in fields);
  assert.ok(index);
  assert.deepEqual(index[0], { orderId: 1 });
  assert.equal(index[1]?.sparse, true);
  assert.notEqual(index[1]?.unique, true);
});

// EP-02 OB-5a: what a history entry records.

test('a history entry may carry a kind; it has no default and only known kinds validate', () => {
  assert.deepEqual([...ORDER_HISTORY_KINDS], ['status', 'tracking', 'payment', 'stock']);
  const entry = { from: 'dispatched', to: 'dispatched', by: USER };
  const withKind = order({ statusHistory: [{ ...entry, kind: 'payment', note: 'COD collected: Rs. 10' }] });
  assert.equal(withKind.validateSync(), undefined);
  assert.equal(withKind.statusHistory[0]?.kind, 'payment');
  const without = order({ statusHistory: [entry] });
  assert.equal(without.validateSync(), undefined);
  assert.equal('kind' in without.toObject().statusHistory[0], false);
  assert.notEqual(order({ statusHistory: [{ ...entry, kind: 'bogus' }] }).validateSync(), undefined);
});
