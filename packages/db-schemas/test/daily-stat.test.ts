import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DailyStat, ProductDailyStat, SubscriptionCredit, STAT_MODEL_RETENTION_DAYS } from '../src';

// Sprint 8 (S8-B6, D-118): the counter models and the referral credit. Validation, defaults and indexes only: no database.

const store = '65a000000000000000000011';
const expiresAt = new Date('2027-12-31T00:00:00.000Z');

test('a day of counters starts at zero and needs the store, the day and a real expiry date', () => {
  const row = new DailyStat({ store, day: '2026-11-25', expiresAt });
  assert.equal(row.validateSync(), undefined);
  assert.deepEqual([row.visits, row.productViews, row.addToCart, row.checkoutStarts, row.orders], [0, 0, 0, 0, 0]);
  assert.ok(new DailyStat({ store, day: '25-11-2026', expiresAt }).validateSync()?.errors.day);
  assert.ok(new DailyStat({ store, day: '2026-11-25' }).validateSync()?.errors.expiresAt);
  assert.ok(new DailyStat({ store, day: '2026-11-25', expiresAt, visits: -1 }).validateSync()?.errors.visits);
  assert.equal(STAT_MODEL_RETENTION_DAYS, 400);
});

test('the counter models hold no field for a person: no ip, no visitor, no cookie, no user', () => {
  for (const model of [DailyStat, ProductDailyStat]) {
    for (const path of Object.keys(model.schema.paths)) assert.doesNotMatch(path, /ip|visitor|cookie|session|user|agent|email|phone/i, path);
  }
});

test('one row per store and day, one per store, product and day, and a TTL on both', () => {
  const daily = DailyStat.schema.indexes();
  assert.ok(daily.some(([key, o]) => JSON.stringify(key) === '{"store":1,"day":1}' && o?.unique === true));
  assert.ok(daily.some(([key, o]) => JSON.stringify(key) === '{"expiresAt":1}' && o?.expireAfterSeconds === 0));
  const product = ProductDailyStat.schema.indexes();
  assert.ok(product.some(([key, o]) => JSON.stringify(key) === '{"store":1,"productSlug":1,"day":1}' && o?.unique === true));
  assert.ok(product.some(([key, o]) => JSON.stringify(key) === '{"expiresAt":1}' && o?.expireAfterSeconds === 0));
});

test('a credit is 1 to 12 whole months, unused until taken, and one per referral', () => {
  const credit = { seller: store, months: 1, referral: store };
  const row = new SubscriptionCredit(credit);
  assert.equal(row.validateSync(), undefined);
  assert.deepEqual([row.reason, row.usedAt, row.usedByPayment], ['referral', null, null]);
  for (const months of [0, 13, 1.5]) assert.ok(new SubscriptionCredit({ ...credit, months }).validateSync()?.errors.months, String(months));
  assert.ok(SubscriptionCredit.schema.indexes().some(([key, o]) => JSON.stringify(key) === '{"referral":1}' && o?.unique === true));
});
