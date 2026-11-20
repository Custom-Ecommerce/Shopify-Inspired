import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Return, SellerAlert } from '../src';

// Sprint 5 EP-13 (D-107, D-108): the extended Return model. Validation, defaults and indexes only: no database.

const STORE = '65a000000000000000000011';
const ORDER = '65a0000000000000000a0001';
const USER = '65a000000000000000000001';

const base = { order: ORDER, store: STORE, reason: 'damaged' };

test('a return of the Sprint 4 shell still loads: none of the Sprint 5 fields is required, and none is defaulted', () => {
  const old = new Return(base);
  assert.equal(old.validateSync(), undefined);
  assert.equal(old.status, 'requested');
  const plain = old.toObject();
  for (const field of ['returnNumber', 'orderNumber', 'items', 'contactPhone', 'reasonCode', 'received', 'refunds', 'resolvedAt', 'rejectReason']) {
    assert.equal(field in plain, false, field + ' is absent, not defaulted');
  }
});

test('the Sprint 5 fields are declared (strict mode would drop them otherwise) and kept', () => {
  const doc = new Return({
    ...base,
    returnNumber: 'RET-7KQ4M2XA',
    orderNumber: 'ORD-ABCD2345',
    contactPhone: '+923001234567',
    reasonCode: 'damaged',
    description: 'Arrived broken',
    items: [{ productId: 'P1', variantId: 'V1', productTitle: 'Shirt', variantTitle: 'M', quantity: 2, unitPrice: 1000 }],
  });
  assert.equal(doc.validateSync(), undefined);
  const plain = doc.toObject();
  assert.equal(plain.returnNumber, 'RET-7KQ4M2XA');
  assert.equal(plain.contactPhone, '+923001234567');
  assert.equal(plain.items?.[0]?.quantity, 2);
  assert.equal(plain.items?.[0]?.unitPrice, 1000);
});

test('the statuses: requested, approved, rejected, received, refunded and the legacy completed', () => {
  for (const status of ['requested', 'approved', 'rejected', 'received', 'refunded', 'completed']) assert.equal(new Return({ ...base, status }).validateSync(), undefined, status);
  assert.ok(new Return({ ...base, status: 'shipped' }).validateSync()?.errors.status);
});

test('a line is productId plus variantId with a whole quantity and whole rupees (there is no lineId)', () => {
  const line = { productId: 'P1', variantId: 'V1', productTitle: 'Shirt', variantTitle: 'M', quantity: 1, unitPrice: 1000 };
  assert.equal(new Return({ ...base, items: [line] }).validateSync(), undefined);
  assert.ok(new Return({ ...base, items: [{ ...line, quantity: 0 }] }).validateSync());
  assert.ok(new Return({ ...base, items: [{ ...line, quantity: 1.5 }] }).validateSync());
  assert.ok(new Return({ ...base, items: [{ ...line, unitPrice: 99.5 }] }).validateSync());
  assert.ok(new Return({ ...base, items: [{ ...line, variantId: undefined }] }).validateSync());
});

test('received lines and refunds: a refund is whole rupees of at least 1 by a listed method, with who and when', () => {
  const refund = { amount: 500, method: 'cash', reference: 'JC-1', at: new Date(), by: USER };
  assert.equal(new Return({ ...base, refunds: [refund], refundAmount: 500 }).validateSync(), undefined);
  for (const bad of [{ ...refund, amount: 0 }, { ...refund, amount: 10.5 }, { ...refund, method: 'stripe' }, { ...refund, reference: 'x'.repeat(101) }]) {
    assert.ok(new Return({ ...base, refunds: [bad] }).validateSync(), JSON.stringify(bad));
  }
  assert.equal(new Return({ ...base, received: [{ productId: 'P1', variantId: 'V1', quantity: 1, restock: false }] }).validateSync(), undefined);
  assert.ok(new Return({ ...base, received: [{ productId: 'P1', variantId: 'V1', quantity: 1 }] }).validateSync(), 'restock is a required choice');
});

test('the note is at most 300 characters and the seller\'s rejection reason at most 200', () => {
  assert.equal(new Return({ ...base, description: 'x'.repeat(300) }).validateSync(), undefined);
  assert.ok(new Return({ ...base, description: 'x'.repeat(301) }).validateSync()?.errors.description);
  assert.equal(new Return({ ...base, rejectReason: 'x'.repeat(200) }).validateSync(), undefined);
  assert.ok(new Return({ ...base, rejectReason: 'x'.repeat(201) }).validateSync()?.errors.rejectReason);
});

test('indexes: the return number is unique per store (partial, so older returns never collide), and the order and the customer are indexed with the store', () => {
  const indexes = Return.schema.indexes();
  const number = indexes.find(([fields]) => 'returnNumber' in fields);
  assert.ok(number, 'the { store, returnNumber } index exists');
  assert.deepEqual(number[0], { store: 1, returnNumber: 1 });
  assert.equal(number[1]?.unique, true);
  assert.deepEqual(number[1]?.partialFilterExpression, { returnNumber: { $type: 'string' } });
  assert.ok(indexes.some(([fields]) => fields.store === 1 && fields.order === 1 && Object.keys(fields).length === 2), '{ store, order }');
  assert.ok(indexes.some(([fields]) => fields.store === 1 && fields.contactPhone === 1), '{ store, contactPhone }');
  assert.ok(indexes.some(([fields]) => fields.store === 1 && fields.status === 1 && fields.createdAt === -1), '{ store, status, createdAt }');
});

test('the seller alert model accepts the return_requested kind', () => {
  assert.equal(new SellerAlert({ store: STORE, title: 'Return request RET-1', body: '', open: true, kind: 'return_requested' }).validateSync(), undefined);
});
