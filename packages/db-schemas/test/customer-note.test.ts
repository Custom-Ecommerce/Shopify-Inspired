import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CustomerNote, Order } from '../src';

// Sprint 5 EP-10.US01 (D-107, D-108): the CustomerNote model and Order.phoneKey. Validation and indexes only: no database.

const note = {
  store: '65a000000000000000000011',
  key: '+923001234567',
  note: 'Prefers calls after 6 pm.',
  tags: ['VIP', 'wholesale'],
  updatedBy: '65a000000000000000000001',
};

test('a customer note needs its store, key and author; the note and tags default to empty', () => {
  assert.equal(new CustomerNote(note).validateSync(), undefined);
  const bare = new CustomerNote({ store: note.store, key: note.key, updatedBy: note.updatedBy });
  assert.equal(bare.validateSync(), undefined);
  assert.equal(bare.note, '');
  assert.deepEqual([...bare.tags], []);
  for (const field of ['store', 'key', 'updatedBy'] as const) {
    const { [field]: _omitted, ...rest } = note;
    void _omitted;
    assert.ok(new CustomerNote(rest).validateSync()?.errors[field], field);
  }
});

test('the note is at most 500 characters, a tag at most 20, and there are at most 5 tags', () => {
  assert.equal(new CustomerNote({ ...note, note: 'x'.repeat(500) }).validateSync(), undefined);
  assert.ok(new CustomerNote({ ...note, note: 'x'.repeat(501) }).validateSync()?.errors.note);
  assert.equal(new CustomerNote({ ...note, tags: ['x'.repeat(20)] }).validateSync(), undefined);
  assert.ok(new CustomerNote({ ...note, tags: ['x'.repeat(21)] }).validateSync());
  assert.equal(new CustomerNote({ ...note, tags: ['1', '2', '3', '4', '5'] }).validateSync(), undefined);
  assert.ok(new CustomerNote({ ...note, tags: ['1', '2', '3', '4', '5', '6'] }).validateSync()?.errors.tags);
});

test('the key is stored lower case, and there is one row per store and key (unique index { store, key })', () => {
  assert.equal(new CustomerNote({ ...note, key: 'Ayesha@Example.com' }).key, 'ayesha@example.com');
  const unique = CustomerNote.schema.indexes().find(([fields]) => 'key' in fields && 'store' in fields);
  assert.ok(unique, 'the index exists');
  assert.deepEqual(unique[0], { store: 1, key: 1 });
  assert.equal(unique[1]?.unique, true);
});

test('customernotes is its own collection, and there is no customer collection', async () => {
  assert.equal(CustomerNote.collection.name, 'customernotes');
  const names = Object.keys(await import('../src'));
  assert.equal(names.some((name) => /^Customer$/.test(name)), false);
});

test('Order.phoneKey is declared (strict mode would drop it otherwise), optional, and indexed with the store', () => {
  assert.ok(Order.schema.path('phoneKey'), 'declared in the schema');
  const order = new Order({ store: '65a000000000000000000011', orderId: 'ORD-1', phoneKey: '+923001234567', phone: '03001234567' });
  assert.equal(order.phoneKey, '+923001234567');
  assert.equal(order.phone, '03001234567', 'phone itself is kept as typed');
  assert.equal(order.toObject().phoneKey, '+923001234567', 'strict mode keeps it');
  const without = new Order({ store: '65a000000000000000000011', orderId: 'ORD-2' });
  assert.equal('phoneKey' in without.toObject(), false, 'absent when there is no key (the backfill looks for it to be absent)');
  const index = Order.schema.indexes().find(([fields]) => 'phoneKey' in fields);
  assert.ok(index, 'the { store, phoneKey } index exists');
  assert.deepEqual(index[0], { store: 1, phoneKey: 1 });
  assert.notEqual(index[1]?.unique, true, 'not unique: a customer has many orders');
});
