import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBSCRIPTION_SOURCES, SUBSCRIPTION_STATUSES, Subscription } from '../src';

// Sprint 6 EP-14 (D-118, CO-115): the subscription model. In memory; no database.

const SELLER = '65a000000000000000000001';

test('a subscription takes its defaults: active, manual, not cancelling, revision 0, no dates', () => {
  const doc = new Subscription({ seller: SELLER, planKey: 'growth' });
  assert.equal(doc.validateSync(), undefined);
  assert.deepEqual([doc.status, doc.source, doc.cancelAtPeriodEnd, doc.revision], ['active', 'manual', false, 0]);
  assert.deepEqual([doc.periodStart, doc.currentPeriodEnd, doc.graceUntil, doc.trialEndsAt], [null, null, null, null]);
});

test('the statuses and the sources are the five and the two of D-118', () => {
  assert.deepEqual([...SUBSCRIPTION_STATUSES], ['trial', 'active', 'grace', 'expired', 'cancelled']);
  assert.deepEqual([...SUBSCRIPTION_SOURCES], ['manual', 'stripe']);
  for (const status of SUBSCRIPTION_STATUSES) assert.equal(new Subscription({ seller: SELLER, planKey: 'free', status }).validateSync(), undefined, status);
  for (const source of SUBSCRIPTION_SOURCES) assert.equal(new Subscription({ seller: SELLER, planKey: 'free', source }).validateSync(), undefined, source);
});

test('a seller and a plan key are required, the key is a slug, and an unknown status or source is refused', () => {
  assert.notEqual(new Subscription({ planKey: 'growth' }).validateSync(), undefined);
  assert.notEqual(new Subscription({ seller: SELLER }).validateSync(), undefined);
  assert.notEqual(new Subscription({ seller: SELLER, planKey: 'Growth Plan' }).validateSync(), undefined);
  assert.notEqual(new Subscription({ seller: SELLER, planKey: 'growth', status: 'paused' }).validateSync(), undefined);
  assert.notEqual(new Subscription({ seller: SELLER, planKey: 'growth', source: 'cash' }).validateSync(), undefined);
  assert.notEqual(new Subscription({ seller: SELLER, planKey: 'growth', revision: -1 }).validateSync(), undefined);
});

test('the dates are dates, and a bad one is refused', () => {
  const ok = new Subscription({ seller: SELLER, planKey: 'growth', periodStart: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-01T00:00:00Z', graceUntil: '2026-12-08T00:00:00Z', trialEndsAt: null });
  assert.equal(ok.validateSync(), undefined);
  assert.ok(ok.currentPeriodEnd instanceof Date);
  assert.notEqual(new Subscription({ seller: SELLER, planKey: 'growth', currentPeriodEnd: 'not a date' }).validateSync(), undefined);
});

test('CO-115: the unique index on seller is declared on the model, so scripts/ensure-indexes.mjs picks it up', () => {
  const indexes = (Subscription as unknown as { schema: { indexes: () => Array<[Record<string, number>, Record<string, any>]> } }).schema.indexes();
  const unique = indexes.filter(([, options]) => options?.unique);
  assert.equal(unique.length, 1, 'exactly one unique index');
  assert.deepEqual(unique[0]![0], { seller: 1 });
  assert.equal(unique[0]![1].name, 'seller_unique');
  assert.ok(indexes.some(([key]) => key.status === 1 && key.currentPeriodEnd === 1), 'the expiry job index');
});

test('the collection is subscriptions and timestamps are kept', () => {
  assert.equal((Subscription as any).collection.name, 'subscriptions');
  assert.equal(Boolean((Subscription as any).schema.options.timestamps), true);
});
