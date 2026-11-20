import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Review, SELLER_ALERT_KINDS, SellerAlert } from '../src';

// Sprint 5 EP-21 (D-107, D-108): the extended Review model. Validation, defaults and indexes only: no database.

const STORE = '65a000000000000000000011';
const PRODUCT = '65a0000000000000000c0001';
const ORDER = '65a0000000000000000a0001';
const ADMIN = '65a000000000000000000003';

const base = { product: PRODUCT, store: STORE, order: ORDER, rating: 5, body: 'Soft fabric, true to size.' };

test('a new review starts approved (published at once), unverified until the public route says otherwise, with no reply and no hide', () => {
  const doc = new Review(base);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'approved');
  assert.equal(doc.verified, false);
  assert.equal(doc.reply, null);
  assert.equal(doc.hiddenReason, null);
  assert.equal(doc.hiddenAt, null);
  assert.equal(doc.hiddenBy, null);
  assert.equal(doc.displayName, null);
});

test('the status values stay: pending, approved, rejected (hidden by an admin); anything else is refused', () => {
  for (const status of ['pending', 'approved', 'rejected']) assert.equal(new Review({ ...base, status }).validateSync(), undefined, status);
  assert.ok(new Review({ ...base, status: 'hidden' }).validateSync()?.errors.status);
});

test('the new fields are declared (strict mode would drop them otherwise) and kept: the name, verified, the reply, the hide', () => {
  const at = new Date('2026-11-21T10:00:00Z');
  const doc = new Review({ ...base, displayName: 'Ayesha K.', verified: true, reply: { text: 'Thank you!', at }, status: 'rejected', hiddenReason: 'Abusive', hiddenAt: at, hiddenBy: ADMIN });
  assert.equal(doc.validateSync(), undefined);
  const plain = doc.toObject();
  assert.equal(plain.displayName, 'Ayesha K.');
  assert.equal(plain.verified, true);
  assert.equal(plain.reply?.text, 'Thank you!');
  assert.equal(plain.reply?.editedAt, null);
  assert.equal(plain.hiddenReason, 'Abusive');
  assert.equal(String(plain.hiddenBy), ADMIN);
});

test('the limits: the name 40, the title 80, the text 1000, the reply 500, the hidden reason 300; the rating 1 to 5; a reply needs its text and its date', () => {
  assert.equal(new Review({ ...base, displayName: 'x'.repeat(40), title: 'y'.repeat(80), body: 'z'.repeat(1000), hiddenReason: 'h'.repeat(300) }).validateSync(), undefined);
  assert.ok(new Review({ ...base, displayName: 'x'.repeat(41) }).validateSync()?.errors.displayName);
  assert.ok(new Review({ ...base, title: 'y'.repeat(81) }).validateSync()?.errors.title);
  assert.ok(new Review({ ...base, body: 'z'.repeat(1001) }).validateSync()?.errors.body);
  assert.ok(new Review({ ...base, hiddenReason: 'h'.repeat(301) }).validateSync()?.errors.hiddenReason);
  assert.ok(new Review({ ...base, reply: { text: 'r'.repeat(501), at: new Date() } }).validateSync());
  assert.ok(new Review({ ...base, reply: { text: 'no date' } }).validateSync());
  assert.ok(new Review({ ...base, rating: 0 }).validateSync()?.errors.rating);
  assert.ok(new Review({ ...base, rating: 6 }).validateSync()?.errors.rating);
});

test('indexes: ONE review per order and product (unique, partial so older reviews without an order never collide), the seller\'s list and the product\'s list', () => {
  const indexes = Review.schema.indexes();
  const unique = indexes.find(([fields]) => fields.order === 1 && fields.product === 1);
  assert.ok(unique, 'the { order, product } index exists');
  assert.deepEqual(unique[0], { order: 1, product: 1 });
  assert.equal(unique[1]?.unique, true);
  assert.deepEqual(unique[1]?.partialFilterExpression, { order: { $type: 'objectId' } });
  assert.ok(indexes.some(([fields]) => fields.store === 1 && fields.status === 1 && fields.createdAt === -1), '{ store, status, createdAt }');
  assert.ok(indexes.some(([fields]) => fields.product === 1 && fields.status === 1 && fields.createdAt === -1), '{ product, status, createdAt }');
});

test('the seller alert model lists review_received, last of the kinds so far', () => {
  assert.equal(SELLER_ALERT_KINDS.at(-1), 'review_received');
  assert.equal(new SellerAlert({ store: STORE, title: 'New review: 5 out of 5', body: '', open: true, kind: 'review_received' }).validateSync(), undefined);
});
