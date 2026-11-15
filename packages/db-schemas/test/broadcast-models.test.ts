import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broadcast, EmailUnsubscribe } from '../src';

// Sprint 4 EP-07.US04 (D-092): the Broadcast and EmailUnsubscribe models. Validation and indexes only: no database.

const broadcast = {
  store: '65a000000000000000000011',
  subject: 'Eid sale',
  message: 'Everything is 20% off.',
  recipientCount: 12,
  createdBy: '65a000000000000000000001',
  dayKey: '2026-11-14',
};

test('a broadcast starts queued and needs its store, text, count, author and Karachi day', () => {
  const doc = new Broadcast(broadcast);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'queued');
  for (const field of ['store', 'subject', 'message', 'recipientCount', 'createdBy', 'dayKey'] as const) {
    const { [field]: _omitted, ...rest } = broadcast;
    void _omitted;
    assert.ok(new Broadcast(rest).validateSync()?.errors[field], field);
  }
});

test('a broadcast refuses a day that is not YYYY-MM-DD, a negative count and over-long text', () => {
  assert.ok(new Broadcast({ ...broadcast, dayKey: '14/11/2026' }).validateSync()?.errors.dayKey);
  assert.ok(new Broadcast({ ...broadcast, recipientCount: -1 }).validateSync()?.errors.recipientCount);
  assert.ok(new Broadcast({ ...broadcast, subject: 'x'.repeat(121) }).validateSync()?.errors.subject);
  assert.ok(new Broadcast({ ...broadcast, message: 'x'.repeat(2001) }).validateSync()?.errors.message);
  assert.ok(new Broadcast({ ...broadcast, status: 'sent' }).validateSync()?.errors.status);
});

test('one broadcast per store per day is a unique index on { store, dayKey }', () => {
  const unique = Broadcast.schema.indexes().find(([fields]) => 'dayKey' in fields && 'store' in fields);
  assert.ok(unique, 'the index exists');
  assert.deepEqual(unique[0], { store: 1, dayKey: 1 });
  assert.equal(unique[1]?.unique, true);
});

test('an unsubscribe keeps the email in lower case and is unique per store and email', () => {
  const doc = new EmailUnsubscribe({ store: '65a000000000000000000011', email: ' Ayesha@Example.COM ' });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.email, 'ayesha@example.com');
  assert.ok(doc.at instanceof Date);
  assert.ok(new EmailUnsubscribe({ email: 'a@b.com' }).validateSync()?.errors.store);
  assert.ok(new EmailUnsubscribe({ store: '65a000000000000000000011' }).validateSync()?.errors.email);
  const unique = EmailUnsubscribe.schema.indexes().find(([fields]) => 'email' in fields && 'store' in fields);
  assert.ok(unique);
  assert.deepEqual(unique[0], { store: 1, email: 1 });
  assert.equal(unique[1]?.unique, true);
});
