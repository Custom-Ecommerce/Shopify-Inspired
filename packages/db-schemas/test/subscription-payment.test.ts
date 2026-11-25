import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PAYMENT_STATUSES, SUBSCRIPTION_PAYMENT_METHODS, SUBSCRIPTION_PAYMENT_STATUSES, Subscription, SubscriptionPayment } from '../src';

// Sprint 6 (S6-B4, D-118): the manual payment model. In memory; no database.

const SELLER = '65a000000000000000000001';
const base = { seller: SELLER, planKey: 'growth', amountRs: 2500 };

test('a payment starts requested and open, with revision 0 and nothing decided', () => {
  const doc = new SubscriptionPayment(base);
  assert.equal(doc.validateSync(), undefined);
  assert.deepEqual([doc.status, doc.isOpen, doc.revision], ['requested', true, 0]);
  assert.deepEqual([doc.method, doc.reference, doc.proofUrl, doc.periodStart, doc.periodEnd, doc.decidedBy, doc.decidedAt, doc.reason], [null, null, null, null, null, null, null, null]);
});

test('the statuses and the methods are the five and the four of the plan', () => {
  assert.deepEqual([...SUBSCRIPTION_PAYMENT_STATUSES], ['requested', 'claimed', 'confirmed', 'rejected', 'void']);
  assert.deepEqual([...SUBSCRIPTION_PAYMENT_METHODS], ['bank', 'jazzcash', 'easypaisa', 'other']);
  assert.deepEqual([...OPEN_PAYMENT_STATUSES], ['requested', 'claimed']);
  for (const status of SUBSCRIPTION_PAYMENT_STATUSES) assert.equal(new SubscriptionPayment({ ...base, status }).validateSync(), undefined, status);
  for (const method of SUBSCRIPTION_PAYMENT_METHODS) assert.equal(new SubscriptionPayment({ ...base, method }).validateSync(), undefined, method);
});

test('the amount is whole rupees of 1 or more; a fraction, zero, a negative and a missing amount are refused', () => {
  for (const bad of [2500.5, 0, -1, undefined]) assert.notEqual(new SubscriptionPayment({ ...base, amountRs: bad }).validateSync(), undefined, String(bad));
  assert.equal(new SubscriptionPayment({ ...base, amountRs: 1 }).validateSync(), undefined);
});

test('a seller, a plan key and an amount are required; the key is a slug; an unknown status or method is refused', () => {
  for (const missing of ['seller', 'planKey', 'amountRs']) assert.notEqual(new SubscriptionPayment({ ...base, [missing]: undefined }).validateSync(), undefined, missing);
  assert.notEqual(new SubscriptionPayment({ ...base, planKey: 'Growth Plan' }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPayment({ ...base, status: 'paid' }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPayment({ ...base, method: 'cash' }).validateSync(), undefined);
});

test('the reference is at most 100 characters and the proof is an https link of at most 300', () => {
  assert.equal(new SubscriptionPayment({ ...base, reference: 'x'.repeat(100) }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPayment({ ...base, reference: 'x'.repeat(101) }).validateSync(), undefined);
  assert.equal(new SubscriptionPayment({ ...base, proofUrl: 'https://example.com/slip.jpg' }).validateSync(), undefined);
  for (const bad of ['http://example.com/slip.jpg', 'javascript:alert(1)', 'ftp://x.test/a', '//example.com/a', 'https://' + 'x'.repeat(300)]) {
    assert.notEqual(new SubscriptionPayment({ ...base, proofUrl: bad }).validateSync(), undefined, bad.slice(0, 30));
  }
});

test('the dates are dates and the revision cannot be negative', () => {
  assert.equal(new SubscriptionPayment({ ...base, periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', decidedAt: '2026-11-01T00:00:00Z' }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPayment({ ...base, periodEnd: 'soon' }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPayment({ ...base, revision: -1 }).validateSync(), undefined);
});

test('indexes: {seller, status}, and a unique partial index keeps ONE open payment per seller; the partial filter is an equality (no $in)', () => {
  const indexes = (SubscriptionPayment as unknown as { schema: { indexes: () => Array<[Record<string, number>, Record<string, any>]> } }).schema.indexes();
  assert.ok(indexes.some(([key]) => key.seller === 1 && key.status === 1), '{seller, status}');
  const unique = indexes.filter(([, options]) => options?.unique);
  assert.equal(unique.length, 1);
  assert.deepEqual(unique[0]![0], { seller: 1 });
  assert.equal(unique[0]![1].name, 'seller_open_unique');
  assert.deepEqual(unique[0]![1].partialFilterExpression, { isOpen: true });
});

test('the collection is subscriptionPayments, timestamps are kept, and the subscription has a pending plan key (default none)', () => {
  assert.equal((SubscriptionPayment as any).collection.name, 'subscriptionPayments');
  assert.equal(Boolean((SubscriptionPayment as any).schema.options.timestamps), true);
  assert.equal(new Subscription({ seller: SELLER, planKey: 'growth' }).pendingPlanKey, null);
  assert.equal(new Subscription({ seller: SELLER, planKey: 'growth', pendingPlanKey: 'free' }).validateSync(), undefined);
  assert.notEqual(new Subscription({ seller: SELLER, planKey: 'growth', pendingPlanKey: 'Free Plan' }).validateSync(), undefined);
});
