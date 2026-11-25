import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Referral, User } from '../src';

// Sprint 8 (S8-B5, D-118): the referral row and the seller's code. Validation, defaults and indexes only: no database.

const row = { referrer: '65a000000000000000000001', referred: '65a000000000000000000002' };

test('a referral starts pending with no months and no reward date', () => {
  const doc = new Referral(row);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.monthsRewarded, 0);
  assert.equal(doc.rewardedAt, null);
  assert.ok(new Referral({ ...row, monthsRewarded: -1 }).validateSync()?.errors.monthsRewarded);
  assert.ok(new Referral({ ...row, status: 'paid' }).validateSync()?.errors.status);
});

test('a referred seller can be referred once (unique index)', () => {
  const indexes = Referral.schema.indexes();
  assert.ok(indexes.some(([key, options]) => (key as Record<string, number>).referred === 1 && options?.unique === true));
});

test('a new account has no code and no referrer (never null: the unique index of the code is partial)', () => {
  const user = new User({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
  assert.equal(user.referralCode, undefined);
  assert.equal(user.referredBy, undefined);
});
