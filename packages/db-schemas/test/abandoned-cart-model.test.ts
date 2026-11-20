import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbandonedCart } from '../src';

// Sprint 5 EP-28 (D-107): the AbandonedCart model. Validation, defaults and indexes only: no database.

const STORE = '65a000000000000000000011';
const PRODUCT = '65a0000000000000000c0001';
const NOW = new Date('2026-11-21T10:00:00Z');
const item = { productId: PRODUCT, variantId: '65a0000000000000000d0001', productTitle: 'Shirt', variantTitle: 'M', quantity: 2, unitPrice: 1000 };
const base = { store: STORE, phone: '+923001234567', items: [item], total: 2000, consentAt: NOW, lastSeenAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * 86_400_000) };

test('a cart starts open, with no email, nothing contacted and nothing recovered, and keeps the snapshot of its items', () => {
  const doc = new AbandonedCart(base);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'open');
  assert.equal(doc.email, null);
  assert.equal(doc.contactedAt, null);
  assert.equal(doc.recoveredOrder, null);
  assert.equal(doc.recoveredAt, null);
  assert.equal(doc.emailQueuedAt, null);
  assert.deepEqual(doc.items.map((i) => [i.productTitle, i.variantTitle, i.quantity, i.unitPrice]), [['Shirt', 'M', 2, 1000]]);
  assert.equal(doc.total, 2000);
});

test('the statuses: open, contacted, recovered, expired; anything else is refused', () => {
  for (const status of ['open', 'contacted', 'recovered', 'expired']) assert.equal(new AbandonedCart({ ...base, status }).validateSync(), undefined, status);
  assert.ok(new AbandonedCart({ ...base, status: 'abandoned' }).validateSync()?.errors.status);
});

test('nothing is stored without a normalized phone, the consent time and the activity time', () => {
  assert.ok(new AbandonedCart({ ...base, phone: undefined }).validateSync()?.errors.phone);
  for (const phone of ['0300 1234567', '03001234567', '+92300123456', '+923001234567x', '']) assert.ok(new AbandonedCart({ ...base, phone }).validateSync()?.errors.phone, phone);
  assert.ok(new AbandonedCart({ ...base, consentAt: undefined }).validateSync()?.errors.consentAt, 'no consent, no cart');
  assert.ok(new AbandonedCart({ ...base, lastSeenAt: undefined }).validateSync()?.errors.lastSeenAt);
  assert.ok(new AbandonedCart({ ...base, expiresAt: undefined }).validateSync()?.errors.expiresAt);
});

test('1 to 50 lines, each with a quantity from 1 to 99 and a price that is not negative; a phone-less cart is not a cart', () => {
  assert.ok(new AbandonedCart({ ...base, items: [] }).validateSync()?.errors.items);
  assert.equal(new AbandonedCart({ ...base, items: Array.from({ length: 50 }, () => item) }).validateSync(), undefined);
  assert.ok(new AbandonedCart({ ...base, items: Array.from({ length: 51 }, () => item) }).validateSync()?.errors.items);
  assert.ok(new AbandonedCart({ ...base, items: [{ ...item, quantity: 0 }] }).validateSync());
  assert.ok(new AbandonedCart({ ...base, items: [{ ...item, quantity: 100 }] }).validateSync());
  assert.ok(new AbandonedCart({ ...base, items: [{ ...item, unitPrice: -1 }] }).validateSync());
  assert.ok(new AbandonedCart({ ...base, total: -1 }).validateSync()?.errors.total);
});

test('the email is stored in lower case', () => {
  assert.equal(new AbandonedCart({ ...base, email: 'Ayesha@Example.PK' }).email, 'ayesha@example.pk');
});

test('the TTL index is declared: expiresAt with expireAfterSeconds 0 (expiresAt already holds the last activity plus 7 days)', () => {
  const ttl = AbandonedCart.schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && fields.expiresAt === 1);
  assert.ok(ttl, 'the { expiresAt } index exists');
  assert.equal(ttl[1]?.expireAfterSeconds, 0);
});

test('ONE open cart per store and phone: a unique { store, phone } index that is partial on status open, so a contacted or recovered cart never blocks a new one', () => {
  const unique = AbandonedCart.schema.indexes().find(([fields]) => fields.store === 1 && fields.phone === 1);
  assert.ok(unique, 'the { store, phone } index exists');
  assert.deepEqual(unique[0], { store: 1, phone: 1 });
  assert.equal(unique[1]?.unique, true);
  assert.deepEqual(unique[1]?.partialFilterExpression, { status: 'open' });
});

test('the seller\'s list and the optional email step have their indexes', () => {
  const indexes = AbandonedCart.schema.indexes();
  assert.ok(indexes.some(([fields]) => fields.store === 1 && fields.status === 1 && fields.lastSeenAt === -1), '{ store, status, lastSeenAt }');
  assert.ok(indexes.some(([fields]) => fields.status === 1 && fields.emailQueuedAt === 1 && fields.lastSeenAt === 1), '{ status, emailQueuedAt, lastSeenAt }');
});

test('the collection is abandonedcarts', () => {
  assert.equal(AbandonedCart.collection.name, 'abandonedcarts');
});
