import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYOUT_STATUSES, Payout } from '../src';

// Sprint 4 EP-05.US03 (D-090): the Payout model, in whole rupees. Validation only: no database.

const base = {
  store: '65a000000000000000000011',
  amount: 2110,
  method: 'jazzcash',
  reference: 'JC-778812',
  cutoff: new Date('2026-11-10T12:00:00Z'),
  entryCount: 3,
  payoutDetailsSnapshot: { method: 'jazzcash', accountTitle: 'Zara Khan', last4: '4567', bankName: null },
  createdBy: '65a000000000000000000003',
};

test('a payout with whole rupees, a method and a snapshot passes, and starts as pending_settle', () => {
  const doc = new Payout(base);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'pending_settle');
  assert.equal(doc.note, null);
  assert.equal(doc.voidedAt, null);
  assert.equal(doc.paidAt, null);
});

test('the amount must be whole rupees above zero', () => {
  for (const amount of [0, -100, 10.5]) assert.ok(new Payout({ ...base, amount }).validateSync()?.errors.amount, String(amount));
});

test('the method and the status come from the known lists', () => {
  assert.ok(new Payout({ ...base, method: 'cheque' }).validateSync()?.errors.method);
  assert.ok(new Payout({ ...base, status: 'done' }).validateSync()?.errors.status);
  for (const status of PAYOUT_STATUSES) assert.equal(new Payout({ ...base, status }).validateSync(), undefined, status);
  assert.deepEqual([...PAYOUT_STATUSES], ['pending_settle', 'paid', 'voided', 'failed']);
});

test('the snapshot keeps the last 4 characters of the account and never room for the whole number', () => {
  assert.ok(new Payout({ ...base, payoutDetailsSnapshot: { ...base.payoutDetailsSnapshot, last4: '03001234567' } }).validateSync());
  assert.ok(new Payout({ ...base, payoutDetailsSnapshot: undefined }).validateSync()?.errors.payoutDetailsSnapshot);
  const snapshot = Payout.schema.path('payoutDetailsSnapshot') as unknown as { schema: { paths: Record<string, unknown> } };
  const paths = Object.keys(snapshot.schema.paths);
  assert.equal(paths.some((path) => /number/i.test(path)), false);
});

test('a store can have only one payout in pending_settle at a time (partial unique index)', () => {
  const found = Payout.schema.indexes().find(([fields]) => JSON.stringify(fields) === JSON.stringify({ store: 1 }));
  assert.ok(found, 'the { store } index is declared');
  const options = found[1] as { unique?: boolean; partialFilterExpression?: unknown };
  assert.equal(options.unique, true);
  assert.deepEqual(options.partialFilterExpression, { status: 'pending_settle' });
});

test('the reference, the note and the void reason are bounded', () => {
  assert.ok(new Payout({ ...base, reference: 'x'.repeat(101) }).validateSync()?.errors.reference);
  assert.ok(new Payout({ ...base, note: 'y'.repeat(501) }).validateSync()?.errors.note);
  assert.ok(new Payout({ ...base, voidReason: 'z'.repeat(501) }).validateSync()?.errors.voidReason);
  assert.equal(new Payout({ ...base, reference: '' }).validateSync()?.errors.reference?.kind, 'required');
});
