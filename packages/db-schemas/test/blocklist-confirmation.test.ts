import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockedContact, Order, SellerAlert } from '../src';

// Sprint 5 EP-11 (D-107, D-108): the BlockedContact model and the Order fields confirmationStatus, confirmationLog and riskFlags.
// Validation, defaults and indexes only: no database.

const STORE = '65a000000000000000000011';
const USER = '65a000000000000000000001';
const blocked = { store: STORE, kind: 'phone', value: '+923001234567', reason: 'Fake orders', createdBy: USER };

test('a blocked contact needs its store, kind, value and author; the reason defaults to empty', () => {
  assert.equal(new BlockedContact(blocked).validateSync(), undefined);
  const bare = new BlockedContact({ store: STORE, kind: 'email', value: 'a@b.pk', createdBy: USER });
  assert.equal(bare.validateSync(), undefined);
  assert.equal(bare.reason, '');
  for (const field of ['store', 'kind', 'value', 'createdBy'] as const) {
    const { [field]: _omitted, ...rest } = blocked;
    void _omitted;
    assert.ok(new BlockedContact(rest).validateSync()?.errors[field], field);
  }
});

test('the kind is phone or email, the reason at most 100 characters, and an email value is stored in lower case', () => {
  assert.equal(new BlockedContact({ ...blocked, kind: 'email', value: 'A@B.PK' }).value, 'a@b.pk');
  assert.ok(new BlockedContact({ ...blocked, kind: 'address' }).validateSync()?.errors.kind);
  assert.equal(new BlockedContact({ ...blocked, reason: 'x'.repeat(100) }).validateSync(), undefined);
  assert.ok(new BlockedContact({ ...blocked, reason: 'x'.repeat(101) }).validateSync()?.errors.reason);
});

test('one row per store, kind and value (unique index), in its own collection', () => {
  const unique = BlockedContact.schema.indexes().find(([fields]) => 'kind' in fields && 'value' in fields && 'store' in fields);
  assert.ok(unique, 'the index exists');
  assert.deepEqual(unique[0], { store: 1, kind: 1, value: 1 });
  assert.equal(unique[1]?.unique, true);
  assert.equal(BlockedContact.collection.name, 'blockedcontacts');
});

test('Order.confirmationStatus, confirmationLog and riskFlags are declared (strict mode would drop them otherwise)', () => {
  for (const path of ['confirmationStatus', 'confirmationLog', 'riskFlags']) assert.ok(Order.schema.path(path), path + ' is declared');
  const order = new Order({
    store: STORE,
    orderId: 'ORD-1',
    confirmationStatus: 'unconfirmed',
    riskFlags: ['high_value', 'new_customer'],
    confirmationLog: [{ at: new Date('2026-11-20T10:00:00Z'), by: USER, result: 'unreachable', note: 'No answer' }],
  });
  assert.equal(order.validateSync(), undefined);
  const plain = order.toObject();
  assert.equal(plain.confirmationStatus, 'unconfirmed');
  assert.deepEqual([...(plain.riskFlags ?? [])], ['high_value', 'new_customer']);
  assert.equal(plain.confirmationLog?.[0]?.result, 'unreachable');
  assert.equal(plain.confirmationLog?.[0]?.note, 'No answer');
});

test('an order with none of the fields has none: no default is written, so an older order reads as not_required', () => {
  const plain = new Order({ store: STORE, orderId: 'ORD-2' }).toObject();
  assert.equal('confirmationStatus' in plain, false);
  assert.equal('confirmationLog' in plain, false);
  assert.equal('riskFlags' in plain, false);
});

test('the confirmation status, the flags and the log results accept only their listed values', () => {
  for (const status of ['not_required', 'unconfirmed', 'confirmed', 'unreachable']) {
    assert.equal(new Order({ store: STORE, orderId: 'ORD-3', confirmationStatus: status }).validateSync(), undefined, status);
  }
  assert.ok(new Order({ store: STORE, orderId: 'ORD-3', confirmationStatus: 'maybe' }).validateSync()?.errors.confirmationStatus);
  assert.ok(new Order({ store: STORE, orderId: 'ORD-3', riskFlags: ['suspicious'] }).validateSync());
  const entry = { at: new Date(), by: USER, result: 'cancelled' };
  assert.equal(new Order({ store: STORE, orderId: 'ORD-3', confirmationLog: [entry] }).validateSync(), undefined, 'cancelled is a logged result');
  assert.ok(new Order({ store: STORE, orderId: 'ORD-3', confirmationLog: [{ ...entry, result: 'cancel' }] }).validateSync(), 'the request word is not a logged result');
  assert.ok(new Order({ store: STORE, orderId: 'ORD-3', confirmationLog: [{ ...entry, result: 'confirmed' }] }).validateSync() === undefined);
});

test('a log note is at most 200 characters and the log holds at most 20 entries', () => {
  const entry = (note: string) => ({ at: new Date(), by: USER, result: 'confirmed', note });
  assert.equal(new Order({ store: STORE, orderId: 'ORD-4', confirmationLog: [entry('x'.repeat(200))] }).validateSync(), undefined);
  assert.ok(new Order({ store: STORE, orderId: 'ORD-4', confirmationLog: [entry('x'.repeat(201))] }).validateSync());
  assert.equal(new Order({ store: STORE, orderId: 'ORD-4', confirmationLog: Array.from({ length: 20 }, () => entry('ok')) }).validateSync(), undefined);
  assert.ok(new Order({ store: STORE, orderId: 'ORD-4', confirmationLog: Array.from({ length: 21 }, () => entry('ok')) }).validateSync()?.errors.confirmationLog);
});

test('the unconfirmed list reads an index that starts with the store (not unique, so it can be built on existing data)', () => {
  const index = Order.schema.indexes().find(([fields]) => 'confirmationStatus' in fields);
  assert.ok(index, 'the index exists');
  assert.deepEqual(index[0], { store: 1, confirmationStatus: 1, createdAt: -1 });
  assert.notEqual(index[1]?.unique, true);
});

test('the seller alert model accepts the unconfirmed_order kind', () => {
  const alert = { store: STORE, title: 'Order needs a confirmation call', body: '', open: true };
  assert.equal(new SellerAlert({ ...alert, kind: 'unconfirmed_order' }).validateSync(), undefined);
  assert.ok(new SellerAlert({ ...alert, kind: 'unconfirmed' }).validateSync()?.errors.kind);
});
